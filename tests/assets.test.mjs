/**
 * /dsh-tavern-skin/assets 静态资源路由测试（方案 §2.6/§6.5）。
 *
 * 不碰网络、不碰真实主题包：在 os.tmpdir() 里搭一套临时目录，用假的 req/res
 * 直接驱动 createAssetsHandler。覆盖 200 / HEAD / 206 / 416 / 304 / 404 /
 * 405 / 400、路径穿越、扩展名白名单、缓存策略与 query string 忽略。
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { createAssetsHandler } from "../lib/host/assets.js";

const ROUTE = "/dsh-tavern-skin/assets";

// ── 测试夹具：临时目录 ──────────────────────────────────────────────────────

const sandbox = mkdtempSync(join(tmpdir(), "dshte-assets-"));
const builtinRoot = join(sandbox, "builtin");
const packsRoot = join(sandbox, "packs");

/** 64 字节、内容可区分的假字体。 */
const FONT_BYTES = Buffer.from(Array.from({ length: 64 }, (_, index) => index));

function writeAsset(relativePath, content) {
	const file = join(sandbox, relativePath);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
	return file;
}

writeAsset("builtin/pack-a/assets/fonts/test-font.woff2", FONT_BYTES);
writeAsset("builtin/pack-a/assets/fonts/test-font-9f3a1c2d.woff2", Buffer.from("hashed-font-payload"));
writeAsset("builtin/pack-a/assets/images/test-image.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
// 真实存在但扩展名不在白名单里的文件：必须 404。
writeAsset("builtin/pack-a/assets/secret.js", "console.log('no');");
writeAsset("builtin/pack-a/assets/notes.html", "<p>no</p>");
writeAsset("builtin/pack-a/assets/style.css", "body{color:red}");
// 用户包（Step 6 目录；目录不存在时也要求 404）。
writeAsset("packs/user-pack/assets/fonts/user-font.woff2", FONT_BYTES);

after(() => rmSync(sandbox, { recursive: true, force: true }));

const handler = createAssetsHandler({ builtinRoot, packsRoot });

// ── 假 req / res ────────────────────────────────────────────────────────────

function makeResponse() {
	const chunks = [];
	const res = new Writable({
		write(chunk, encoding, callback) {
			chunks.push(Buffer.from(chunk));
			callback();
		}
	});
	res.statusCode = 0;
	res.headers = {};
	res.headersSent = false;
	res.chunks = chunks;
	res.writeHead = (status, headers = {}) => {
		res.statusCode = status;
		res.headers = { ...headers };
		res.headersSent = true;
		return res;
	};
	return res;
}

function makeRequest(method, url, headers = {}) {
	const req = Readable.from([]);
	req.method = method;
	req.url = url;
	// 真实 IncomingMessage 的 header 名恒为小写，这里保持一致。
	req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
	return req;
}

/** 调一次 handler，返回 { status, headers, body }。 */
async function request(method, url, headers = {}, activeHandler = handler) {
	const res = makeResponse();
	await activeHandler(makeRequest(method, url, headers), res);
	return { status: res.statusCode, headers: res.headers, body: Buffer.concat(res.chunks) };
}

function assertNosniff(headers) {
	assert.equal(headers["x-content-type-options"], "nosniff");
}

const FONT_URL = `${ROUTE}/builtin/pack-a/assets/fonts/test-font.woff2`;

// ── 1. 200 全量 ─────────────────────────────────────────────────────────────

test("200 全量：content-type / content-length / accept-ranges / etag / nosniff", async () => {
	const { status, headers, body } = await request("GET", FONT_URL);
	assert.equal(status, 200);
	assert.equal(headers["content-type"], "font/woff2");
	assert.equal(headers["content-length"], FONT_BYTES.length);
	assert.equal(headers["accept-ranges"], "bytes");
	assert.equal(headers["cache-control"], "no-cache");
	assert.match(headers.etag, /^"\d+-\d+"$/, "etag 必须是强 ETag 形态");
	assertNosniff(headers);
	assert.deepEqual(body, FONT_BYTES);
});

test("query string 被忽略，仍返回 200 全量", async () => {
	const { status, body } = await request("GET", `${FONT_URL}?v=2&cache=0`);
	assert.equal(status, 200);
	assert.deepEqual(body, FONT_BYTES);
});

test("svg 使用 image/svg+xml; charset=utf-8", async () => {
	const { status, headers } = await request("GET", `${ROUTE}/builtin/pack-a/assets/images/test-image.svg`);
	assert.equal(status, 200);
	assert.equal(headers["content-type"], "image/svg+xml; charset=utf-8");
});

test("pack 形式走用户包根目录", async () => {
	const { status, headers, body } = await request("GET", `${ROUTE}/pack/user-pack/assets/fonts/user-font.woff2`);
	assert.equal(status, 200);
	assert.equal(headers["content-type"], "font/woff2");
	assert.deepEqual(body, FONT_BYTES);
});

// ── 2. HEAD ────────────────────────────────────────────────────────────────

test("HEAD 无 body，头与 GET 一致", async () => {
	const { status, headers, body } = await request("HEAD", FONT_URL);
	assert.equal(status, 200);
	assert.equal(headers["content-type"], "font/woff2");
	assert.equal(headers["content-length"], FONT_BYTES.length);
	assert.equal(headers["accept-ranges"], "bytes");
	assert.match(headers.etag, /^"\d+-\d+"$/);
	assertNosniff(headers);
	assert.equal(body.length, 0);
});

// ── 3. Range ───────────────────────────────────────────────────────────────

test("Range: bytes=0-15 → 206 + content-range + 16 字节", async () => {
	const { status, headers, body } = await request("GET", FONT_URL, { range: "bytes=0-15" });
	assert.equal(status, 206);
	assert.equal(headers["content-range"], `bytes 0-15/${FONT_BYTES.length}`);
	assert.equal(headers["content-length"], 16);
	assert.equal(headers["accept-ranges"], "bytes");
	assertNosniff(headers);
	assert.deepEqual(body, FONT_BYTES.subarray(0, 16));
});

test("Range: bytes=32- → 206 到文件尾", async () => {
	const { status, headers, body } = await request("GET", FONT_URL, { range: "bytes=32-" });
	assert.equal(status, 206);
	assert.equal(headers["content-range"], `bytes 32-63/${FONT_BYTES.length}`);
	assert.equal(headers["content-length"], 32);
	assert.deepEqual(body, FONT_BYTES.subarray(32));
});

test("Range: bytes=-16 → 206 最后 16 字节", async () => {
	const { status, headers, body } = await request("GET", FONT_URL, { range: "bytes=-16" });
	assert.equal(status, 206);
	assert.equal(headers["content-range"], `bytes 48-63/${FONT_BYTES.length}`);
	assert.equal(headers["content-length"], 16);
	assert.deepEqual(body, FONT_BYTES.subarray(48));
});

test("Range 超出文件 → 416 + content-range: bytes */<size>，无 body", async () => {
	const { status, headers, body } = await request("GET", FONT_URL, { range: "bytes=9999-" });
	assert.equal(status, 416);
	assert.equal(headers["content-range"], `bytes */${FONT_BYTES.length}`);
	assertNosniff(headers);
	assert.equal(body.length, 0);
});

test("Range: bytes=-0 → 416（suffix 为 0）", async () => {
	const { status, headers, body } = await request("GET", FONT_URL, { range: "bytes=-0" });
	assert.equal(status, 416);
	assert.equal(headers["content-range"], `bytes */${FONT_BYTES.length}`);
	assert.equal(body.length, 0);
});

test("多段 / 非法单位 / 语法坏 → 忽略 Range，回 200 全量", async () => {
	for (const range of ["bytes=0-1,4-5", "items=0-5", "bytes=abc", "bytes=5-3", "bytes="]) {
		const { status, headers, body } = await request("GET", FONT_URL, { range });
		assert.equal(status, 200, `Range「${range}」应被忽略`);
		assert.equal(headers["content-length"], FONT_BYTES.length);
		assert.deepEqual(body, FONT_BYTES);
	}
});

test("HEAD + Range → 206 头，零 body", async () => {
	const { status, headers, body } = await request("HEAD", FONT_URL, { range: "bytes=0-15" });
	assert.equal(status, 206);
	assert.equal(headers["content-range"], `bytes 0-15/${FONT_BYTES.length}`);
	assert.equal(headers["content-length"], 16);
	assert.equal(body.length, 0);
});

// ── 4. 条件请求 ─────────────────────────────────────────────────────────────

test("If-None-Match 命中 → 304 无 body，带 etag/cache-control/accept-ranges", async () => {
	const first = await request("GET", FONT_URL);
	const etag = first.headers.etag;
	for (const value of [etag, `W/${etag}`, `"nope", ${etag}`]) {
		const { status, headers, body } = await request("GET", FONT_URL, { "if-none-match": value });
		assert.equal(status, 304, `If-None-Match「${value}」应命中`);
		assert.equal(headers.etag, etag);
		assert.equal(headers["cache-control"], "no-cache");
		assert.equal(headers["accept-ranges"], "bytes");
		assertNosniff(headers);
		assert.equal(body.length, 0);
	}
});

test("If-None-Match 不匹配 → 200 全量", async () => {
	const { status, body } = await request("GET", FONT_URL, { "if-none-match": '"0-0"' });
	assert.equal(status, 200);
	assert.deepEqual(body, FONT_BYTES);
});

// ── 5. 路径安全 ─────────────────────────────────────────────────────────────

test("路径穿越 / 绝对路径 / NUL / 尾斜杠 / 空路径 → 404 且不泄露真实路径", async () => {
	const attacks = [
		`${ROUTE}/builtin/pack-a/../../package.json`,
		`${ROUTE}/builtin/pack-a/%2e%2e%2f%2e%2e%2fpackage.json`,
		`${ROUTE}/builtin/pack-a/..%5c..%5cpackage.json`,
		`${ROUTE}/builtin/pack-a/..\\..\\package.json`,
		`${ROUTE}/builtin/pack-a//etc/passwd`,
		`${ROUTE}//etc/passwd`,
		`${ROUTE}/builtin/../../../package.json`,
		`${ROUTE}/builtin/pack-a/assets/%00.svg`,
		`${ROUTE}/builtin/pack-a/assets/images/`,
		`${ROUTE}/builtin/pack-a/`,
		ROUTE,
		`${ROUTE}/`
	];
	for (const url of attacks) {
		const { status, headers, body } = await request("GET", url);
		assert.equal(status, 404, `「${url}」必须 404`);
		assertNosniff(headers);
		const text = body.toString("utf8");
		assert.ok(!text.includes(sandbox), "响应不能回显真实根目录");
		assert.ok(!text.includes("package.json"), "响应不能回显越界目标");
	}
});

test("非法百分号编码 → 400", async () => {
	const { status, headers, body } = await request("GET", `${ROUTE}/builtin/pack-a/%E0%A4%A`);
	assert.equal(status, 400);
	assertNosniff(headers);
	assert.equal(body.length > 0, true);
});

// ── 6. 扩展名白名单 ────────────────────────────────────────────────────────

test("白名单外的扩展名（.js/.html/.css）即使文件存在也 404", async () => {
	for (const name of ["secret.js", "notes.html", "style.css"]) {
		const { status } = await request("GET", `${ROUTE}/builtin/pack-a/assets/${name}`);
		assert.equal(status, 404, `「${name}」必须 404`);
	}
});

test("无扩展名 / 未知图片格式 → 404", async () => {
	for (const path of ["assets/fonts/test-font", "assets/images/x.bmp", "theme.json"]) {
		const { status } = await request("GET", `${ROUTE}/builtin/pack-a/${path}`);
		assert.equal(status, 404);
	}
});

// ── 7. 方法 / 404 ──────────────────────────────────────────────────────────

test("POST → 405 + allow: GET, HEAD", async () => {
	const { status, headers, body } = await request("POST", FONT_URL);
	assert.equal(status, 405);
	assert.equal(headers.allow, "GET, HEAD");
	assertNosniff(headers);
	assert.equal(body.length > 0, true);
});

test("PUT / DELETE → 405", async () => {
	for (const method of ["PUT", "DELETE", "PATCH"]) {
		const { status, headers } = await request(method, FONT_URL);
		assert.equal(status, 405);
		assert.equal(headers.allow, "GET, HEAD");
	}
});

test("不存在的 pack / 路径 / 资源根目录 → 404", async () => {
	const urls = [
		`${ROUTE}/builtin/ghost-pack/assets/fonts/x.woff2`,
		`${ROUTE}/builtin/pack-a/assets/fonts/missing.woff2`,
		`${ROUTE}/builtin/pack-a/assets/images`,
		`${ROUTE}/pack/ghost-pack/assets/fonts/x.woff2`
	];
	for (const url of urls) {
		const { status } = await request("GET", url);
		assert.equal(status, 404, `「${url}」必须 404`);
	}
	// packs 根目录整个不存在时（Step 6 之前）也必须是 404，不是 500。
	const missingRootHandler = createAssetsHandler({ builtinRoot, packsRoot: join(sandbox, "no-such-packs") });
	const { status } = await request("GET", `${ROUTE}/pack/user-pack/assets/fonts/user-font.woff2`, {}, missingRootHandler);
	assert.equal(status, 404);
});

test("其它 kind 前缀 → 404", async () => {
	for (const url of [`${ROUTE}/other/pack-a/assets/fonts/test-font.woff2`, `${ROUTE}/builtin`, `${ROUTE}/builtin/`]) {
		const { status } = await request("GET", url);
		assert.equal(status, 404);
	}
});

// ── 8. 缓存策略 ────────────────────────────────────────────────────────────

test("9 位内容哈希文件名 → immutable；普通文件名 → no-cache", async () => {
	const hashed = await request("GET", `${ROUTE}/builtin/pack-a/assets/fonts/test-font-9f3a1c2d.woff2`);
	assert.equal(hashed.status, 200);
	assert.equal(hashed.headers["cache-control"], "public, max-age=31536000, immutable");

	const plain = await request("GET", FONT_URL);
	assert.equal(plain.headers["cache-control"], "no-cache");
});

// ── 9. 构造参数校验 ────────────────────────────────────────────────────────

test("createAssetsHandler 拒绝非绝对路径", () => {
	assert.throws(() => createAssetsHandler({ builtinRoot: "themes", packsRoot }), TypeError);
	assert.throws(() => createAssetsHandler({ builtinRoot, packsRoot: "" }), TypeError);
	assert.throws(() => createAssetsHandler(null), TypeError);
});
