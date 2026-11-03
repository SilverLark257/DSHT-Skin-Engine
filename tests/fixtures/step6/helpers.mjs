/**
 * Step 6 宿主测试公共工具（文件名不匹配 `*.test.mjs`，不会被 node --test 当作用例执行）。
 *
 * 纪律：每个用例用临时 `DSH_HOME`（mkdtemp）+ 自动清理；fixtures 只读。
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURES = new URL("./", import.meta.url);

export const REQUIRED_TOKENS = Object.freeze({
	"--dsw-alias-bg-base": "#FAF9F5",
	"--dsw-alias-bg-layer-1": "#FFFDF8",
	"--dsw-alias-brand-primary": "#CC785C",
	"--dsw-alias-label-primary": "#2E2921",
	"--dsw-alias-label-secondary": "#6B6459",
	"--dsw-alias-border-l1": "#E6E0D6",
	"--dsw-alias-border-l2": "#D5CDC1"
});

/** 一个最小合法 v1 包（可覆盖任意顶层字段）。 */
export function packOf(overrides = {}) {
	return {
		format: "dshte.theme",
		formatVersion: 1,
		release: "1.0.0",
		id: "fixture-pack",
		name: "Fixture Pack",
		colorScheme: "light",
		tokens: { light: { ...REQUIRED_TOKENS } },
		...overrides
	};
}

// ── fixtures ────────────────────────────────────────────────────────────────

export function fixtureBuffer(rel) {
	return readFileSync(new URL(rel, FIXTURES));
}

export function fixtureText(rel) {
	return fixtureBuffer(rel).toString("utf8");
}

export function fixtureJson(rel) {
	return JSON.parse(fixtureText(rel));
}

export function fixtureBase64(rel) {
	return fixtureBuffer(rel).toString("base64");
}

export function base64OfText(text) {
	return Buffer.from(text, "utf8").toString("base64");
}

/** 读 fixtures 下一个目录，拼成 folder 导入所需的 `{ 相对路径: 纯 base64 }`。 */
export function folderFiles(dirRel, overrides = {}) {
	const files = {};
	const walk = (url, prefix) => {
		for (const entry of readdirSync(url, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
			if (entry.isDirectory()) walk(child, rel);
			else files[rel] = readFileSync(child).toString("base64");
		}
	};
	walk(new URL(`${dirRel.replace(/\/+$/, "")}/`, FIXTURES), "");
	for (const [rel, value] of Object.entries(overrides)) {
		files[rel] = Buffer.isBuffer(value) ? value.toString("base64") : base64OfText(String(value));
	}
	return files;
}

// ── 临时 DSH_HOME / 磁盘断言 ────────────────────────────────────────────────

export function makeTempHome(t) {
	const home = mkdtempSync(join(tmpdir(), "dshte-step6-host-"));
	process.env.DSH_HOME = home;
	t.after(() => {
		delete process.env.DSH_HOME;
		try { rmSync(home, { recursive: true, force: true }); } catch { /* 忽略 */ }
	});
	return home;
}

export function dataRoot() {
	return join(process.env.DSH_HOME, "profile-data", "tavern", "data", "skin-engine");
}

export function packsRoot() {
	return join(dataRoot(), "packs");
}

export function trashRoot() {
	return join(dataRoot(), "trash");
}

/** 递归列出目录下的文件（POSIX 相对路径，已排序）；目录不存在返回 []。 */
export function listFiles(root) {
	const out = [];
	const walk = (dir, prefix) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else out.push(rel);
		}
	};
	walk(root, "");
	out.sort();
	return out;
}

/** 顶层目录名（已排序）。 */
export function listDirs(root) {
	try {
		return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	} catch {
		return [];
	}
}

export function fileSize(file) {
	try {
		return statSync(file).size;
	} catch {
		return -1;
	}
}

// ── HTTP 测试桩 ─────────────────────────────────────────────────────────────

export function makeApiContext(options = {}) {
	const trustedHosts = options.trustedHosts || [];
	const rejection = options.requestRejection === undefined ? null : options.requestRejection;
	return {
		get(service) {
			if (service === "webRuntime") return { trustedHosts };
			if (service === "connection") return { requestRejection: typeof rejection === "function" ? rejection : () => rejection };
			return undefined;
		}
	};
}

/** 伪造 IncomingMessage（EventEmitter + headers/method/pause/resume）。 */
export function makeRequest(options = {}) {
	const req = new EventEmitter();
	req.method = options.method || "POST";
	req.headers = options.headers || {};
	req.url = options.url || "/dsh-tavern-skin/api";
	req.pause = () => {};
	req.resume = () => {};
	req.body = options.body;
	return req;
}

/** 伪造 ServerResponse；`waitEnded()` 在 res.end() 后 resolve。 */
export function makeResponse() {
	const res = {
		status: null,
		headers: null,
		body: null,
		ended: false
	};
	let resolveEnded;
	res.endedPromise = new Promise((resolve) => { resolveEnded = resolve; });
	res.writeHead = (status, headers) => {
		res.status = status;
		res.headers = headers || {};
		return res;
	};
	res.end = (body) => {
		res.body = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
		res.ended = true;
		try { res.json = res.body ? JSON.parse(res.body.toString("utf8")) : null; } catch { res.json = null; }
		resolveEnded();
	};
	res.waitEnded = () => res.endedPromise;
	return res;
}

/** 驱动一次 handler 调用：先异步喂 body（若有），再等响应结束。 */
export async function callHandler(handler, options = {}) {
	const req = makeRequest(options);
	const res = makeResponse();
	const pending = handler(req, res);
	await Promise.resolve();
	if (options.body !== undefined) {
		const raw = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
		req.emit("data", Buffer.from(raw, "utf8"));
	}
	req.emit("end");
	await Promise.race([pending, res.waitEnded()]);
	await res.waitEnded();
	return { req, res };
}

export const TRUSTED_HEADERS = Object.freeze({
	host: "127.0.0.1:56963",
	"sec-fetch-site": "same-origin",
	origin: "http://127.0.0.1:56963"
});
