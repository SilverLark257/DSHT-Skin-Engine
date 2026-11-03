/**
 * Host-side state store (方案 §1.7 / §5.4 / §6.7):
 *   - `state.json` is the authoritative copy (localStorage is only a first-paint seed);
 *   - every write backs up the previous file into `backups/` (keep the last 5);
 *   - atomic write: tmp file + rename, with a direct-write fallback for Windows locks.
 *
 * Step 6 (schema v2): adds `ui` so the browser preferences that used to live only
 * in localStorage become host-authoritative:
 *   ui.previewLive      live-preview toggle
 *   ui.userCss          user custom CSS draft {text,savedAt}
 *   ui.userFonts[]      local font uploads (data URL + metadata)
 *
 * `writeState(state, {includeUi})`: ordinary overrides writes call `state.set`
 * without the heavy `ui` payload. Unless the caller explicitly says
 * `includeUi: true`, the existing on-disk `ui` is preserved (v1 callers and
 * Step 3–5 clients keep working unchanged).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { statePath, backupsDir, skinEngineDataDir } from "./paths.js";

const MAX_STATE_BYTES = 10 * 1024 * 1024;
const MAX_UI_CSS_BYTES = 1024 * 1024;
const MAX_FONT_BYTES = 1.5 * 1024 * 1024;
const MAX_FONTS_BYTES = 4 * 1024 * 1024;
const MAX_FONTS = 20;
const MAX_BACKUPS = 5;
const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;
const TOKEN_RE = /^--(dsw|dsh-tavern|dshte)-[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FONT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const FONT_FAMILY_RE = /^dshte-user-[A-Za-z0-9_-]{1,40}$/;
const FONT_EXT_RE = /\.(woff2?|ttf|otf)$/i;
const FONT_STYLE = new Set(["normal", "italic"]);
const DATA_URL_RE = /^data:[^;,]*;base64,([A-Za-z0-9+/]+={0,2})$/;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const byteLength = (text) => Buffer.byteLength(text, "utf8");

export function defaultUi() {
	return { previewLive: true, userCss: { text: "", savedAt: null }, userFonts: [] };
}

export function defaultState() {
	return {
		format: "dshte.state",
		version: 2,
		activePackId: "cocreate-paper",
		enabled: true,
		schemePolicy: null,
		overrides: { light: {}, dark: {} },
		ui: defaultUi()
	};
}

function sanitizeUserCss(raw, out, errors) {
	if (raw === undefined || raw === null) { out.userCss = { text: "", savedAt: null }; return; }
	if (!isPlainObject(raw)) { errors.push("state.ui.userCss 必须是对象或 null"); return; }
	if (typeof raw.text !== "string") { errors.push("state.ui.userCss.text 必须是字符串"); return; }
	const bytes = byteLength(raw.text);
	if (bytes > MAX_UI_CSS_BYTES) { errors.push(`state.ui.userCss 超过 1 MB（${(bytes / 1024).toFixed(1)} KB）`); return; }
	if (raw.savedAt !== undefined && raw.savedAt !== null && typeof raw.savedAt !== "string") { errors.push("state.ui.userCss.savedAt 必须是字符串或 null"); return; }
	out.userCss = { text: raw.text, savedAt: typeof raw.savedAt === "string" ? raw.savedAt : null };
}

function sanitizeUserFonts(raw, out, errors) {
	if (raw === undefined || raw === null) { out.userFonts = []; return; }
	if (!Array.isArray(raw)) { errors.push("state.ui.userFonts 必须是数组"); return; }
	if (raw.length > MAX_FONTS) { errors.push(`state.ui.userFonts 最多 ${MAX_FONTS} 个（当前 ${raw.length}）`); return; }
	const fonts = [];
	let total = 0;
	raw.forEach((entry, index) => {
		const path = `state.ui.userFonts[${index}]`;
		if (!isPlainObject(entry)) { errors.push(`${path} 必须是对象`); return; }
		if (typeof entry.id !== "string" || !FONT_ID_RE.test(entry.id)) { errors.push(`${path}.id 不合法`); return; }
		if (typeof entry.family !== "string" || !FONT_FAMILY_RE.test(entry.family)) { errors.push(`${path}.family 必须形如 dshte-user-<id>`); return; }
		if (typeof entry.fileName !== "string" || entry.fileName.length > 120 || !FONT_EXT_RE.test(entry.fileName)) { errors.push(`${path}.fileName 必须是 woff2/woff/ttf/otf 文件名`); return; }
		if (typeof entry.dataUrl !== "string") { errors.push(`${path}.dataUrl 必须是字符串`); return; }
		const match = DATA_URL_RE.exec(entry.dataUrl);
		if (match === null) { errors.push(`${path}.dataUrl 必须是 data:<mime>;base64,<合法 base64>`); return; }
		let decoded;
		try { decoded = Buffer.from(match[1], "base64"); }
		catch { errors.push(`${path}.dataUrl base64 解码失败`); return; }
		if (decoded.length !== Number(entry.bytes)) { errors.push(`${path}.bytes 与实际解码大小不一致`); return; }
		if (decoded.length > MAX_FONT_BYTES) { errors.push(`${path} 超过单字体 1.5 MB`); return; }
		total += decoded.length;
		if (total > MAX_FONTS_BYTES) { errors.push("state.ui.userFonts 合计超过 4 MB"); return; }
		const weight = typeof entry.weight === "number" && entry.weight >= 1 && entry.weight <= 1000 ? entry.weight : 400;
		const style = FONT_STYLE.has(entry.style) ? entry.style : "normal";
		fonts.push({
			id: entry.id,
			family: entry.family,
			weight,
			style,
			fileName: entry.fileName,
			mime: typeof entry.mime === "string" ? entry.mime.slice(0, 100) : "",
			dataUrl: entry.dataUrl,
			bytes: decoded.length
		});
	});
	out.userFonts = fonts;
}

/** Normalize untrusted input into a safe state object (never throws). */
export function sanitizeState(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "state 必须是对象" };
	if (raw.format !== undefined && raw.format !== "dshte.state") return { ok: false, error: "state.format 必须是 dshte.state" };
	if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) return { ok: false, error: "state.version 必须是 1 或 2" };
	const out = defaultState();
	if (raw.activePackId === null) out.activePackId = null;
	else if (typeof raw.activePackId === "string" && ID_RE.test(raw.activePackId)) out.activePackId = raw.activePackId;
	else if (raw.activePackId !== undefined) return { ok: false, error: "state.activePackId 必须是 null 或合法 id" };
	if (raw.enabled !== undefined) {
		if (typeof raw.enabled !== "boolean") return { ok: false, error: "state.enabled 必须是布尔值" };
		out.enabled = raw.enabled;
	}
	if (raw.schemePolicy !== undefined && raw.schemePolicy !== null) {
		if (raw.schemePolicy !== "mirror" && raw.schemePolicy !== "inherit") return { ok: false, error: "state.schemePolicy 只能是 null/mirror/inherit" };
		out.schemePolicy = raw.schemePolicy;
	}
	if (raw.overrides !== undefined) {
		if (!raw.overrides || typeof raw.overrides !== "object" || Array.isArray(raw.overrides)) return { ok: false, error: "state.overrides 必须是对象" };
		for (const scheme of ["light", "dark"]) {
			const block = raw.overrides[scheme];
			if (block === undefined) continue;
			if (!block || typeof block !== "object" || Array.isArray(block)) return { ok: false, error: `state.overrides.${scheme} 必须是对象` };
			for (const [name, value] of Object.entries(block)) {
				if (!TOKEN_RE.test(name)) return { ok: false, error: `state.overrides.${scheme} 的 token 名不合法：${name}` };
				if (typeof value !== "string" || value.length > 2000) return { ok: false, error: `state.overrides.${scheme}["${name}"] 必须是字符串` };
				out.overrides[scheme][name] = value;
			}
		}
	}
	if (raw.ui !== undefined) {
		if (!isPlainObject(raw.ui)) return { ok: false, error: "state.ui 必须是对象" };
		const uiErrors = [];
		const ui = defaultUi();
		if (raw.ui.previewLive !== undefined) {
			if (typeof raw.ui.previewLive !== "boolean") return { ok: false, error: "state.ui.previewLive 必须是布尔值" };
			ui.previewLive = raw.ui.previewLive;
		}
		sanitizeUserCss(raw.ui.userCss, ui, uiErrors);
		sanitizeUserFonts(raw.ui.userFonts, ui, uiErrors);
		if (uiErrors.length > 0) return { ok: false, error: uiErrors.join("；") };
		out.ui = ui;
	}
	const text = JSON.stringify(out);
	if (Buffer.byteLength(text) > MAX_STATE_BYTES) return { ok: false, error: `state 超过 ${MAX_STATE_BYTES / 1024 / 1024} MB（${(Buffer.byteLength(text) / 1024 / 1024).toFixed(2)} MB）` };
	return { ok: true, state: out };
}

function readRawStateFile() {
	const file = statePath();
	if (!existsSync(file)) return null;
	try { return JSON.parse(readFileSync(file, "utf8")); }
	catch { return null; }
}

function currentUiFromDisk() {
	const raw = readRawStateFile();
	if (!isPlainObject(raw) || raw.ui === undefined) return defaultUi();
	const result = sanitizeState({ format: "dshte.state", version: 2, ui: raw.ui });
	return result.ok ? result.state.ui : defaultUi();
}

export function readState() {
	const file = statePath();
	if (!existsSync(file)) return { ok: true, state: defaultState(), fresh: true };
	try {
		const raw = readFileSync(file, "utf8");
		const result = sanitizeState(JSON.parse(raw));
		if (!result.ok) return { ok: false, error: result.error, state: defaultState() };
		return { ok: true, state: result.state, fresh: false };
	} catch (error) {
		return { ok: false, error: `state.json 无法读取：${error && error.message ? error.message : String(error)}`, state: defaultState() };
	}
}

function backupExisting(file) {
	try {
		if (!existsSync(file)) return;
		const dir = backupsDir();
		mkdirSync(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		writeFileSync(join(dir, `state-${stamp}.json`), readFileSync(file), "utf8");
		const backups = readdirSync(dir).filter((name) => /^state-.*\.json$/.test(name)).sort();
		for (const stale of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
			try { unlinkSync(join(dir, stale)); } catch { /* best effort */ }
		}
	} catch { /* backup is best-effort; never block the write */ }
}

/**
 * @param {unknown} state
 * @param {{includeUi?: boolean}} [options]
 *   includeUi === true → adopt `state.ui` verbatim (after sanitizing);
 *   otherwise → keep the ui already on disk (ordinary overrides writes are
 *   small and must not wipe user CSS/fonts).
 */
export function writeState(state, options = {}) {
	const includeUi = options && options.includeUi === true;
	let candidate = state;
	if (!includeUi) {
		if (!isPlainObject(candidate)) return { ok: false, error: "state 必须是对象" };
		candidate = { ...candidate, ui: currentUiFromDisk() };
	}
	const result = sanitizeState(candidate);
	if (!result.ok) return { ok: false, error: result.error };
	const file = statePath();
	mkdirSync(dirname(file), { recursive: true });
	backupExisting(file);
	const body = JSON.stringify(result.state, null, 2) + "\n";
	const temporary = file + ".tmp";
	writeFileSync(temporary, body, "utf8");
	try { renameSync(temporary, file); }
	catch {
		// Windows can transiently lock the target; direct write is safe for this single process.
		writeFileSync(file, body, "utf8");
		try { unlinkSync(temporary); } catch { /* ignore */ }
	}
	return { ok: true, state: result.state, dataDir: skinEngineDataDir(), fresh: false };
}

export { MAX_STATE_BYTES, MAX_UI_CSS_BYTES, MAX_FONT_BYTES, MAX_FONTS_BYTES, MAX_FONTS };
