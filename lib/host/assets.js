/**
 * 静态资源路由：/dsh-tavern-skin/assets（方案 §2.6 / §6.5）
 *
 *   GET|HEAD /dsh-tavern-skin/assets/builtin/<packId>/<relPath>
 *     → 插件根 themes/<packId>/<relPath>
 *   GET|HEAD /dsh-tavern-skin/assets/pack/<packId>/<relPath>
 *     → <DSH_HOME>/profile-data/tavern/data/skin-engine/packs/<packId>/<relPath>
 *
 * 只服务字体/图片白名单扩展名（复用 pack-schema 的 FILE_EXTENSIONS），
 * 同源相对路径，v1 不加 CORS 头。注册为 prefix 且**不带尾斜杠**：
 * `/dsh-tavern-skin/assets` 精确命中、`/dsh-tavern-skin/assets/` 都不算合法资源路径，
 * 一律 404（避免 dream-skin `/dream-skin/fonts/` 那种“拼出双斜杠才匹配”的路径歧义）。
 *
 * 安全边界（任何一条不满足都是 404，不回显真实路径）：
 *   - 只接受 GET / HEAD；
 *   - <relPath> 先 decodeURIComponent（失败 → 400），再拒绝空、绝对、反斜杠、NUL、
 *     `.` / `..` 段、尾斜杠；
 *   - resolve 后必须仍在 root 内；再用 realpath 复核（防符号链接逃逸）；
 *   - 只服务 stat().isFile() 且扩展名在白名单内的文件；
 *   - 所有响应都带 x-content-type-options: nosniff。
 */
import { createReadStream, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { FILE_EXTENSIONS } from "../../src/shared/pack-schema.js";
import { skinEngineDataDir } from "./paths.js";

/** 注册路径：host 半边的 prefix 路由（无尾斜杠）。 */
export const ASSETS_ROUTE = "/dsh-tavern-skin/assets";

const ROUTE_PREFIX = ASSETS_ROUTE + "/";
const THEMES_ROOT = fileURLToPath(new URL("../../themes/", import.meta.url));

const CONTENT_TYPES = Object.freeze({
	woff2: "font/woff2",
	woff: "font/woff",
	ttf: "font/ttf",
	otf: "font/otf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	svg: "image/svg+xml; charset=utf-8",
	avif: "image/avif"
});

/** 字体 + 图片扩展名（不含 document：CSS/JSON 走 API 的 packs.get，不从这里发）。 */
const ALLOWED_EXTENSIONS = new Set([...FILE_EXTENSIONS.font, ...FILE_EXTENSIONS.image]);

/** 内容哈希文件名（如 montserrat-regular-9f3a1c2d.woff2）才允许长缓存。 */
const HASHED_NAME_RE = /[0-9a-f]{8,}/;

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const PLAIN_CACHE = "no-cache";

// ── 响应工具 ────────────────────────────────────────────────────────────────

function sendJson(res, status, value, extraHeaders = {}) {
	const body = Buffer.from(JSON.stringify(value));
	res.writeHead(status, {
		"x-content-type-options": "nosniff",
		"content-type": "application/json; charset=utf-8",
		"content-length": body.length,
		"cache-control": "no-store",
		...extraHeaders
	});
	res.end(body);
}

function notFound(res) {
	sendJson(res, 404, { ok: false, error: { code: "not-found" } });
}

// ── URL 解析 ────────────────────────────────────────────────────────────────

/**
 * 把 URL 解析成 { kind, relPath }；query string 直接丢弃。
 * @returns {{ status: number, kind?: "builtin"|"pack", relPath?: string }}
 */
function parseTarget(rawUrl) {
	if (typeof rawUrl !== "string") return { status: 404 };
	const pathname = rawUrl.split("?")[0].split("#")[0];
	if (!pathname.startsWith(ROUTE_PREFIX)) return { status: 404 };
	let decoded;
	try {
		decoded = decodeURIComponent(pathname.slice(ROUTE_PREFIX.length));
	} catch {
		// 非法百分号编码：契约要求 400（不是 404），但不回显原始输入。
		return { status: 400 };
	}
	if (decoded.length === 0) return { status: 404 };
	if (decoded.startsWith("/") || decoded.startsWith("\\")) return { status: 404 };
	if (decoded.includes("\\") || decoded.includes("\0")) return { status: 404 };
	if (decoded.endsWith("/")) return { status: 404 };
	const segments = decoded.split("/");
	for (const segment of segments) {
		if (segment === "" || segment === "." || segment === "..") return { status: 404 };
	}
	const kind = segments[0];
	if (kind !== "builtin" && kind !== "pack") return { status: 404 };
	// kind + packId + 至少一段 relPath。
	if (segments.length < 3) return { status: 404 };
	// 文件系统侧路径是 <packId>/<relPath>（packId 段已在上面的循环里做过安全校验）。
	return { status: 200, kind, relPath: segments.slice(1).join("/") };
}

// ── 文件定位与校验 ──────────────────────────────────────────────────────────

/**
 * realpath 复核：物理文件必须仍在物理 root 内（防符号链接/junction 逃逸）。
 * root 或文件不存在时返回 false（调用方按 404 处理）。
 */
function insideRealRoot(base, file) {
	let realBase;
	let realFile;
	try {
		realBase = realpathSync(base);
		realFile = realpathSync(file);
	} catch {
		return false;
	}
	return realFile === realBase || realFile.startsWith(realBase + sep);
}

function cacheControlFor(file) {
	return HASHED_NAME_RE.test(basename(file)) ? IMMUTABLE_CACHE : PLAIN_CACHE;
}

// ── 条件请求 / Range ────────────────────────────────────────────────────────

/** 强 ETag：`"<size>-<mtimeMs>"`，纯 ASCII、单层引号。 */
function etagFor(info) {
	return `"${info.size}-${Math.floor(info.mtimeMs)}"`;
}

/** If-None-Match 宽松比较：支持逗号分隔、`W/` 前缀、`*`。 */
function etagMatches(header, etag) {
	if (typeof header !== "string") return false;
	return header.split(",").some((candidate) => {
		const value = candidate.trim();
		if (value === "*") return true;
		return value.replace(/^W\//, "") === etag;
	});
}

/**
 * 单段 Range 解析。
 * @returns {null | { unsatisfiable: true } | { unsatisfiable?: false, start: number, end: number }}
 *   null 表示“忽略 Range，回 200 全量”（多段、非法单位、语法坏、start>end 都走这里）。
 */
function parseSingleRange(header, size) {
	if (typeof header !== "string") return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (match === null) return null;
	const rawStart = match[1];
	const rawEnd = match[2];
	if (rawStart === "" && rawEnd === "") return null;
	if (rawStart !== "") {
		const start = Number(rawStart);
		if (!Number.isSafeInteger(start)) return null;
		if (start >= size) return { unsatisfiable: true };
		if (rawEnd === "") return { start, end: size - 1 };
		const end = Number(rawEnd);
		if (!Number.isSafeInteger(end) || end < start) return null;
		return { start, end: Math.min(end, size - 1) };
	}
	const suffix = Number(rawEnd);
	if (!Number.isSafeInteger(suffix)) return null;
	if (suffix <= 0 || size === 0) return { unsatisfiable: true };
	return { start: Math.max(0, size - suffix), end: size - 1 };
}

// ── 主逻辑 ──────────────────────────────────────────────────────────────────

async function handleRequest(req, res, roots) {
	const method = String(req.method || "").toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		sendJson(res, 405, { ok: false, error: { code: "method-not-allowed" } }, { allow: "GET, HEAD" });
		return;
	}

	const target = parseTarget(req.url);
	if (target.status === 400) {
		sendJson(res, 400, { ok: false, error: { code: "bad-request" } });
		return;
	}
	if (target.status !== 200) {
		notFound(res);
		return;
	}

	const base = resolve(roots[target.kind]);
	const file = resolve(base, target.relPath);
	// 双保险：即使上面的段校验被绕过，也不能跑出 root。
	if (file === base || !file.startsWith(base + sep)) {
		notFound(res);
		return;
	}

	const extension = extname(file).slice(1).toLowerCase();
	if (!ALLOWED_EXTENSIONS.has(extension)) {
		notFound(res);
		return;
	}

	let info;
	try {
		info = statSync(file);
	} catch (error) {
		// 目录不存在 / 中间段不是目录 → 404；其它 I/O 错误冒泡成 500。
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			notFound(res);
			return;
		}
		throw error;
	}
	if (!info.isFile()) {
		notFound(res);
		return;
	}
	if (!insideRealRoot(base, file)) {
		notFound(res);
		return;
	}

	const total = info.size;
	const etag = etagFor(info);
	const headers = {
		"x-content-type-options": "nosniff",
		"content-type": CONTENT_TYPES[extension],
		"cache-control": cacheControlFor(file),
		etag,
		"accept-ranges": "bytes"
	};
	const requestHeaders = req.headers || {};

	if (etagMatches(requestHeaders["if-none-match"], etag)) {
		res.writeHead(304, headers);
		res.end();
		return;
	}

	const range = parseSingleRange(requestHeaders.range, total);
	if (range !== null && range.unsatisfiable === true) {
		res.writeHead(416, { ...headers, "content-range": `bytes */${total}`, "content-length": 0 });
		res.end();
		return;
	}

	if (range !== null) {
		headers["content-range"] = `bytes ${range.start}-${range.end}/${total}`;
		headers["content-length"] = range.end - range.start + 1;
	} else {
		headers["content-length"] = total;
	}
	res.writeHead(range === null ? 200 : 206, headers);

	// HEAD 只回头；Range + HEAD 也是 206 头、零 body。
	if (method === "HEAD" || total === 0) {
		res.end();
		return;
	}

	const stream = createReadStream(file, range === null ? undefined : { start: range.start, end: range.end });
	try {
		// 流式返回，绝不把字体/图片整块读进内存。
		await pipeline(stream, res);
	} catch (error) {
		// 客户端提前断开时 res 已经不可写，不是服务端故障。
		if (res.destroyed || res.writableEnded) return;
		throw error;
	}
}

// ── 导出 ────────────────────────────────────────────────────────────────────

function absoluteRoot(value, name) {
	if (typeof value !== "string" || !isAbsolute(value)) {
		throw new TypeError(`createAssetsHandler: ${name} 必须是绝对路径字符串`);
	}
	return resolve(value);
}

/**
 * 构造资源 handler（测试与宿主共用同一实现）。
 * @param {{ builtinRoot: string, packsRoot: string }} options 两个绝对路径。
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>}
 */
export function createAssetsHandler(options) {
	if (options === null || typeof options !== "object") {
		throw new TypeError("createAssetsHandler 需要 { builtinRoot, packsRoot }");
	}
	const roots = Object.freeze({
		builtin: absoluteRoot(options.builtinRoot, "builtinRoot"),
		pack: absoluteRoot(options.packsRoot, "packsRoot")
	});
	return async function assetsHandler(req, res) {
		try {
			await handleRequest(req, res, roots);
		} catch (error) {
			console.error("[dsh-tavern-skin-engine] assets error:", error);
			if (res.headersSent) {
				if (typeof res.destroy === "function") res.destroy();
				return;
			}
			sendJson(res, 500, { ok: false, error: { code: "internal" } });
		}
	};
}

/**
 * 宿主挂载：themes 真实根 + skin-engine 数据根下的 packs/。
 * @param ctx host cordis context（注入 webServer）。
 */
export function registerAssets(ctx) {
	const handler = createAssetsHandler({
		builtinRoot: THEMES_ROOT,
		packsRoot: join(skinEngineDataDir(), "packs")
	});
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ASSETS_ROUTE,
		handler
	}), `dsh-tavern-skin-engine: ${ASSETS_ROUTE}`);
	return ASSETS_ROUTE;
}
