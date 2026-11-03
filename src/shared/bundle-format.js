/**
 * dsh-tavern-skin-engine — `.dshte.json` exchange format (v1).
 *
 * A theme pack lives on disk as a directory (`theme.json` + optional
 * `theme.css` + `assets/`). For sharing we wrap it into ONE JSON file:
 *
 *   {
 *     "format": "dshte.bundle",
 *     "formatVersion": 1,
 *     "exportedAt": "...",
 *     "engineVersion": "0.1.0",
 *     "pack": { ...theme.json verbatim... },
 *     "files": { "theme.css": "<text>", "assets/images/x.png": "data:image/png;base64,..." }
 *   }
 *
 * Text files stay plain strings; binary files become data: URLs. Everything
 * is validated on the way in (paths, base64, decoded sizes, pack schema).
 *
 * Pure module: no Node/DOM APIs; base64 helpers are hand-written so the same
 * code runs in the host half, the browser half and `pack-check`.
 */

import {
	LIMITS,
	ENGINE_VERSION,
	checkPackPath,
	validateFileManifest,
	validateThemePack
} from "./pack-schema.js";

export const BUNDLE_FORMAT = "dshte.bundle";
export const BUNDLE_FORMAT_VERSION = 1;

/** Hard ceiling for the raw `.dshte.json` text (24 MB; base64 inflation + JSON overhead). */
export const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(["css", "json", "md", "txt"]);
const MIME_BY_EXTENSION = {
	woff2: "font/woff2",
	woff: "font/woff",
	ttf: "font/ttf",
	otf: "font/otf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
	css: "text/css",
	json: "application/json",
	md: "text/markdown",
	txt: "text/plain"
};

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
	const table = new Int16Array(256).fill(-1);
	for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
	return table;
})();

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const issue = (path, code, message) => ({ path, code, message });
const extensionOf = (path) => {
	const match = /\.([A-Za-z0-9]+)$/.exec(path);
	return match ? match[1].toLowerCase() : "";
};
const isTextPath = (path) => TEXT_EXTENSIONS.has(extensionOf(path));

export function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ── base64 (bytes ⇄ ASCII), no Buffer/btoa dependency ──────────────────────

export function bytesToBase64(bytes) {
	let output = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i];
		const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
		const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
		const triple = (a << 16) | (b << 8) | c;
		output += B64_ALPHABET[(triple >> 18) & 63];
		output += B64_ALPHABET[(triple >> 12) & 63];
		output += i + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 63] : "=";
		output += i + 2 < bytes.length ? B64_ALPHABET[triple & 63] : "=";
	}
	return output;
}

export function base64ToBytes(text) {
	if (typeof text !== "string") throw new Error("base64 内容必须是字符串");
	if (text.length % 4 !== 0) throw new Error("base64 长度不是 4 的倍数");
	const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
	const bytes = new Uint8Array((text.length / 4) * 3 - padding);
	let offset = 0;
	for (let i = 0; i < text.length; i += 4) {
		const chunk = text.slice(i, i + 4);
		let triple = 0;
		for (let j = 0; j < 4; j++) {
			const char = chunk[j];
			if (char === "=") { triple <<= 6; continue; }
			const value = B64_LOOKUP[char.charCodeAt(0)];
			if (value < 0) throw new Error(`base64 含非法字符「${char}」`);
			triple = (triple << 6) | value;
		}
		if (offset < bytes.length) bytes[offset++] = (triple >> 16) & 255;
		if (offset < bytes.length) bytes[offset++] = (triple >> 8) & 255;
		if (offset < bytes.length) bytes[offset++] = triple & 255;
	}
	return bytes;
}

// ── file encoding ─────────────────────────────────────────────────────────

/** Encode one pack file: text stays a string, binary becomes a data: URL. */
export function encodeFileData(path, data) {
	if (typeof data === "string") {
		if (isTextPath(path)) return data;
		const bytes = encoder.encode(data);
		return toDataUrl(path, bytes);
	}
	if (data instanceof Uint8Array) {
		if (isTextPath(path)) return decoder.decode(data);
		return toDataUrl(path, data);
	}
	throw new Error(`文件「${path}」的数据必须是字符串或 Uint8Array`);
}

/** Decode one bundle file value back to bytes. */
export function decodeFileData(path, value) {
	if (typeof value !== "string") throw new Error(`文件「${path}」的值必须是字符串`);
	if (isTextPath(path)) return encoder.encode(value);
	const match = /^data:([^;,]*);base64,([A-Za-z0-9+/=]+)$/.exec(value);
	if (!match) {
		if (value.startsWith("data:")) throw new Error(`文件「${path}」的 data URL 不合法（需要 data:<mime>;base64,<合法 base64>）`);
		throw new Error(`文件「${path}」是二进制，值必须是 data:<mime>;base64,<数据>`);
	}
	return base64ToBytes(match[2]);
}

function toDataUrl(path, bytes) {
	const mime = MIME_BY_EXTENSION[extensionOf(path)] || "application/octet-stream";
	return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Byte length of the decoded file (works for text and data URLs). */
export function decodedSize(path, value) {
	try {
		return decodeFileData(path, value).length;
	} catch {
		return -1;
	}
}

// ── build ─────────────────────────────────────────────────────────────────

/**
 * Wrap a parsed theme.json + its files into the exchange object.
 * @param {{pack: object, files: Record<string, string|Uint8Array>|Map<string, string|Uint8Array>, engineVersion?: string, exportedAt?: string, now?: () => string}} input
 * @returns {{ok: boolean, errors: object[], warnings: object[], bundle: object|null, stats: object|null}}
 */
export function buildBundle(input) {
	const errors = [];
	const warnings = [];
	const pack = input && input.pack;
	const filesInput = (input && input.files) || {};
	const entries = filesInput instanceof Map ? [...filesInput.entries()] : Object.entries(filesInput);
	const files = {};
	let total = 0;
	for (const [path, data] of entries) {
		const pathProblem = checkPackPath(path);
		if (pathProblem) { errors.push(issue(`files["${path}"]`, "unsafe-path", `文件路径不安全：${pathProblem}`)); continue; }
		if (path === "theme.json") { errors.push(issue(`files["${path}"]`, "reserved-file", "theme.json 已内嵌在 bundle.pack 里，不要放进 files")); continue; }
		try {
			const encoded = encodeFileData(path, data);
			const size = decodedSize(path, encoded);
			if (size < 0) { errors.push(issue(`files["${path}"]`, "encode", `文件「${path}」编码失败`)); continue; }
			if (size > LIMITS.fileBytes) errors.push(issue(`files["${path}"]`, "file-too-large", `文件「${path}」${formatBytes(size)}，超过单文件上限 ${formatBytes(LIMITS.fileBytes)}`));
			files[path] = encoded;
			total += size;
		} catch (error) {
			errors.push(issue(`files["${path}"]`, "encode", `文件「${path}」编码失败：${error && error.message ? error.message : String(error)}`));
		}
	}
	if (total > LIMITS.packBytes) errors.push(issue("files", "pack-too-large", `包总大小 ${formatBytes(total)} 超过上限 ${formatBytes(LIMITS.packBytes)}`));
	const manifest = validateFileManifest(Object.keys(files).map((path) => ({ path, size: decodedSize(path, files[path]) })));
	if (!manifest.ok) errors.push(...manifest.errors);
	warnings.push(...manifest.warnings);
	const bundle = errors.length === 0 ? {
		format: BUNDLE_FORMAT,
		formatVersion: BUNDLE_FORMAT_VERSION,
		exportedAt: input.exportedAt || (input.now ? input.now() : new Date().toISOString()),
		engineVersion: input.engineVersion || ENGINE_VERSION,
		pack,
		files
	} : null;
	return { ok: errors.length === 0, errors, warnings, bundle, stats: { fileCount: Object.keys(files).length, totalBytes: total } };
}

export function stringifyBundle(bundle) {
	return JSON.stringify(bundle, null, 2) + "\n";
}

// ── parse / validate ──────────────────────────────────────────────────────

/**
 * Parse and validate a `.dshte.json` (string or already-parsed object).
 * @param {string|object} input
 * @param {{engineVersion?: string, limits?: object, maxBundleBytes?: number, validatePack?: boolean}} [options]
 */
export function parseBundle(input, options = {}) {
	const engineVersion = options.engineVersion || ENGINE_VERSION;
	const limits = { ...LIMITS, ...(options.limits || {}) };
	const maxBundleBytes = options.maxBundleBytes || MAX_BUNDLE_BYTES;
	const errors = [];
	const warnings = [];
	let bundle = input;
	let text = null;

	if (typeof input === "string") {
		text = input;
		const bytes = encoder.encode(text).length;
		if (bytes > maxBundleBytes) return { ok: false, errors: [issue("$", "bundle-too-large", `bundle 文本 ${formatBytes(bytes)}，超过上限 ${formatBytes(maxBundleBytes)}`)], warnings, bundle: null, pack: null, files: null, stats: null };
		try { bundle = JSON.parse(text); }
		catch (error) { return { ok: false, errors: [issue("$", "json-parse", `bundle 不是合法 JSON：${error && error.message ? error.message : String(error)}`)], warnings, bundle: null, pack: null, files: null, stats: null }; }
	}
	if (!isPlainObject(bundle)) return { ok: false, errors: [issue("$", "type", "bundle 顶层必须是对象")], warnings, bundle: null, pack: null, files: null, stats: null };
	if (bundle.format !== BUNDLE_FORMAT) errors.push(issue("format", "value", `bundle format 必须是 "${BUNDLE_FORMAT}"，当前是 ${JSON.stringify(bundle.format)}`));
	if (bundle.formatVersion !== BUNDLE_FORMAT_VERSION) errors.push(issue("formatVersion", "value", `bundle formatVersion 必须是 ${BUNDLE_FORMAT_VERSION}，当前是 ${JSON.stringify(bundle.formatVersion)}`));
	if (bundle.exportedAt !== undefined && typeof bundle.exportedAt !== "string") errors.push(issue("exportedAt", "type", "exportedAt 必须是字符串"));
	if (bundle.engineVersion !== undefined) {
		if (typeof bundle.engineVersion !== "string" || !/^\d+\.\d+\.\d+/.test(bundle.engineVersion)) errors.push(issue("engineVersion", "type", "engineVersion 必须是 semver 字符串"));
		else if (Number(bundle.engineVersion.split(".")[0]) > Number(engineVersion.split(".")[0])) warnings.push(issue("engineVersion", "newer-engine", `bundle 由更新的引擎 ${bundle.engineVersion} 导出（当前 ${engineVersion}），未知字段会被忽略`));
	}
	if (!isPlainObject(bundle.pack)) errors.push(issue("pack", "type", "bundle.pack 必须是对象（theme.json 的内容）"));
	if (!isPlainObject(bundle.files)) errors.push(issue("files", "type", "bundle.files 必须是 { 路径: 内容 } 对象"));
	for (const key of Object.keys(bundle)) {
		if (!["format", "formatVersion", "exportedAt", "engineVersion", "pack", "files"].includes(key)) warnings.push(issue(key, "unknown-field", `bundle 不认识字段「${key}」，会被忽略`));
	}

	const packResult = isPlainObject(bundle.pack) ? validateThemePack(bundle.pack, { engineVersion }) : { ok: false, errors: [], warnings: [] };
	if (options.validatePack !== false && isPlainObject(bundle.pack)) {
		for (const item of packResult.errors) errors.push({ ...item, path: item.path === "$" ? "pack" : `pack.${item.path}` });
		warnings.push(...packResult.warnings);
	}

	const files = new Map();
	const manifest = [];
	if (isPlainObject(bundle.files)) {
		for (const [path, value] of Object.entries(bundle.files)) {
			const pathProblem = checkPackPath(path);
			if (pathProblem) { errors.push(issue(`files["${path}"]`, "unsafe-path", `文件路径不安全：${pathProblem}`)); continue; }
			if (path === "theme.json") { errors.push(issue(`files["${path}"]`, "reserved-file", "theme.json 不能出现在 files（已内嵌在 pack）")); continue; }
			try {
				const bytes = decodeFileData(path, value);
				if (bytes.length > limits.fileBytes) errors.push(issue(`files["${path}"]`, "file-too-large", `文件「${path}」解码后 ${formatBytes(bytes.length)}，超过单文件上限 ${formatBytes(limits.fileBytes)}`));
				files.set(path, path.endsWith(".css") || path.endsWith(".md") || path.endsWith(".txt") || path.endsWith(".json") ? new TextDecoder().decode(bytes) : bytes);
				manifest.push({ path, size: bytes.length });
			} catch (error) {
				errors.push(issue(`files["${path}"]`, "decode", `文件「${path}」解码失败：${error && error.message ? error.message : String(error)}`));
			}
		}
	}
	const fileResult = validateFileManifest(manifest, { limits });
	if (!fileResult.ok) errors.push(...fileResult.errors);
	warnings.push(...fileResult.warnings);

	const stats = {
		fileCount: manifest.length,
		totalBytes: manifest.reduce((total, file) => total + file.size, 0),
		packErrors: packResult.errors.length,
		packWarnings: packResult.warnings.length
	};
	return { ok: errors.length === 0, errors, warnings, bundle, pack: bundle.pack || null, files, stats, packResult };
}
