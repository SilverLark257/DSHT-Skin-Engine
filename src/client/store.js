/**
 * Client state store (build-inlined fragment, no exports).
 *
 * Two layers (契约 §2.2/§2.3):
 *   - `state.json` via `POST /dsh-tavern-skin/api` (`state.get` / `state.set`) is
 *     authoritative once the host half answers; every write is debounced
 *     (default 1000 ms) so dragging a slider cannot spam the host.
 *   - `localStorage` is the first-paint seed and works before the host half is
 *     reloaded (方案 §5.4: origin/port changes must not lose the active pack).
 *   - Client-only preferences (live-preview toggle, custom CSS, local fonts) and
 *     the `dshte:safe:v1` lifeline live in localStorage only (契约 §2.2).
 *
 * All keys carry a version suffix. A corrupt seed falls back to defaults and is
 * reported through `snapshot().corruptSeed` — never fatal, never console-only.
 *
 * Step 6 (契约 §3 / §4.1): `state.json` is schema v2 and carries `ui`
 * (previewLive / userCss / userFonts). The client keeps only a SMALL local seed:
 * ordinary overrides writes go to `state.set` WITHOUT `includeUi` (the host keeps
 * the on-disk ui), while ui/userCss/userFonts changes use `includeUi: true`
 * (300 ms debounce). Step 5's big localStorage payload keys are migrated into
 * `state.ui` on the first connection to a v2 host, then deleted.
 */
function createStateStore() {
	const STATE_KEY = "dshte:state:v1";
	const UI_KEY = "dshte:ui:v1";
	const USER_CSS_KEY = "dshte:userCss:v1";
	const USER_FONTS_KEY = "dshte:userFonts:v1";
	const SAFE_KEY = "dshte:safe:v1";
	const API = "/dsh-tavern-skin/api";
	const DEFAULT_HOST_DEBOUNCE_MS = 1000;
	const UI_HOST_DEBOUNCE_MS = 300;
	/* Mirrors lib/host/store.js: the seed and the host must agree on validity. */
	const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;
	const TOKEN_RE = /^--(dsw|dsh-tavern|dshte)-[A-Za-z0-9][A-Za-z0-9_-]*$/;
	const MAX_TOKEN_VALUE = 2000;
	const MAX_UI_CSS_BYTES = 1024 * 1024;
	const MAX_FONT_BYTES = 1.5 * 1024 * 1024;
	const MAX_FONTS_BYTES = 4 * 1024 * 1024;
	const MAX_FONTS = 20;
	const FONT_EXT_RE = /\.(woff2?|ttf|otf)$/i;
	const FONT_MIME_RE = /^(font\/(woff2?|ttf|otf|sfnt)|application\/(font-woff|x-font-(woff|ttf|otf))|application\/octet-stream)$/i;
	const FONT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
	const DATA_URL_RE = /^data:[^;,]*;base64,[A-Za-z0-9+/]+={0,2}$/;
	const SCHEMES = ["light", "dark"];

	const listeners = new Set();
	const host = { available: null, lastError: null, lastSyncAt: null, lastWriteAt: null, writeCount: 0, schemaVersion: null };
	const fontFaces = new Map();
	const packsCache = { builtin: [], user: [], counts: null, limits: null, at: null, error: null };
	const trashCache = { entries: [], count: 0, at: null, error: null };

	let state = defaultState();
	let ui = defaultUi();
	let userCss = { text: "", savedAt: null };
	let fontEntries = [];
	let safeMemory = false;
	let corruptSeed = false;
	let lastFontError = null;
	let saveTimer = null;
	let hostDebounceMs = DEFAULT_HOST_DEBOUNCE_MS;
	let pendingHostWrite = false;
	let pendingIncludeUi = false;
	let writeInFlight = null;
	let writeAgain = false;
	/* Step 6: true once the host answered with schema v2 (ui is authoritative). */
	let hostV2 = false;
	let uiMigrated = false;
	let pendingImport = null;

	/* ── defaults + validation ───────────────────────────────────────────── */

	function defaultState() {
		return {
			format: "dshte.state",
			version: 1,
			activePackId: "cocreate-paper",
			enabled: true,
			schemePolicy: null,
			overrides: { light: {}, dark: {} },
			ui: defaultUi()
		};
	}

	function defaultUi() {
		return { previewLive: true, userCss: { text: "", savedAt: null }, userFonts: [] };
	}

	function normalizeFontEntry(entry) {
		if (!entry || typeof entry !== "object") return null;
		if (typeof entry.id !== "string" || !/^[a-z0-9]{4,32}$/.test(entry.id)) return null;
		if (typeof entry.dataUrl !== "string" || entry.dataUrl.slice(0, 5) !== "data:") return null;
		const bytes = Number(entry.bytes);
		if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_FONT_BYTES) return null;
		return {
			id: entry.id,
			family: `dshte-user-${entry.id}`,
			weight: Number.isFinite(Number(entry.weight)) ? Number(entry.weight) : 400,
			style: typeof entry.style === "string" && entry.style ? entry.style : "normal",
			fileName: typeof entry.fileName === "string" ? entry.fileName : "",
			mime: typeof entry.mime === "string" ? entry.mime : "",
			dataUrl: entry.dataUrl,
			bytes
		};
	}

	/** Validate a state.ui block (契约 §3 limits; lenient where the host is stricter). */
	function sanitizeUi(raw) {
		if (raw === undefined) return { ok: true, ui: defaultUi() };
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "state.ui 必须是对象" };
		const out = defaultUi();
		if (raw.previewLive !== undefined) {
			if (typeof raw.previewLive !== "boolean") return { ok: false, error: "state.ui.previewLive 必须是布尔值" };
			out.previewLive = raw.previewLive;
		}
		if (raw.userCss !== undefined && raw.userCss !== null) {
			if (typeof raw.userCss !== "object" || Array.isArray(raw.userCss)) return { ok: false, error: "state.ui.userCss 必须是对象或 null" };
			if (typeof raw.userCss.text !== "string") return { ok: false, error: "state.ui.userCss.text 必须是字符串" };
			if (utf8Size(raw.userCss.text) > MAX_UI_CSS_BYTES) return { ok: false, error: "state.ui.userCss 超过 1 MB" };
			if (raw.userCss.savedAt !== undefined && raw.userCss.savedAt !== null && typeof raw.userCss.savedAt !== "string") {
				return { ok: false, error: "state.ui.userCss.savedAt 必须是字符串或 null" };
			}
			out.userCss = { text: raw.userCss.text, savedAt: typeof raw.userCss.savedAt === "string" ? raw.userCss.savedAt : null };
		}
		if (raw.userFonts !== undefined && raw.userFonts !== null) {
			if (!Array.isArray(raw.userFonts)) return { ok: false, error: "state.ui.userFonts 必须是数组" };
			if (raw.userFonts.length > MAX_FONTS) return { ok: false, error: `state.ui.userFonts 最多 ${MAX_FONTS} 个` };
			let total = 0;
			for (let index = 0; index < raw.userFonts.length; index += 1) {
				const entry = raw.userFonts[index];
				const path = `state.ui.userFonts[${index}]`;
				if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, error: `${path} 必须是对象` };
				if (typeof entry.id !== "string" || !FONT_ID_RE.test(entry.id)) return { ok: false, error: `${path}.id 不合法` };
				if (typeof entry.dataUrl !== "string" || !DATA_URL_RE.test(entry.dataUrl)) return { ok: false, error: `${path}.dataUrl 必须是 data:<mime>;base64` };
				const bytes = Number(entry.bytes);
				if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_FONT_BYTES) return { ok: false, error: `${path}.bytes 不合法` };
				if (entry.fileName !== undefined && (typeof entry.fileName !== "string" || !FONT_EXT_RE.test(entry.fileName))) return { ok: false, error: `${path}.fileName 必须是字体文件名` };
				total += bytes;
				if (total > MAX_FONTS_BYTES) return { ok: false, error: "state.ui.userFonts 合计超过 4 MB" };
				out.userFonts.push(normalizeFontEntry(entry));
			}
			out.userFonts = out.userFonts.filter(Boolean);
		}
		return { ok: true, ui: out };
	}

	/**
	 * Normalize untrusted input exactly like the host store does.
	 * @returns {{ok: true, state: object}|{ok: false, error: string}}
	 */
	function sanitizeState(raw) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "state 必须是对象" };
		if (raw.format !== undefined && raw.format !== "dshte.state") return { ok: false, error: "state.format 必须是 dshte.state" };
		if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) return { ok: false, error: "state.version 必须是 1 或 2" };
		const out = defaultState();
		if (raw.version === 2) out.version = 2;
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
			for (const scheme of SCHEMES) {
				const block = raw.overrides[scheme];
				if (block === undefined) continue;
				if (!block || typeof block !== "object" || Array.isArray(block)) return { ok: false, error: `state.overrides.${scheme} 必须是对象` };
				for (const [name, value] of Object.entries(block)) {
					if (!TOKEN_RE.test(name)) return { ok: false, error: `state.overrides.${scheme} 的 token 名不合法：${name}` };
					if (typeof value !== "string" || value.length > MAX_TOKEN_VALUE) return { ok: false, error: `state.overrides.${scheme}["${name}"] 必须是字符串` };
					out.overrides[scheme][name] = value;
				}
			}
		}
		if (raw.ui !== undefined) {
			const uiResult = sanitizeUi(raw.ui);
			if (!uiResult.ok) return { ok: false, error: uiResult.error };
			out.ui = uiResult.ui;
		}
		return { ok: true, state: out };
	}

	/**
	 * Scheme-wise merge for `set({overrides})`: a caller that only edits one
	 * scheme does not have to resend the other one, while an explicit empty
	 * block still clears that scheme (that is how 复位 / 恢复默认 delete tokens).
	 */
	function mergeOverridePatch(current, patch) {
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
		const out = {
			light: { ...((current && current.light) || {}) },
			dark: { ...((current && current.dark) || {}) }
		};
		if (patch.light !== undefined) out.light = patch.light;
		if (patch.dark !== undefined) out.dark = patch.dark;
		return out;
	}

	/* ── localStorage (versioned keys, memory fallback) ──────────────────── */

	function storage() {
		try { return window.localStorage || null; } catch (error) { log("localStorage unavailable", String((error && error.message) || error)); return null; }
	}

	function readKey(key) {
		const box = storage();
		if (!box) return null;
		try { return box.getItem(key); } catch (error) { log("localStorage read failed", key, String((error && error.message) || error)); return null; }
	}

	function writeKey(key, value) {
		const box = storage();
		if (!box) return false;
		try { box.setItem(key, value); return true; } catch (error) { log("localStorage write failed (state stays in memory)", key, String((error && error.message) || error)); return false; }
	}

	function removeKey(key) {
		const box = storage();
		if (!box) return false;
		try { box.removeItem(key); return true; } catch (error) { log("localStorage remove failed", key, String((error && error.message) || error)); return false; }
	}

	function loadLocalSeed() {
		corruptSeed = false;
		const raw = readKey(STATE_KEY);
		if (raw === null) return;
		let parsed = null;
		try { parsed = JSON.parse(raw); }
		catch (error) {
			corruptSeed = true;
			log("local state seed is corrupt JSON; falling back to defaults", String((error && error.message) || error));
			return;
		}
		const result = sanitizeState(parsed);
		if (!result.ok) {
			corruptSeed = true;
			log("local state seed rejected; falling back to defaults", result.error);
			return;
		}
		state = result.state;
	}

	function loadUi() {
		const raw = readKey(UI_KEY);
		if (raw === null) { ui = { previewLive: !(state.ui && state.ui.previewLive === false) }; return; }
		try {
			const parsed = JSON.parse(raw);
			ui = { previewLive: parsed && typeof parsed.previewLive === "boolean" ? parsed.previewLive : true };
		} catch (error) {
			ui = { previewLive: true };
			log("local UI preferences rejected; using defaults", String((error && error.message) || error));
		}
	}

	function loadCustomCss() {
		const hostUi = state.ui && state.ui.userCss && typeof state.ui.userCss.text === "string" ? state.ui.userCss : null;
		const fallback = hostUi
			? { text: hostUi.text, savedAt: typeof hostUi.savedAt === "string" ? hostUi.savedAt : null }
			: { text: "", savedAt: null };
		const raw = readKey(USER_CSS_KEY);
		if (raw === null) { userCss = fallback; return; }
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed.text !== "string") throw new Error("payload must be { text, savedAt }");
			userCss = { text: parsed.text, savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null };
		} catch (error) {
			userCss = fallback;
			log("local custom CSS rejected; using empty text", String((error && error.message) || error));
		}
	}

	function loadUserFonts() {
		const hostFonts = state.ui && Array.isArray(state.ui.userFonts)
			? state.ui.userFonts.map(normalizeFontEntry).filter(Boolean)
			: [];
		const raw = readKey(USER_FONTS_KEY);
		fontEntries = hostFonts;
		if (raw === null) return;
		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) throw new Error("payload must be an array");
			const fonts = [];
			let total = 0;
			for (const item of parsed) {
				const entry = normalizeFontEntry(item);
				if (!entry) continue;
				if (total + entry.bytes > MAX_FONTS_BYTES) continue;
				total += entry.bytes;
				fonts.push(entry);
			}
			fontEntries = fonts;
		} catch (error) {
			fontEntries = hostFonts;
			log("local font cache rejected; using none", String((error && error.message) || error));
		}
	}

	function loadLocal() {
		loadLocalSeed();
		loadUi();
		loadCustomCss();
		loadUserFonts();
		syncUiFromMirrors();
	}

	/** Rebuild `state.ui` from the in-memory mirrors (the payload that gets written). */
	function syncUiFromMirrors() {
		state.ui = {
			previewLive: ui.previewLive !== false,
			userCss: { text: userCss.text, savedAt: userCss.savedAt },
			userFonts: fontEntries.map((entry) => ({ ...entry }))
		};
	}

	/** Adopt a host/ui payload into the in-memory mirrors (never throws). */
	function adoptUiPayload(source) {
		const payload = sanitizeUi(source === undefined ? defaultUi() : source);
		const next = payload.ok ? payload.ui : defaultUi();
		ui = { previewLive: next.previewLive !== false };
		userCss = { text: next.userCss.text, savedAt: next.userCss.savedAt };
		fontEntries = next.userFonts.map((entry) => ({ ...entry }));
	}

	function uiPayloadPresent(source) {
		const value = source && typeof source === "object" ? source : {};
		const css = value.userCss && typeof value.userCss.text === "string" ? value.userCss.text : "";
		return css.length > 0 || (Array.isArray(value.userFonts) && value.userFonts.length > 0);
	}

	function stateSeed() {
		return {
			format: state.format,
			version: state.version,
			activePackId: state.activePackId,
			enabled: state.enabled,
			schemePolicy: state.schemePolicy,
			overrides: state.overrides
		};
	}

	function persistState() {
		// Only the SMALL seed: the big ui payload lives in state.json (契约 §3).
		writeKey(STATE_KEY, JSON.stringify(stateSeed()));
	}

	function persistUi() {
		writeKey(UI_KEY, JSON.stringify({ previewLive: ui.previewLive !== false }));
	}

	function persistCustomCss() {
		if (!userCss.text) { removeKey(USER_CSS_KEY); return; }
		writeKey(USER_CSS_KEY, JSON.stringify(userCss));
	}

	function persistFonts() {
		if (fontEntries.length === 0) { removeKey(USER_FONTS_KEY); return; }
		writeKey(USER_FONTS_KEY, JSON.stringify(fontEntries));
	}

	/**
	 * One-shot Step 5 localStorage → `state.ui` migration (契约 §3).
	 * @returns {{migrated: boolean, needsHostWrite: boolean}}
	 */
	function migrateLocalUi() {
		const localHasPayload = readKey(USER_CSS_KEY) !== null || readKey(USER_FONTS_KEY) !== null;
		let needsHostWrite = false;
		if (!uiMigrated) {
			uiMigrated = true;
			if (!uiPayloadPresent(state.ui) && localHasPayload) {
				state.ui = {
					previewLive: ui.previewLive !== false,
					userCss: { text: userCss.text, savedAt: userCss.savedAt },
					userFonts: fontEntries.map((entry) => ({ ...entry }))
				};
				needsHostWrite = true;
			}
		}
		// From now on the host owns the big payload: drop the local copies.
		removeKey(USER_CSS_KEY);
		removeKey(USER_FONTS_KEY);
		persistUi();
		return { migrated: needsHostWrite, needsHostWrite };
	}

	/* ── notifications ───────────────────────────────────────────────────── */

	function get() { return state; }

	function subscribe(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function notify(reason) {
		for (const listener of [...listeners]) {
			try { listener(state, reason); } catch (error) { console.warn(TAG, "store listener failed", error); }
		}
	}

	/* ── host API + debounced writes ─────────────────────────────────────── */

	/**
	 * Raw API call: never throws. 契约 §4.1 — imports need the error details.
	 * @returns {Promise<{ok: true, value: any, status: number, error: null}|{ok: false, value: null, status: number, error: {code: string, message: string, details: Array}}>}
	 */
	async function apiRaw(method, args) {
		let response = null;
		try {
			response = await fetch(API, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ method, args: args || {} })
			});
		} catch (error) {
			return { ok: false, status: 0, value: null, error: { code: "network", message: `无法连接宿主 API（${method}）：${String((error && error.message) || error)}`, details: [] } };
		}
		const data = await response.json().catch(() => null);
		if (response.ok && data && data.ok === true) {
			return { ok: true, status: response.status, value: data.value === undefined ? null : data.value, error: null };
		}
		const raw = data && data.error && typeof data.error === "object" ? data.error : null;
		return {
			ok: false,
			status: response.status,
			value: null,
			error: {
				code: raw && typeof raw.code === "string" ? raw.code : `http-${response.status}`,
				message: (raw && typeof raw.message === "string" && raw.message) || `API ${method} failed (${response.status})`,
				details: raw && Array.isArray(raw.details) ? raw.details : []
			}
		};
	}

	async function api(method, args) {
		const result = await apiRaw(method, args);
		if (!result.ok) {
			const error = new Error(result.error && result.error.message ? result.error.message : `API ${method} failed`);
			error.code = result.error && result.error.code;
			error.details = result.error && result.error.details;
			throw error;
		}
		return result.value;
	}

	/* ── Step 6: pack + trash registries (契约 §4.1) ─────────────────────── */

	function normalizePackList(value) {
		const source = value && typeof value === "object" ? value : {};
		const builtin = Array.isArray(source) ? source : Array.isArray(source.builtin) ? source.builtin : [];
		const user = Array.isArray(source.user) ? source.user : [];
		return {
			builtin: builtin.filter((meta) => meta && typeof meta === "object" && typeof meta.id === "string"),
			user: user.filter((meta) => meta && typeof meta === "object" && typeof meta.id === "string"),
			counts: source.counts && typeof source.counts === "object" ? source.counts : null,
			limits: source.limits && typeof source.limits === "object" ? source.limits : null
		};
	}

	/** `packs.list` → cache. Never throws; failures stay on `snapshot().packs.error`. */
	async function refreshPacks() {
		const result = await apiRaw("packs.list");
		if (result.ok) {
			const next = normalizePackList(result.value);
			packsCache.builtin = next.builtin;
			packsCache.user = next.user;
			packsCache.counts = next.counts;
			packsCache.limits = next.limits;
			packsCache.at = new Date().toISOString();
			packsCache.error = null;
			host.available = true;
			host.lastError = null;
		} else {
			packsCache.error = result.error;
		}
		notify("packs");
		return packs();
	}

	function packs() {
		return {
			builtin: packsCache.builtin.slice(),
			user: packsCache.user.slice(),
			counts: packsCache.counts ? { ...packsCache.counts } : null,
			limits: packsCache.limits ? { ...packsCache.limits } : null,
			at: packsCache.at,
			error: packsCache.error
		};
	}

	function packMeta(id) {
		const key = typeof id === "string" ? id : "";
		for (const list of [packsCache.builtin, packsCache.user]) {
			const hit = list.find((meta) => meta && meta.id === key);
			if (hit) return { ...hit };
		}
		return null;
	}

	function isBuiltin(id) {
		return packsCache.builtin.some((meta) => meta && meta.id === id);
	}

	/** `trash.list` → cache. Never throws. */
	async function refreshTrash() {
		const result = await apiRaw("trash.list");
		if (result.ok) {
			const value = result.value && typeof result.value === "object" ? result.value : {};
			const entries = Array.isArray(value.entries) ? value.entries : Array.isArray(value) ? value : [];
			trashCache.entries = entries.filter((entry) => entry && typeof entry === "object" && typeof entry.trashId === "string");
			trashCache.count = typeof value.count === "number" ? value.count : trashCache.entries.length;
			trashCache.at = new Date().toISOString();
			trashCache.error = null;
		} else {
			trashCache.error = result.error;
		}
		notify("trash");
		return trash();
	}

	function trash() {
		return { entries: trashCache.entries.slice(), count: trashCache.count, at: trashCache.at, error: trashCache.error };
	}

	/** Diagnostics hook for the import row (contract §4.1 `pendingImport`). */
	function setPendingImport(info) {
		pendingImport = info && typeof info === "object" ? { ...info } : null;
		notify("import");
		return pendingImport;
	}

	function writeHostNow() {
		if (writeInFlight) { writeAgain = true; return writeInFlight; }
		pendingHostWrite = false;
		const includeUi = pendingIncludeUi === true;
		pendingIncludeUi = false;
		writeInFlight = (async () => {
			try {
				// Ordinary writes only ship the small state: the host keeps the
				// on-disk ui (契约 §4.1 — no 7 MB payload per slider change).
				const args = includeUi ? { state, includeUi: true } : { state: stateSeed() };
				await api("state.set", args);
				host.available = true;
				host.lastError = null;
				host.lastSyncAt = new Date().toISOString();
				host.lastWriteAt = host.lastSyncAt;
				host.writeCount += 1;
				return { ok: true, includeUi };
			} catch (error) {
				const message = String((error && error.message) || error);
				host.available = false;
				host.lastError = message;
				if (includeUi) pendingIncludeUi = true;
				notify("host-write-failed");
				return { ok: false, error: message };
			} finally {
				writeInFlight = null;
				if (writeAgain) { writeAgain = false; void writeHostNow(); }
			}
		})();
		return writeInFlight;
	}

	function scheduleHostSave(debounceMs, includeUi) {
		pendingHostWrite = true;
		if (includeUi === true) pendingIncludeUi = true;
		if (saveTimer) clearTimeout(saveTimer);
		const wait = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : hostDebounceMs;
		saveTimer = setTimeout(() => {
			saveTimer = null;
			void writeHostNow();
		}, wait);
	}

	/** Cancel the pending debounce and write immediately (契约 §2.3 flush/saveNow). */
	function flush() {
		if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
		if (!pendingHostWrite && !writeInFlight) return Promise.resolve({ ok: true });
		return writeHostNow();
	}

	/* ── set / hydrate ───────────────────────────────────────────────────── */

	function set(patch, options) {
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "patch 必须是对象" };
		const candidate = { ...state, ...patch };
		if (patch.overrides !== undefined) candidate.overrides = mergeOverridePatch(state.overrides, patch.overrides);
		const result = sanitizeState(candidate);
		if (!result.ok) return { ok: false, error: result.error };
		state = result.state;
		persistState();
		notify((options && options.reason) || "change");
		if (!(options && options.silentHost === true)) scheduleHostSave(options && options.debounceMs, false);
		return { ok: true };
	}

	async function hydrate() {
		loadLocal();
		notify("local-seed");
		try {
			const remoteValue = await api("state.get");
			const remote = remoteValue && typeof remoteValue === "object" && remoteValue.state && typeof remoteValue.state === "object" && remoteValue.format === undefined
				? { ...remoteValue.state, fresh: remoteValue.fresh }
				: remoteValue;
			const fresh = !!(remote && remote.fresh === true);
			const parsed = sanitizeState(remote);
			if (!parsed.ok) throw new Error(`宿主返回的状态不合法：${parsed.error}`);
			host.available = true;
			host.lastError = null;
			host.lastSyncAt = new Date().toISOString();
			hostV2 = parsed.state.version === 2;
			host.schemaVersion = hostV2 ? 2 : 1;
			if (fresh) {
				// Host has no state.json yet: the localStorage seed survives and is
				// written back once (契约 §2.3 hydrate). On a v2 host this is also the
				// first chance to migrate the Step 5 big payload into state.ui.
				if (hostV2) {
					state = { ...state, version: 2 };
					// `state.ui` already mirrors the local seed (syncUiFromMirrors);
					// this clears the Step 5 big local keys and writes the seed back.
					migrateLocalUi();
					scheduleHostSave(hostDebounceMs, true);
				} else {
					scheduleHostSave(hostDebounceMs, false);
				}
				notify("host-fresh");
				return;
			}
			state = parsed.state;
			if (hostV2) {
				const migration = migrateLocalUi();
				if (migration.needsHostWrite) scheduleHostSave(hostDebounceMs, true);
				else if (!uiPayloadPresent(state.ui)) {
					// Host owns an empty ui: adopt the mirrors that loadLocal produced.
					syncUiFromMirrors();
				} else {
					adoptUiPayload(state.ui);
					syncUiFromMirrors();
				}
			}
			persistState();
			notify("host-state");
			await refreshPacks();
			await refreshTrash();
		} catch (error) {
			host.available = false;
			host.lastError = String((error && error.message) || error);
			notify("host-unavailable");
		}
	}

	function hostStatus() {
		return {
			available: host.available,
			lastError: host.lastError,
			lastSyncAt: host.lastSyncAt,
			lastWriteAt: host.lastWriteAt,
			writeCount: host.writeCount,
			hostDebounceMs,
			schemaVersion: host.schemaVersion,
			uiMigrated
		};
	}

	/* ── client preferences: safe mode / ui / custom CSS ─────────────────── */

	function isSafeMode() {
		const raw = readKey(SAFE_KEY);
		if (raw === null) return safeMemory;
		return raw === "1";
	}

	function setSafeMode(on) {
		const want = on === true;
		safeMemory = want;
		if (want) writeKey(SAFE_KEY, "1");
		else removeKey(SAFE_KEY);
	}

	function getUi() {
		return {
			previewLive: ui.previewLive !== false,
			userCss: { text: userCss.text, savedAt: userCss.savedAt },
			userFonts: listFonts()
		};
	}

	function setUi(patch) {
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) return getUi();
		if (typeof patch.previewLive === "boolean") ui.previewLive = patch.previewLive;
		persistUi();
		syncUiFromMirrors();
		notify("ui");
		// 契约 §4.1: ui (previewLive) is persisted through state.set includeUi:true.
		if (hostV2) scheduleHostSave(UI_HOST_DEBOUNCE_MS, true);
		return getUi();
	}

	function getCustomCss() { return { text: userCss.text, savedAt: userCss.savedAt }; }

	function setCustomCss(text) {
		const value = typeof text === "string" ? text : "";
		userCss = value
			? { text: value, savedAt: new Date().toISOString() }
			: { text: "", savedAt: null };
		// Until the host is known to be v2, the big payload has to stay local
		// (Step 5 behaviour); a v2 host owns it through state.ui.
		if (!hostV2) persistCustomCss();
		syncUiFromMirrors();
		notify("custom-css");
		if (hostV2) scheduleHostSave(UI_HOST_DEBOUNCE_MS, true);
	}

	/* ── user fonts (browser only, 契约 §2.2 limits) ─────────────────────── */

	function listFonts() {
		return fontEntries.map((entry) => ({
			id: entry.id,
			family: entry.family,
			weight: entry.weight,
			fileName: entry.fileName,
			bytes: entry.bytes
		}));
	}

	function formatBytes(bytes) {
		const kb = bytes / 1024;
		if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
		return `${(kb / 1024).toFixed(1)} MB`;
	}

	function makeFontId() {
		return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	}

	function readAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			if (typeof FileReader !== "function") { reject(new Error("FileReader 不可用")); return; }
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ""));
			reader.onerror = () => reject(reader.error || new Error("读取失败"));
			reader.readAsDataURL(file);
		});
	}

	function fontsApiAvailable() {
		return typeof window.FontFace === "function" && !!document.fonts && typeof document.fonts.add === "function";
	}

	async function loadFontFace(entry) {
		const existing = fontFaces.get(entry.family);
		if (existing) return existing;
		if (!fontsApiAvailable()) throw new Error("FontFace API 不可用");
		const face = new window.FontFace(entry.family, `url("${entry.dataUrl}")`, { weight: String(entry.weight), style: entry.style });
		await face.load();
		document.fonts.add(face);
		fontFaces.set(entry.family, face);
		return face;
	}

	async function addFont(file) {
		if (!file || typeof file !== "object") return { ok: false, error: "未选择字体文件" };
		const name = typeof file.name === "string" ? file.name : "";
		const size = Number(file.size) || 0;
		if (!FONT_EXT_RE.test(name)) return { ok: false, error: "只支持 .woff2/.woff/.ttf/.otf 字体文件" };
		if (file.type && !FONT_MIME_RE.test(file.type)) return { ok: false, error: `字体 MIME 不支持：${file.type}` };
		if (size <= 0) return { ok: false, error: "字体文件为空" };
		if (size > MAX_FONT_BYTES) return { ok: false, error: `字体文件超过 1.5 MB（${formatBytes(size)}）` };
		const used = fontEntries.reduce((sum, entry) => sum + entry.bytes, 0);
		if (used + size > MAX_FONTS_BYTES) return { ok: false, error: `本机字体总额超过 4 MB（已用 ${formatBytes(used)}）` };
		if (!fontsApiAvailable()) return { ok: false, error: "当前浏览器不支持本机字体（FontFace）" };
		let dataUrl = "";
		try { dataUrl = await readAsDataUrl(file); }
		catch (error) {
			lastFontError = String((error && error.message) || error);
			return { ok: false, error: `读取字体失败：${lastFontError}` };
		}
		const entry = {
			id: makeFontId(),
			family: "",
			weight: 400,
			style: "normal",
			fileName: name,
			mime: typeof file.type === "string" ? file.type : "",
			dataUrl,
			bytes: size
		};
		entry.family = `dshte-user-${entry.id}`;
		try { await loadFontFace(entry); }
		catch (error) {
			lastFontError = String((error && error.message) || error);
			return { ok: false, error: `字体无法加载：${lastFontError}` };
		}
		lastFontError = null;
		fontEntries = [...fontEntries, entry];
		if (!hostV2) persistFonts();
		syncUiFromMirrors();
		notify("user-fonts");
		if (hostV2) scheduleHostSave(UI_HOST_DEBOUNCE_MS, true);
		return { ok: true, id: entry.id, family: entry.family };
	}

	function removeFont(id) {
		const index = fontEntries.findIndex((entry) => entry.id === id);
		if (index < 0) return false;
		const entry = fontEntries[index];
		fontEntries = fontEntries.filter((item) => item.id !== id);
		const face = fontFaces.get(entry.family);
		if (face && document.fonts && typeof document.fonts.delete === "function") {
			try { document.fonts.delete(face); } catch (error) { log("document.fonts.delete failed", String((error && error.message) || error)); }
		}
		fontFaces.delete(entry.family);
		if (!hostV2) persistFonts();
		syncUiFromMirrors();
		notify("user-fonts");
		if (hostV2) scheduleHostSave(UI_HOST_DEBOUNCE_MS, true);
		return true;
	}

	/** Idempotent: safe to call on every boot. */
	async function restoreFonts() {
		if (fontEntries.length === 0) return;
		if (!fontsApiAvailable()) { lastFontError = "FontFace API 不可用"; return; }
		for (const entry of fontEntries) {
			if (fontFaces.has(entry.family)) continue;
			try { await loadFontFace(entry); }
			catch (error) {
				lastFontError = String((error && error.message) || error);
				log("user font restore failed", entry.fileName, lastFontError);
			}
		}
	}

	/* ── cache reset + diagnostics ───────────────────────────────────────── */

	/** Delete the four client cache keys, keep `safe` (契约 §2.3). */
	async function clearLocalCache() {
		const removed = [];
		const kept = [SAFE_KEY];
		const errors = [];
		for (const key of [STATE_KEY, UI_KEY, USER_CSS_KEY, USER_FONTS_KEY]) {
			if (readKey(key) !== null) removed.push(key);
			if (!removeKey(key) && storage()) errors.push(key);
		}
		for (const face of fontFaces.values()) {
			try { if (document.fonts && typeof document.fonts.delete === "function") document.fonts.delete(face); } catch { /* ignore */ }
		}
		fontFaces.clear();
		state = defaultState();
		corruptSeed = false;
		ui = { previewLive: true };
		userCss = { text: "", savedAt: null };
		fontEntries = [];
		packsCache.builtin = [];
		packsCache.user = [];
		packsCache.counts = null;
		packsCache.limits = null;
		packsCache.at = null;
		packsCache.error = null;
		trashCache.entries = [];
		trashCache.count = 0;
		trashCache.at = null;
		trashCache.error = null;
		uiMigrated = false;
		pendingImport = null;
		await hydrate();
		const result = { removed, kept };
		if (errors.length > 0) result.error = `部分键删除失败：${errors.join(", ")}`;
		return result;
	}

	function snapshot() {
		const keys = {};
		for (const key of [STATE_KEY, UI_KEY, USER_CSS_KEY, USER_FONTS_KEY, SAFE_KEY]) {
			const raw = readKey(key);
			keys[key] = raw === null ? null : { present: true, bytes: utf8Size(raw) };
		}
		return {
			keys,
			corruptSeed,
			host: hostStatus(),
			safeMode: isSafeMode(),
			ui: { previewLive: ui.previewLive !== false },
			uiMigrated,
			pendingImport: pendingImport ? { ...pendingImport } : null,
			packs: {
				builtin: packsCache.builtin.slice(),
				user: packsCache.user.slice(),
				counts: packsCache.counts ? { ...packsCache.counts } : null,
				at: packsCache.at,
				error: packsCache.error
			},
			trash: {
				entries: trashCache.entries.slice(),
				count: trashCache.count,
				at: trashCache.at,
				error: trashCache.error
			},
			userCss: { present: userCss.text.length > 0, bytes: utf8Size(userCss.text), savedAt: userCss.savedAt },
			userFonts: { count: fontEntries.length, bytes: fontEntries.reduce((sum, entry) => sum + entry.bytes, 0) },
			lastFontError
		};
	}

	function utf8Size(text) {
		if (typeof text !== "string") return 0;
		if (typeof TextEncoder === "function") {
			try { return new TextEncoder().encode(text).length; } catch { /* fall through */ }
		}
		return text.length;
	}

	loadLocal();

	return {
		get,
		set,
		subscribe,
		hydrate,
		api,
		apiRaw,
		hostStatus,
		flush,
		saveNow: flush,
		isSafeMode,
		setSafeMode,
		getUi,
		setUi,
		getCustomCss,
		setCustomCss,
		userFonts: {
			list: listFonts,
			add: addFont,
			remove: removeFont,
			restore: restoreFonts
		},
		refreshPacks,
		packs,
		packMeta,
		isBuiltin,
		refreshTrash,
		trash,
		setPendingImport,
		clearLocalCache,
		snapshot,
		sanitizeState
	};
}
