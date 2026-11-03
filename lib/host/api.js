/**
 * Host-side JSON API: POST /dsh-tavern-skin/api
 *
 * Fenced like dream-skin's persistence route (补查报告 §2.3):
 *   - only loopback / configured trustedHosts authorities;
 *   - same-origin browser markers (Sec-Fetch-Site / Origin);
 *   - then the host's own session check (`connection.requestRejection`).
 *
 * Methods (Step 6 契约 §2.1):
 *   state.get                 → {...state, fresh}          (扁平形状，Step 3–5 兼容)
 *   state.set {state, includeUi?} → 写后的 state（includeUi !== true 时保留磁盘 ui）
 *   packs.list                → { builtin, user, counts, limits }
 *   packs.get { id }          → { pack, css, builtin, source }
 *   packs.import { ... }      → 见 packs-io.js（folder / bundle / dreamskin）
 *   packs.export { id }       → { fileName, bytes, fileCount, bundle }
 *   packs.delete { id }       → { id, trashId }
 *   trash.list                → { entries, count }
 *   trash.restore { trashId } → { trashId, id, restoredTo, renamed }
 *   trash.purge { trashId }   → { trashId, removed: true }
 *   diag.caps                 → 传输/业务上限常量（验收比对实现与实测）
 *
 * 传输（契约 §2.3）：MAX_BODY_BYTES = 48 MB，超限返回 **413 可读 JSON**
 * （`payload-too-large`），不再裸 `req.destroy()`；业务导入上限 24 MB 由 packs-io 判。
 */
import { readState, writeState } from "./store.js";
import {
	MAX_BODY_BYTES,
	deletePack,
	diagCaps,
	exportPack,
	getPack,
	importPack,
	listTrash,
	packsList,
	purgeTrash,
	restoreTrash
} from "./packs-io.js";

const API_PREFIX = "/dsh-tavern-skin/api";
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");
const INVALID_JSON = Symbol("invalid-json");

function parseAuthority(authority) {
	try { return new URL(`http://${authority}`); } catch { return undefined; }
}

function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === undefined) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
			? entryUrl.hostname === hostUrl.hostname
			: entryUrl.host === hostUrl.host;
	});
}

function trustedHosts(ctx) {
	for (const service of ["webRuntime", "connection", "webStartup"]) {
		const hosts = ctx.get(service)?.trustedHosts;
		if (Array.isArray(hosts)) return hosts;
	}
	return [];
}

function isTrustedApiRequest(req, hosts) {
	const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
	if (host === undefined) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === undefined) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, hosts)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

export function sendJson(res, status, value, extraHeaders = {}) {
	const body = Buffer.from(JSON.stringify(value));
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.length,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
		...extraHeaders
	});
	res.end(body);
}

function declaredContentLength(headers) {
	const raw = headers ? headers["content-length"] : undefined;
	if (raw === undefined) return null;
	const value = Array.isArray(raw) ? raw[0] : raw;
	const size = Number(value);
	return Number.isFinite(size) && size >= 0 ? size : null;
}

function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		req.on("data", (chunk) => {
			if (settled) return;
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				// 不裸 destroy：先停下缓冲，由调用方回 413 可读 JSON。
				try { req.pause(); } catch { /* 有些测试桩没有 pause */ }
				finish(PAYLOAD_TOO_LARGE);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (settled) return;
			try { finish(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
			catch { finish(INVALID_JSON); }
		});
		req.on("error", () => finish(INVALID_JSON));
	});
}

// ── 结果封装 ────────────────────────────────────────────────────────────────

const okValue = (value, status = 200) => ({ status, value: { ok: true, value } });

function unwrap(result) {
	if (result && result.ok === true) return okValue(result.value, result.status && result.status !== 200 ? result.status : 200);
	return {
		status: result && Number.isInteger(result.status) ? result.status : 500,
		value: { ok: false, error: result && result.error ? result.error : { code: "internal", message: "内部错误" } }
	};
}

const failValue = (status, code, message, details) => ({
	status,
	value: { ok: false, error: { code, message, ...(details && details.length > 0 ? { details } : {}) } }
});

function badRequest(message) {
	return failValue(400, "bad-request", message);
}

// ── 方法分发 ────────────────────────────────────────────────────────────────

async function dispatch(ctx, request) {
	if (!request || typeof request !== "object" || Array.isArray(request)) return badRequest("请求体必须是 JSON 对象");
	const method = request.method;
	const args = request.args && typeof request.args === "object" && !Array.isArray(request.args) ? request.args : {};
	switch (method) {
		case "state.get": {
			const result = readState();
			return okValue({ ...result.state, fresh: result.fresh === true });
		}
		case "state.set": {
			const written = writeState(args.state, { includeUi: args.includeUi === true });
			if (!written || !written.ok) return failValue(400, "invalid-state", written && written.error ? written.error : "state 不合法");
			return okValue({ ...written.state, fresh: false });
		}
		case "packs.list":
			return unwrap(packsList());
		case "packs.get":
			return unwrap(getPack(args));
		case "packs.import":
			return unwrap(importPack(args));
		case "packs.export":
			return unwrap(exportPack(args));
		case "packs.delete":
			return unwrap(deletePack(args));
		case "trash.list": {
			const listed = listTrash();
			return okValue({ entries: listed.entries, count: listed.count });
		}
		case "trash.restore":
			return unwrap(restoreTrash(args.trashId));
		case "trash.purge":
			return unwrap(purgeTrash(args.trashId));
		case "diag.caps":
			return okValue(diagCaps());
		default:
			return failValue(400, "unknown-method", `未知方法：${String(method).slice(0, 60)}`);
	}
}

/**
 * 构造 API handler（宿主与测试共用同一实现）。
 * @param {{get: (service: string) => any}} ctx host cordis context
 */
export function createApiHandler(ctx) {
	return async function apiHandler(req, res) {
		if (req.method !== "POST") {
			sendJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "只接受 POST" } }, { allow: "POST" });
			return;
		}
		if (!isTrustedApiRequest(req, trustedHosts(ctx))) {
			sendJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
			return;
		}
		const connection = ctx.get("connection");
		const rejection = typeof connection?.requestRejection === "function" ? connection.requestRejection(req) : 503;
		if (rejection) {
			sendJson(res, rejection, { ok: false, error: { code: rejection === 401 ? "unauthorized" : rejection === 403 ? "forbidden" : "unavailable", message: "session check failed" } });
			return;
		}

		// 传输自卫：先看 content-length，超过 48 MB 直接 413 可读 JSON。
		const declared = declaredContentLength(req.headers);
		if (declared !== null && declared > MAX_BODY_BYTES) {
			sendJson(res, 413, {
				ok: false,
				error: {
					code: "payload-too-large",
					message: `请求体 ${(declared / 1024 / 1024).toFixed(2)} MB 超过传输上限 ${(MAX_BODY_BYTES / 1024 / 1024).toFixed(0)} MB（业务导入上限为 24 MB）`
				}
			}, { connection: "close" });
			try { req.resume(); } catch { /* 测试桩可能没有 resume */ }
			return;
		}

		const body = await readJsonBody(req);
		if (body === PAYLOAD_TOO_LARGE) {
			sendJson(res, 413, {
				ok: false,
				error: { code: "payload-too-large", message: `请求体超过传输上限 ${(MAX_BODY_BYTES / 1024 / 1024).toFixed(0)} MB` }
			}, { connection: "close" });
			try { req.resume(); } catch { /* 测试桩可能没有 resume */ }
			return;
		}
		if (body === INVALID_JSON) {
			sendJson(res, 400, { ok: false, error: { code: "bad-request", message: "请求体不是合法 JSON" } });
			return;
		}
		try {
			const result = await dispatch(ctx, body);
			sendJson(res, result.status, result.value);
		} catch (error) {
			console.error("[dsh-tavern-skin-engine] API error:", error);
			sendJson(res, 500, { ok: false, error: { code: "internal", message: "内部错误" } });
		}
	};
}

export function registerApi(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: createApiHandler(ctx)
	}), "dsh-tavern-skin-engine: JSON API");
}

export { MAX_BODY_BYTES, dispatch };
