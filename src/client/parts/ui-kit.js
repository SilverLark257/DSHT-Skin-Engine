/**
 * Step 5 settings-page UI kit (classic-script fragment: no imports/exports/JSX).
 *
 * Every primitive is inline-styled from `--dsw-*` / `--dshte-*` variables WITH a
 * literal fallback, so the page — above all the safe-mode escape hatch — renders
 * and stays operable even when the pack CSS is broken, engine.css is withdrawn,
 * or the theme service is gone (契约 §0.6 / §6.2).
 *
 * The kit also owns the defensive accessors for store/engine methods that
 * engine-core implements in parallel (契约 §2.3 / §4): callers never touch a
 * missing method directly, failures stay inline-visible instead of throwing.
 */

const UI_COLOR = Object.freeze({
	text: "var(--dsw-alias-label-primary, #1b1b1b)",
	textSecondary: "var(--dsw-alias-label-secondary, #565350)",
	textTertiary: "var(--dsw-alias-label-tertiary, #8a857f)",
	border: "var(--dsw-alias-border-l1, rgba(90, 86, 80, 0.30))",
	borderStrong: "var(--dsw-alias-border-l2, rgba(90, 86, 80, 0.48))",
	surface: "var(--dsw-alias-bg-layer-1, #ffffff)",
	surface2: "var(--dsw-alias-bg-layer-2, #f4f1ec)",
	layer3: "var(--dsw-alias-bg-layer-3, #ffffff)",
	brand: "var(--dsw-alias-brand-primary, #6f5aa8)",
	brandText: "var(--dsw-alias-brand-text, #ffffff)",
	danger: "var(--dshte-danger, #c34b5a)",
	dangerBg: "var(--dshte-danger-bg, rgba(195, 75, 90, 0.14))",
	ok: "var(--dshte-success, #2f9e75)",
	okBg: "var(--dshte-success-bg, rgba(47, 158, 117, 0.14))",
	warn: "var(--dshte-accent-ink, #7a5a1e)",
	warnBg: "rgba(200, 160, 60, 0.14)",
	codeBg: "var(--dsw-alias-bg-layer-2, rgba(120, 120, 120, 0.12))",
	mono: "ui-monospace, \"Cascadia Code\", Consolas, \"Courier New\", monospace"
});

const UI_STYLE = Object.freeze({
	card: {
		padding: "14px 16px",
		margin: "0 0 12px",
		border: "1px solid " + UI_COLOR.border,
		borderRadius: "10px",
		background: UI_COLOR.surface,
		color: UI_COLOR.text,
		boxSizing: "border-box"
	},
	cardTight: { padding: "10px 12px" },
	subcard: {
		padding: "10px 12px",
		border: "1px solid " + UI_COLOR.border,
		borderRadius: "8px",
		background: UI_COLOR.surface2,
		boxSizing: "border-box"
	},
	titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "8px" },
	title: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.01em", color: UI_COLOR.text },
	titleActions: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
	subtitle: { fontSize: "12px", fontWeight: 600, color: UI_COLOR.textSecondary, margin: "0 0 6px" },
	note: { fontSize: "11px", lineHeight: 1.65, color: UI_COLOR.textTertiary, margin: "8px 0 0" },
	hint: { fontSize: "10.5px", lineHeight: 1.5, color: UI_COLOR.textTertiary },
	row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "3px 0", minHeight: "26px" },
	rowStack: { display: "grid", gap: "3px", padding: "3px 0" },
	label: { fontSize: "11.5px", color: UI_COLOR.textSecondary, minWidth: "104px" },
	labelSmall: { fontSize: "11px", color: UI_COLOR.textSecondary },
	grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "8px" },
	gridWide: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "10px" },
	input: {
		padding: "4px 8px",
		borderRadius: "7px",
		border: "1px solid " + UI_COLOR.border,
		background: UI_COLOR.layer3,
		color: "inherit",
		fontSize: "12px",
		lineHeight: 1.4,
		fontFamily: "inherit",
		minWidth: 0,
		boxSizing: "border-box"
	},
	textarea: {
		width: "100%",
		minHeight: "120px",
		padding: "8px 10px",
		borderRadius: "8px",
		border: "1px solid " + UI_COLOR.border,
		background: UI_COLOR.layer3,
		color: "inherit",
		fontSize: "11.5px",
		lineHeight: 1.55,
		fontFamily: UI_COLOR.mono,
		boxSizing: "border-box",
		resize: "vertical"
	},
	select: {
		padding: "4px 6px",
		borderRadius: "7px",
		border: "1px solid " + UI_COLOR.border,
		background: UI_COLOR.layer3,
		color: "inherit",
		fontSize: "12px",
		fontFamily: "inherit",
		boxSizing: "border-box"
	},
	range: { width: "100px", accentColor: UI_COLOR.brand, padding: 0 },
	button: {
		padding: "4px 11px",
		borderRadius: "8px",
		border: "1px solid " + UI_COLOR.border,
		background: UI_COLOR.layer3,
		color: UI_COLOR.text,
		fontSize: "11.5px",
		fontFamily: "inherit",
		lineHeight: 1.5,
		cursor: "pointer",
		boxSizing: "border-box"
	},
	buttonPrimary: {
		border: "1px solid " + UI_COLOR.brand,
		background: UI_COLOR.brand,
		color: UI_COLOR.brandText
	},
	buttonDanger: {
		border: "1px solid " + UI_COLOR.danger,
		background: UI_COLOR.dangerBg,
		color: UI_COLOR.danger
	},
	buttonPressed: {
		border: "1px solid " + UI_COLOR.brand,
		background: "var(--dshte-bg-accent-faint, rgba(111, 90, 168, 0.16))",
		color: UI_COLOR.text,
		boxShadow: "inset 0 0 0 1px " + UI_COLOR.brand
	},
	buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
	mono: { fontFamily: UI_COLOR.mono, fontSize: "11px", wordBreak: "break-all" },
	tokenName: { fontFamily: UI_COLOR.mono, fontSize: "10px", color: UI_COLOR.textTertiary, wordBreak: "break-all" },
	error: { display: "inline-block", color: UI_COLOR.danger, fontSize: "11px", lineHeight: 1.5, fontFamily: "inherit" },
	okText: { color: UI_COLOR.ok, fontSize: "11px" },
	warnText: { color: UI_COLOR.warn, fontSize: "11px", lineHeight: 1.5 },
	badge: {
		display: "inline-block",
		padding: "1px 7px",
		borderRadius: "999px",
		border: "1px solid " + UI_COLOR.border,
		background: UI_COLOR.surface2,
		color: UI_COLOR.textSecondary,
		fontSize: "10px",
		lineHeight: 1.6
	},
	badgeOk: { borderColor: "transparent", background: UI_COLOR.okBg, color: UI_COLOR.ok },
	badgeBad: { borderColor: "transparent", background: UI_COLOR.dangerBg, color: UI_COLOR.danger },
	badgeWarn: { borderColor: "transparent", background: UI_COLOR.warnBg, color: UI_COLOR.warn },
	confirm: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		flexWrap: "wrap",
		padding: "7px 10px",
		marginTop: "8px",
		borderRadius: "8px",
		border: "1px solid " + UI_COLOR.danger,
		background: UI_COLOR.dangerBg
	},
	confirmText: { fontSize: "11.5px", color: UI_COLOR.danger, flex: "1 1 220px" },
	code: {
		display: "inline-block",
		padding: "1px 5px",
		borderRadius: "4px",
		background: UI_COLOR.codeBg,
		fontFamily: UI_COLOR.mono,
		fontSize: "10.5px",
		wordBreak: "break-all"
	},
	drop: {
		padding: "14px 12px",
		borderRadius: "8px",
		border: "1px dashed " + UI_COLOR.borderStrong,
		background: UI_COLOR.surface2,
		fontSize: "11.5px",
		color: UI_COLOR.textSecondary,
		textAlign: "center",
		cursor: "pointer",
		boxSizing: "border-box"
	},
	dropActive: { borderColor: UI_COLOR.brand, background: "var(--dshte-bg-accent-faint, rgba(111, 90, 168, 0.12))" },
	controls: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 },
	packCard: {
		display: "flex",
		alignItems: "center",
		gap: "9px",
		width: "100%",
		padding: "9px 10px",
		borderRadius: "9px",
		border: "1px solid " + UI_COLOR.border,
		background: UI_COLOR.surface2,
		color: "inherit",
		cursor: "pointer",
		textAlign: "left",
		fontFamily: "inherit",
		boxSizing: "border-box"
	},
	packCardActive: {
		border: "2px solid " + UI_COLOR.brand,
		background: "var(--dshte-bg-accent-faint, rgba(111, 90, 168, 0.12))",
		padding: "8px 9px"
	}
});

/* ── helpers (shared by every row) ──────────────────────────────────────── */

function uiStyle() {
	const out = {};
	for (let index = 0; index < arguments.length; index++) {
		const source = arguments[index];
		if (!source || typeof source !== "object") continue;
		for (const key of Object.keys(source)) out[key] = source[key];
	}
	return out;
}

/** "12px" / "12" / 12 → 12, anything else → null. */
function uiNumber(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
	return null;
}

/** First numeric value in a CSS length string ("12px" → 12). */
function uiLengthNumber(value) {
	const match = /^-?\d+(?:\.\d+)?/.exec(String(value === undefined || value === null ? "" : value).trim());
	return match ? Number(match[0]) : null;
}

/** Normalise a value to #rrggbb when it is a simple 3/6 digit hex colour. */
function uiHexColor(value) {
	const text = String(value === undefined || value === null ? "" : value).trim();
	let match = /^#([0-9a-f]{3})$/i.exec(text);
	if (match) return ("#" + match[1][0] + match[1][0] + match[1][1] + match[1][1] + match[1][2] + match[1][2]).toLowerCase();
	match = /^#([0-9a-f]{6})$/i.exec(text);
	if (match) return ("#" + match[1]).toLowerCase();
	return null;
}

/** Draft override lookup for one or many schemes (undefined when absent). */
function uiDraftGet(draft, schemes, token) {
	const list = Array.isArray(schemes) ? schemes : [schemes];
	const overrides = draft && draft.overrides ? draft.overrides : null;
	if (!overrides) return undefined;
	for (const scheme of list) {
		const block = overrides[scheme];
		if (block && Object.prototype.hasOwnProperty.call(block, token)) return block[token];
	}
	return undefined;
}

/** Human byte size (export/import/UI hints). */
function uiFormatBytes(bytes) {
	const value = uiNumber(bytes);
	if (value === null || value < 0) return "?";
	if (value < 1024) return value + " B";
	if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
	return (value / 1024 / 1024).toFixed(2) + " MB";
}

/** Hand-written base64 (no Buffer/btoa; the export flow needs it in the browser). */
function uiBytesToBase64(bytes) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const a = bytes[index];
		const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
		const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
		const triple = (a << 16) | (b << 8) | c;
		output += alphabet[(triple >> 18) & 63];
		output += alphabet[(triple >> 12) & 63];
		output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
		output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
	}
	return output;
}

/** Mime type for a pack asset path (fonts/images only; see host assets route). */
function uiMimeForPath(path) {
	const match = /\.([A-Za-z0-9]+)$/.exec(String(path || ""));
	const extension = match ? match[1].toLowerCase() : "";
	const map = {
		woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
		png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
		svg: "image/svg+xml", avif: "image/avif"
	};
	return map[extension] || "application/octet-stream";
}

/** Copy text with a clipboard → textarea/execCommand fallback. Never throws. */
async function uiCopyText(text) {
	try {
		if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
			await navigator.clipboard.writeText(String(text));
			return true;
		}
	} catch { /* fall through to execCommand */ }
	try {
		const area = document.createElement("textarea");
		area.value = String(text);
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.top = "-1000px";
		area.style.opacity = "0";
		document.body.appendChild(area);
		area.select();
		const ok = typeof document.execCommand === "function" && document.execCommand("copy");
		if (area.parentNode) area.parentNode.removeChild(area);
		return ok === true;
	} catch { return false; }
}

/* ── defensive store/engine accessors (parallel engine-core work) ───────── */

function uiSafeDiagnostics(engine) {
	try {
		if (engine && typeof engine.diagnostics === "function") {
			const value = engine.diagnostics();
			if (value && typeof value === "object") return value;
		}
	} catch (error) { /* diagnostics must never break the page */ }
	return {
		applied: false, enabled: null, activePackId: null, packColorScheme: null, scheme: "light", policy: "mirror",
		layerCount: 0, layerSource: null, hostTokenCount: 0, engineTokenCount: 0, requiredTokens: [], mismatch: [],
		mismatchCount: 0, missing: [], unverifiableCount: 0, fallbackNames: [], rejected: [], lastError: null, lastReason: null,
		lastApplyAt: null, hostApi: { available: null, lastError: null },
		host: { available: null, version: null, pid: null, lastError: null, checkedAt: null },
		bodyStyles: {
			count: 0, order: [], present: { vars: false, engine: false, pack: false, fonts: false },
			lateStyles: [], orderHealth: "unknown", note: "引擎未就绪，无法自检"
		},
		dreamSkin: { detected: false, cssSkin: false, materialStyle: false, bridge: false, note: "引擎未就绪" },
		layout: {
			handlePresent: null, frameGrid: null, startupFrameGrid: null, untouched: null,
			alert: { active: false, at: null, reason: null }
		},
		consoleDiag: { count: 0, lastAt: null, lastReason: null },
		autoSafeMode: { triggered: false, at: null, reason: null },
		reassert: { lastAt: null, mismatchBefore: null, mismatchAfter: null, stillOverridden: null },
		dreamSkinCssDetected: false,
		varsStylePresent: false, engineStylePresent: false, packStylePresent: false, fontsStylePresent: false,
		assetBase: null, setTokens: [], recipes: null, packCss: { present: false, ok: null, bytes: 0, rewrittenCount: 0 },
		fonts: [], customCss: null, hooks: null, componentsMissed: [], layoutUntouched: null, handlePresent: null,
		styleOrder: [], lateStyles: [], userCss: null, preview: null, safeMode: null, step: 7
	};
}

function uiSafeGetUi(store) {
	try {
		if (store && typeof store.getUi === "function") {
			const value = store.getUi();
			if (value && typeof value === "object") return value;
		}
	} catch (error) { /* store may be mid-implementation */ }
	let previewLive = true;
	try { previewLive = window.localStorage.getItem("dshte:ui:v1") !== null; } catch { /* ignore */ }
	return { previewLive };
}

function uiSafeSetUi(store, patch) {
	try {
		if (store && typeof store.setUi === "function") return store.setUi(patch);
	} catch (error) { /* ignore */ }
	return null;
}

function uiSafeIsSafeMode(store) {
	try {
		if (store && typeof store.isSafeMode === "function") return store.isSafeMode() === true;
	} catch (error) { /* ignore */ }
	try { return window.localStorage.getItem("dshte:safe:v1") === "1"; } catch { return false; }
}

function uiSafeSetSafeMode(store, on) {
	try {
		if (store && typeof store.setSafeMode === "function") { store.setSafeMode(on === true); return true; }
	} catch (error) { /* ignore */ }
	try {
		if (on === true) window.localStorage.setItem("dshte:safe:v1", "1");
		else window.localStorage.removeItem("dshte:safe:v1");
		return true;
	} catch { return false; }
}

function uiSafeGetCustomCss(store) {
	try {
		if (store && typeof store.getCustomCss === "function") {
			const value = store.getCustomCss();
			if (value && typeof value === "object") return { text: typeof value.text === "string" ? value.text : "", savedAt: value.savedAt || null };
		}
	} catch (error) { /* ignore */ }
	return { text: "", savedAt: null };
}

function uiSafeSetCustomCss(store, text) {
	try {
		if (store && typeof store.setCustomCss === "function") { store.setCustomCss(String(text == null ? "" : text)); return true; }
	} catch (error) { /* ignore */ }
	return false;
}

function uiStoreUserFonts(store) {
	try {
		if (store && store.userFonts && typeof store.userFonts === "object") return store.userFonts;
	} catch (error) { /* ignore */ }
	return null;
}

/* ── primitives ─────────────────────────────────────────────────────────── */

function UIError(props) {
	const h = React.createElement;
	if (props.children === undefined || props.children === null || props.children === "") return null;
	return h("span", { "data-dshte-error": "", role: "alert", style: uiStyle(UI_STYLE.error, props.style || null) },
		typeof props.children === "string" ? props.children : props.children);
}

function UIStatus(props) {
	const h = React.createElement;
	const rest = {};
	for (const key of Object.keys(props)) {
		if (["children", "kind", "style"].indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	return h("span", {
		role: "status",
		"aria-live": "polite",
		...rest,
		style: uiStyle({ fontSize: "11.5px", lineHeight: 1.6, color: props.kind === "bad" ? UI_COLOR.danger : props.kind === "ok" ? UI_COLOR.ok : UI_COLOR.textSecondary }, props.style || null)
	}, props.children);
}

function UIButton(props) {
	const h = React.createElement;
	const rest = {};
	for (const key of Object.keys(props)) {
		if (["primary", "danger", "pressed", "disabled", "children", "style", "title", "wide"].indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	const merged = uiStyle(
		UI_STYLE.button,
		props.danger ? UI_STYLE.buttonDanger : null,
		props.primary ? UI_STYLE.buttonPrimary : null,
		props.pressed === true ? UI_STYLE.buttonPressed : null,
		props.disabled ? UI_STYLE.buttonDisabled : null,
		props.wide ? { width: "100%" } : null,
		props.style || null
	);
	const attributes = { ...rest, type: "button", disabled: props.disabled === true, style: merged };
	if (props.title !== undefined) attributes.title = props.title;
	if (props.pressed !== undefined) attributes["aria-pressed"] = props.pressed === true;
	return h("button", attributes, props.children);
}

function UIInput(props) {
	const h = React.createElement;
	const destructured = ["value", "onInput", "onCommit", "placeholder", "style", "disabled", "type", "min", "max", "step", "inputMode", "aria-label"];
	const rest = {};
	for (const key of Object.keys(props)) {
		if (destructured.indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	const fmt = (raw) => (raw === undefined || raw === null ? "" : String(raw));
	const [text, setText] = React.useState(fmt(props.value));
	const focused = React.useRef(false);
	const lastProp = React.useRef(fmt(props.value));
	React.useEffect(() => {
		const next = fmt(props.value);
		if (next === lastProp.current) return;
		lastProp.current = next;
		if (!focused.current) setText(next);
	}, [props.value]);
	const onChange = (event) => {
		const next = event.target.value;
		setText(next);
		lastProp.current = fmt(props.value);
		if (typeof props.onInput === "function") props.onInput(next, event);
	};
	const onBlur = () => {
		focused.current = false;
		setText(fmt(props.value));
	};
	return h("input", {
		type: props.type || "text",
		value: text,
		onChange,
		onFocus: () => { focused.current = true; },
		onBlur,
		placeholder: props.placeholder,
		disabled: props.disabled === true,
		inputMode: props.inputMode,
		min: props.min,
		max: props.max,
		step: props.step,
		"aria-label": props["aria-label"],
		...rest,
		style: uiStyle(UI_STYLE.input, props.style || null)
	});
}

function UIRange(props) {
	const h = React.createElement;
	const rest = {};
	for (const key of Object.keys(props)) {
		if (["value", "onInput", "min", "max", "step", "style", "aria-label"].indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	const minimum = props.min === undefined ? 0 : props.min;
	const maximum = props.max === undefined ? 100 : props.max;
	const numeric = uiNumber(props.value);
	return h("input", {
		type: "range",
		min: minimum,
		max: maximum,
		step: props.step === undefined ? 1 : props.step,
		value: numeric === null ? minimum : numeric,
		onChange: (event) => { if (typeof props.onInput === "function") props.onInput(event.target.value, event); },
		"aria-label": props["aria-label"],
		...rest,
		style: uiStyle(UI_STYLE.range, props.style || null)
	});
}

function UISelect(props) {
	const h = React.createElement;
	const rest = {};
	for (const key of Object.keys(props)) {
		if (["value", "onChange", "options", "style", "aria-label"].indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	const list = Array.isArray(props.options) ? props.options : [];
	const current = props.value === undefined || props.value === null ? "" : String(props.value);
	return h("select", {
		value: current,
		onChange: (event) => { if (typeof props.onChange === "function") props.onChange(event.target.value, event); },
		"aria-label": props["aria-label"],
		...rest,
		style: uiStyle(UI_STYLE.select, props.style || null)
	}, list.map((entry) => {
		const pair = Array.isArray(entry) ? entry : [entry, String(entry)];
		return h("option", { key: String(pair[0]), value: String(pair[0]) }, pair[1]);
	}));
}

function UIToggle(props) {
	const h = React.createElement;
	// UIButton already forwards unknown props (data-* / aria-*) to the <button>;
	// forwarding here keeps [data-dshte-policy] / [data-dshte-scheme] etc. intact.
	const attributes = { ...props };
	attributes.pressed = props.pressed === true;
	return h(UIButton, attributes, props.children);
}

function UIRow(props) {
	const h = React.createElement;
	return h("div", { style: props.stack ? UI_STYLE.rowStack : UI_STYLE.row },
		props.label ? h("span", { style: uiStyle(UI_STYLE.label, props.labelStyle || null) }, props.label) : null,
		h("span", { style: UI_STYLE.controls }, props.children),
		props.hint ? h("span", { style: UI_STYLE.hint }, props.hint) : null,
		props.error ? h(UIError, null, props.error) : null
	);
}

function UICard(props) {
	const h = React.createElement;
	// Forward unknown props (data-* / role / aria-*) to the row root: Step 7 needs
	// stable hooks like data-reassert-state on [data-dshte-row="diagnostics"].
	const rest = {};
	for (const key of Object.keys(props)) {
		if (["rowId", "tone", "style", "tight", "title", "note", "actions", "children"].indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	const head = [];
	if (props.title) {
		head.push(h("div", { key: "title", style: UI_STYLE.titleRow },
			h("span", { style: UI_STYLE.title }, props.title),
			props.actions ? h("span", { style: UI_STYLE.titleActions }, props.actions) : null
		));
	}
	if (props.note) head.push(h("div", { key: "note", style: uiStyle(UI_STYLE.note, { marginTop: 0, marginBottom: props.children ? "8px" : 0 }) }, props.note));
	const children = [];
	if (head.length > 0) children.push(h("div", { key: "head" }, head));
	if (props.children !== undefined && props.children !== null) children.push(h("div", { key: "body" }, props.children));
	return h("section", {
		"data-dshte-row": props.rowId,
		"data-dshte-tone": props.tone,
		...rest,
		style: uiStyle(UI_STYLE.card, props.tight ? UI_STYLE.cardTight : null, props.style || null)
	}, children);
}

function UIInlineConfirm(props) {
	const h = React.createElement;
	const rest = {};
	for (const key of Object.keys(props)) {
		if (["id", "message", "confirmLabel", "cancelLabel", "onConfirm", "onCancel", "busy", "style"].indexOf(key) >= 0) continue;
		rest[key] = props[key];
	}
	return h("div", {
		"data-dshte-confirm": props.id,
		role: "group",
		"aria-label": "确认操作",
		...rest,
		style: uiStyle(UI_STYLE.confirm, props.style || null)
	},
		h("span", { style: UI_STYLE.confirmText }, props.message),
		h(UIButton, { primary: true, disabled: props.busy === true, "data-dshte-action": "confirm", onClick: props.onConfirm }, props.confirmLabel || "确认"),
		h(UIButton, { "data-dshte-action": "cancel-confirm", onClick: props.onCancel }, props.cancelLabel || "取消")
	);
}

function UINote(props) {
	const h = React.createElement;
	return h("div", { style: uiStyle(UI_STYLE.note, props.style || null), "data-dshte-note": props.noteId }, props.children);
}

function UIBadge(props) {
	const h = React.createElement;
	return h("span", { style: uiStyle(UI_STYLE.badge, props.ok ? UI_STYLE.badgeOk : props.bad ? UI_STYLE.badgeBad : props.warn ? UI_STYLE.badgeWarn : null, props.style || null), "data-dshte-badge": props.name }, props.children);
}

function UIMono(props) {
	const h = React.createElement;
	return h("code", { style: uiStyle(UI_STYLE.code, props.style || null) }, props.children);
}

function UIGrid(props) {
	const h = React.createElement;
	return h("div", { style: uiStyle(props.wide ? UI_STYLE.gridWide : UI_STYLE.grid, props.style || null) }, props.children);
}

/* Contract §6.2 style object: `const UI = { wrap, card, title, ... }` shorthand. */
const UI = Object.freeze({
	wrap: { display: "grid", gap: "10px", padding: "2px 2px 22px", fontSize: "12.5px", color: UI_COLOR.text, boxSizing: "border-box" },
	card: UICard,
	title: UI_STYLE.title,
	note: UINote,
	row: UIRow,
	grid: UIGrid,
	button: UIButton,
	buttonPrimary: function UIButtonPrimary(props) { return React.createElement(UIButton, { ...props, primary: true }); },
	buttonDanger: function UIButtonDanger(props) { return React.createElement(UIButton, { ...props, danger: true }); },
	mono: UIMono,
	bad: function UIBad(props) { return React.createElement("span", { style: UI_COLOR.danger }, props.children); },
	ok: function UIOk(props) { return React.createElement("span", { style: UI_COLOR.ok }, props.children); },
	input: UIInput,
	select: UISelect,
	range: UIRange,
	toggle: UIToggle,
	error: UIError,
	status: UIStatus,
	confirm: UIInlineConfirm,
	badge: UIBadge
});
