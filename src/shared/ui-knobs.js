/**
 * dsh-tavern-skin-engine — Step 5 UI knob model (pure, shared by the settings
 * UI, the engine and `tests/ui-knobs.test.mjs`).
 *
 * The settings page edits token overrides (`state.overrides[light|dark]`) only,
 * so this module is the single translation layer between a nicer UI vocabulary
 * (colors / typography / shape / regions / components) and the `--dshte-*`
 * variables that `recipes.js` + `engine.css` consume:
 *
 *   region.<region>.<prop>        -> --dshte-region-<region>-<suffix>
 *   component.<component>.<knob>  -> --dshte-<component>-<alias|knob>
 *   typography.<group>.<key>      -> --dshte-font-*|text-*|weight-*|leading-*|tracking-*
 *
 * `buildKnobModel(pack, { baseVars, recipeVars })` returns everything the UI
 * needs to render rows 8–12 (labels, defaults, token names, opt-in set tokens,
 * min/max/step). Defaults come from the already-compiled pack values so the UI
 * never re-implements value normalization.
 *
 * Build note: this file is inlined into the classic client bundle by
 * scripts/build-client.mjs (`// @inline-shared`), which strips leading
 * `export ` keywords. It must not contain import statements.
 */

/* ── vocabulary ─────────────────────────────────────────────────────────── */

export const STEP5_ROW_IDS = Object.freeze([
	"pack", "preview", "preview-live", "import", "export", "manage", "scheme",
	"colors", "typography", "shape", "regions", "components", "custom-css",
	"diagnostics", "advanced"
]);

const UI_SCHEMES = ["light", "dark"];

export const REGION_DEFS = Object.freeze([
	{ key: "sidebar", label: "左栏" },
	{ key: "center", label: "中栏" },
	{ key: "rightbar", label: "右栏" },
	{ key: "composer", label: "输入坞" },
	{ key: "settings", label: "设置页" }
]);

export const REGION_PROP_DEFS = Object.freeze([
	{ prop: "background", label: "背景色", suffix: "bg", kind: "color" },
	{ prop: "backgroundImage", label: "背景图", suffix: "bg-image", kind: "text", hint: "url(assets/images/…)" },
	{ prop: "borderColor", label: "边线颜色", suffix: "border-color", kind: "color", ui: false },
	{ prop: "borderWidth", label: "边线宽度", suffix: "border-width", kind: "length" },
	{ prop: "shadow", label: "阴影", suffix: "shadow", kind: "text" },
	{ prop: "opacity", label: "透明度", suffix: "opacity", kind: "opacity" },
	{ prop: "backdropFilter", label: "背景模糊", suffix: "backdrop", kind: "text" }
]);

export const REGION_PROP_SUFFIX = Object.freeze(Object.fromEntries(REGION_PROP_DEFS.map((entry) => [entry.prop, entry.suffix])));
export const REGION_PROP_BY_SUFFIX = Object.freeze(Object.fromEntries(REGION_PROP_DEFS.map((entry) => [entry.suffix, entry.prop])));

/** Component knob vocabulary (must match pack-schema.js COMPONENT_KNOBS). */
export const COMPONENT_DEFS = Object.freeze([
	{ key: "card", label: "消息卡", knobs: ["background", "color", "borderWidth", "radius", "shadow", "paddingX", "paddingY"] },
	{ key: "buttonPrimary", label: "主按钮", knobs: ["background", "color", "borderWidth", "radius", "shadow", "height", "fontSize", "fontWeight", "paddingX", "paddingY"] },
	{ key: "buttonDanger", label: "危险按钮", knobs: ["background", "color", "borderWidth", "radius", "height", "fontSize", "fontWeight", "paddingX", "paddingY"] },
	{ key: "buttonGhost", label: "次级按钮", knobs: ["background", "color", "borderWidth", "radius", "height", "fontSize", "fontWeight", "paddingX", "paddingY"] },
	{ key: "input", label: "输入框", knobs: ["background", "color", "borderWidth", "radius", "shadow", "fontSize", "lineHeight", "paddingX", "paddingY", "placeholderColor"] },
	{ key: "quote", label: "引用块", knobs: ["background", "color", "borderWidth", "radius", "fontSize", "lineHeight", "letterSpacing", "paddingX", "paddingY"] },
	{ key: "navItem", label: "导航项", knobs: ["color", "activeBackground", "activeColor", "radius", "height", "fontSize", "fontWeight", "paddingX", "paddingY"] },
	{ key: "eyebrow", label: "眉标", knobs: ["color", "fontSize", "fontWeight", "letterSpacing", "textTransform"] },
	{ key: "badge", label: "徽标", knobs: ["background", "color", "borderWidth", "radius", "fontSize", "fontWeight", "paddingX", "paddingY"] },
	{ key: "fileCard", label: "文件卡", knobs: ["background", "color", "borderWidth", "radius", "shadow", "fontSize", "lineHeight", "paddingX", "paddingY"] },
	{ key: "codeBlock", label: "代码块", knobs: ["background", "color", "borderWidth", "radius", "fontSize", "lineHeight", "paddingX", "paddingY"] }
]);

/** knob label + control kind (pack-schema COMPONENT_KNOBS vocabulary). */
export const KNOB_DEFS = Object.freeze({
	background: { label: "背景", kind: "color" },
	color: { label: "文字色", kind: "color" },
	borderColor: { label: "边线色", kind: "color" },
	activeBackground: { label: "激活背景", kind: "color" },
	activeColor: { label: "激活文字", kind: "color" },
	placeholderColor: { label: "占位色", kind: "color" },
	borderWidth: { label: "边线宽", kind: "length", min: 0, max: 12, step: 1 },
	radius: { label: "圆角", kind: "length", min: 0, max: 64, step: 1 },
	shadow: { label: "阴影", kind: "text" },
	height: { label: "高度", kind: "length", min: 16, max: 96, step: 1 },
	fontSize: { label: "字号", kind: "length", min: 8, max: 40, step: 0.5 },
	fontWeight: { label: "字重", kind: "weight" },
	paddingX: { label: "横向内距", kind: "length", min: 0, max: 64, step: 1 },
	paddingY: { label: "纵向内距", kind: "length", min: 0, max: 64, step: 1 },
	lineHeight: { label: "行高", kind: "lineHeight", min: 0.8, max: 3, step: 0.05 },
	letterSpacing: { label: "字距", kind: "text" },
	textTransform: { label: "大小写", kind: "enum", options: [["none", "原样"], ["uppercase", "全大写"], ["lowercase", "全小写"], ["capitalize", "首字母大写"]] },
	borderStyle: { label: "边线样式", kind: "enum", options: [["solid", "实线"], ["dashed", "虚线"], ["dotted", "点线"]] }
});

/** Component knob -> variable suffix (engine.css reads --dshte-<component>-<suffix>). */
const COMPONENT_VAR_ALIAS = Object.freeze({ background: "bg", activeBackground: "active-bg", activeColor: "active-color" });

export const TYPOGRAPHY_DEFS = Object.freeze({
	fonts: [
		{ key: "sans", label: "无衬线（界面）", kind: "font" },
		{ key: "latin", label: "西文", kind: "font" },
		{ key: "display", label: "展示字体", kind: "font" },
		{ key: "mono", label: "等宽", kind: "font" }
	],
	sizes: [
		{ key: "eyebrow", label: "眉标" }, { key: "brand", label: "品牌" }, { key: "panel", label: "面板" },
		{ key: "h2", label: "标题" }, { key: "body", label: "正文" }, { key: "note", label: "注释" },
		{ key: "nav", label: "导航" }, { key: "group", label: "分组" }, { key: "button", label: "按钮" },
		{ key: "meta", label: "元信息" }, { key: "chip", label: "药丸" }
	],
	weights: [
		{ key: "regular", label: "常规" }, { key: "medium", label: "中等" },
		{ key: "semibold", label: "半粗" }, { key: "bold", label: "粗" }, { key: "black", label: "特粗" }
	],
	leading: [{ key: "body", label: "正文行高" }, { key: "tight", label: "紧凑行高" }],
	tracking: [{ key: "eyebrow", label: "眉标字距" }]
});

export const RADII_DEFS = Object.freeze([
	{ key: "quote", label: "引用块" }, { key: "sm", label: "小" }, { key: "card", label: "卡片" },
	{ key: "input", label: "输入" }, { key: "pill", label: "药丸" }
]);

export const SPACING_DEFS = Object.freeze([
	{ key: "xxs", label: "极紧" }, { key: "xs", label: "紧凑" }, { key: "sm", label: "小" },
	{ key: "md", label: "中" }, { key: "lg", label: "大" }, { key: "xl", label: "超大" },
	{ key: "xxl", label: "特大" }, { key: "xxxl", label: "巨大" }, { key: "inputPad", label: "输入内距" },
	{ key: "sidebarInset", label: "左栏内距" }, { key: "navPadX", label: "导航内距" },
	{ key: "rightbarInset", label: "右栏内距" }
]);

export const SHADOW_DEFS = Object.freeze([
	{ key: "card", label: "卡片阴影" }, { key: "spine", label: "书脊阴影" }, { key: "line", label: "线条色" }
]);

/** Color groups for row 8 (token name -> Chinese label). Unknown tokens go to "其它". */
export const COLOR_GROUPS = Object.freeze([
	{
		key: "surface", label: "面", tokens: {
			"--dsw-alias-bg-base": "底色",
			"--dsw-alias-bg-layer-1": "层 1",
			"--dsw-alias-bg-layer-2": "层 2",
			"--dsw-alias-bg-layer-3": "层 3",
			"--dsw-specific-sidebar-fill": "左栏底",
			"--dsw-specific-input-major": "输入底",
			"--dsw-specific-bubble": "气泡底",
			"--dsw-alias-markdown-code-block": "代码块底",
			"--dshte-bg-base": "纸底",
			"--dshte-bg-sidebar": "左栏底",
			"--dshte-bg-gutter": "槽底",
			"--dshte-bg-sunken": "下沉底",
			"--dshte-bg-surface": "卡面",
			"--dshte-bg-elevated": "浮层",
			"--dshte-bg-muted": "弱底",
			"--dshte-bg-accent-soft": "强调软底",
			"--dshte-bg-accent-faint": "强调淡底"
		}
	},
	{
		key: "text", label: "文字", tokens: {
			"--dsw-alias-label-primary": "主文字",
			"--dsw-alias-label-secondary": "次文字",
			"--dsw-alias-label-tertiary": "三级文字",
			"--dshte-fg-primary": "标题",
			"--dshte-fg-body": "正文",
			"--dshte-fg-secondary": "次级",
			"--dshte-fg-muted": "弱化",
			"--dshte-fg-placeholder": "占位",
			"--dshte-fg-eyebrow": "眉标",
			"--dshte-fg-inverse": "反白"
		}
	},
	{
		key: "accent", label: "强调", tokens: {
			"--dsw-alias-brand-primary": "品牌色",
			"--dsw-alias-brand-text": "品牌文字",
			"--dsw-alias-button-primary-hover": "主按钮悬停",
			"--dsw-alias-interactive-bg-hover": "交互悬停",
			"--dsw-alias-interactive-bg-active": "交互激活",
			"--dsh-tavern-accent": "酒馆强调",
			"--dsh-tavern-accent-soft": "酒馆强调软",
			"--dsh-tavern-accent-hairline": "酒馆强调线",
			"--dshte-accent": "强调",
			"--dshte-accent-weak": "强调弱",
			"--dshte-accent-rule": "强调线",
			"--dshte-accent-ink": "强调墨",
			"--dshte-accent-pill": "强调药丸"
		}
	},
	{
		key: "line", label: "线", tokens: {
			"--dsw-alias-border-l1": "边线 1",
			"--dsw-alias-border-l2": "边线 2",
			"--dshte-border-hairline": "发丝线",
			"--dshte-border-rule": "分隔线",
			"--dshte-border-sidebar": "左栏线",
			"--dshte-shadow-line": "阴影线"
		}
	},
	{
		key: "state", label: "状态", tokens: {
			"--dshte-danger": "危险",
			"--dshte-danger-bg": "危险底",
			"--dshte-success": "成功",
			"--dshte-success-bg": "成功底",
			"--dshte-success-ink": "成功墨"
		}
	},
	{
		key: "hostshape", label: "形状（宿主 token）", kind: "length", tokens: {
			"--dsh-tavern-radius-sm": "小圆角",
			"--dsh-tavern-radius-md": "中圆角",
			"--dsh-tavern-radius-lg": "大圆角"
		}
	}
]);

const COLOR_GROUP_BY_TOKEN = (() => {
	const map = new Map();
	for (const group of COLOR_GROUPS) for (const name of Object.keys(group.tokens)) map.set(name, group);
	return map;
})();

/* ── name mapping ───────────────────────────────────────────────────────── */

export function kebabCase(name) {
	return String(name).replace(/[A-Z]/g, (char) => "-" + char.toLowerCase());
}

function camelize(name) {
	return String(name).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function regionVarName(region, prop) {
	const suffix = REGION_PROP_SUFFIX[prop];
	if (!suffix) return null;
	return `--dshte-region-${kebabCase(region)}-${suffix}`;
}

export function regionSetToken(region, prop) {
	if (!REGION_PROP_SUFFIX[prop]) return null;
	return `region.${region}.${prop}`;
}

export function componentVarName(component, knob) {
	if (!(KNOB_DEFS[knob] || knob === "borderColor")) return null;
	return `--dshte-${kebabCase(component)}-${COMPONENT_VAR_ALIAS[knob] || kebabCase(knob)}`;
}

export function componentSetToken(component, knob) {
	if (!(KNOB_DEFS[knob] || knob === "borderColor")) return null;
	return `${component}.${knob}`;
}

const TYPOGRAPHY_GROUPS = Object.freeze({ fonts: "font", sizes: "text", weights: "weight", leading: "leading", tracking: "tracking" });

export function typographyVarName(group, key) {
	const mapped = TYPOGRAPHY_GROUPS[group] || group;
	return `--dshte-${mapped}-${kebabCase(key)}`;
}

export function typographySetToken(group, key) {
	const mapped = TYPOGRAPHY_GROUPS[group] || group;
	return `typography.${mapped}.${kebabCase(key)}`;
}

/** Reverse map: variable name -> opt-in set token (built once, deterministic). */
const VAR_TO_SET = (() => {
	const map = new Map();
	for (const region of REGION_DEFS) {
		for (const def of REGION_PROP_DEFS) map.set(regionVarName(region.key, def.prop), regionSetToken(region.key, def.prop));
	}
	for (const component of COMPONENT_DEFS) {
		for (const knob of component.knobs) map.set(componentVarName(component.key, knob), componentSetToken(component.key, knob));
	}
	for (const [group, list] of Object.entries(TYPOGRAPHY_DEFS)) {
		for (const entry of list) map.set(typographyVarName(group, entry.key), typographySetToken(group, entry.key));
	}
	return map;
})();

export function setTokenForVar(varName) {
	return VAR_TO_SET.get(String(varName)) || null;
}

/** Opt-in set tokens implied by user overrides (both schemes, sorted unique). */
export function deriveExtraSetTokens(overrides) {
	const set = new Set();
	if (!overrides || typeof overrides !== "object") return [];
	for (const scheme of UI_SCHEMES) {
		const block = overrides[scheme];
		if (!block || typeof block !== "object") continue;
		for (const name of Object.keys(block)) {
			const token = setTokenForVar(name);
			if (token) set.add(token);
		}
	}
	return [...set].sort();
}

/** Set tokens for the pack-level typography sugar (fonts/text/weight/leading/tracking). */
export function baseVarSetTokens(baseVars) {
	const out = [];
	if (!baseVars || typeof baseVars !== "object") return out;
	for (const name of Object.keys(baseVars)) {
		const token = setTokenForVar(name);
		if (token && token.startsWith("typography.")) out.push(token);
	}
	return out.sort();
}

/* ── value validation ───────────────────────────────────────────────────── */

const UNSAFE_VALUE = /[;}<]|<\/style|@import|javascript:|expression\(/i;

function plainValue(value, maxLength) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > maxLength) return null;
	if (UNSAFE_VALUE.test(trimmed)) return null;
	return trimmed;
}

function numeric(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
	return null;
}

const LENGTH_RE = /^-?\d+(?:\.\d+)?(?:px|rem|em|%)$/;
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\(/i;

/**
 * Validate + normalize a knob value.
 * @returns {{ok: boolean, value?: string, error?: string}}
 */
export function normalizeKnobValue(kind, value) {
	switch (kind) {
		case "color": {
			const text = plainValue(value, 200);
			if (!text) return { ok: false, error: "颜色值不合法（不能为空，且不能含 ; } < 等字符）" };
			if (HEX_RE.test(text)) return { ok: true, value: text.toLowerCase() };
			if (COLOR_FN_RE.test(text)) return { ok: true, value: text };
			if (/^[a-z]+$/i.test(text) || text === "currentColor") return { ok: true, value: text };
			return { ok: false, error: "颜色需要 #rgb/#rrggbb、rgb()/hsl()/color-mix()/var() 或颜色名" };
		}
		case "font": {
			const text = plainValue(value, 300);
			return text ? { ok: true, value: text } : { ok: false, error: "字体栈不合法（不能为空，且不能含 ; } < 等字符）" };
		}
		case "text": {
			const text = plainValue(value, 2000);
			return text ? { ok: true, value: text } : { ok: false, error: "值不合法（不能为空，且不能含 ; } < 等字符）" };
		}
		case "length": {
			const number = numeric(value);
			if (number !== null) return { ok: true, value: `${number}px` };
			const text = plainValue(value, 60);
			if (text && LENGTH_RE.test(text)) return { ok: true, value: text };
			return { ok: false, error: "需要数字（px）或 px/rem/em/% 长度" };
		}
		case "number": {
			const number = numeric(value);
			if (number === null || number < -10000 || number > 10000) return { ok: false, error: "需要 -10000…10000 的数字" };
			return { ok: true, value: String(number) };
		}
		case "weight": {
			const number = numeric(value);
			if (number === null || number < 100 || number > 900 || number % 100 !== 0) return { ok: false, error: "字重需要 100–900（步长 100）" };
			return { ok: true, value: String(number) };
		}
		case "lineHeight": {
			const number = numeric(value);
			if (number !== null) {
				if (number < 0.5 || number > 4) return { ok: false, error: "行高倍数需要 0.5–4" };
				return { ok: true, value: String(number) };
			}
			const text = plainValue(value, 60);
			if (text && LENGTH_RE.test(text)) return { ok: true, value: text };
			return { ok: false, error: "行高需要 0.5–4 的倍数或长度" };
		}
		case "opacity": {
			const number = numeric(value);
			if (number === null || number < 0 || number > 1) return { ok: false, error: "透明度需要 0–1（如 0.85）" };
			return { ok: true, value: String(number) };
		}
		case "enum": {
			const text = typeof value === "string" ? value.trim() : "";
			return text ? { ok: true, value: text } : { ok: false, error: "需要选择一个枚举值" };
		}
		default:
			return { ok: false, error: `未知的值类型：${kind}` };
	}
}

/* ── model builder ──────────────────────────────────────────────────────── */

function colorKind(value) {
	if (typeof value !== "string") return "text";
	const text = value.trim();
	if (HEX_RE.test(text) || COLOR_FN_RE.test(text) || /^(transparent|currentcolor|[a-z]+)$/i.test(text)) return "color";
	return "text";
}

function colorGroupsForScheme(tokens) {
	const source = tokens && typeof tokens === "object" ? tokens : {};
	const seen = new Set();
	const groups = [];
	for (const group of COLOR_GROUPS) {
		const entries = [];
		for (const [name, label] of Object.entries(group.tokens)) {
			if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
			seen.add(name);
			entries.push({ name, label, kind: group.kind || colorKind(source[name]), value: source[name] });
		}
		if (entries.length > 0) groups.push({ key: group.key, label: group.label, tokens: entries });
	}
	const other = [];
	for (const [name, value] of Object.entries(source)) {
		if (seen.has(name)) continue;
		const group = COLOR_GROUP_BY_TOKEN.get(name);
		other.push({ name, label: group ? group.tokens[name] : name, kind: colorKind(value), value });
	}
	if (other.length > 0) groups.push({ key: "other", label: "其它", tokens: other });
	return groups;
}

function typographyControls(group, kind, extra) {
	return TYPOGRAPHY_DEFS[group].map((entry) => ({
		id: `${TYPOGRAPHY_GROUPS[group]}.${kebabCase(entry.key)}`,
		group: TYPOGRAPHY_GROUPS[group],
		key: entry.key,
		label: entry.label,
		token: typographyVarName(group, entry.key),
		setToken: typographySetToken(group, entry.key),
		kind: entry.kind || kind,
		...(extra || {})
	}));
}

/**
 * Build the row 8–12 data model.
 * @param {object} pack validated theme.json
 * @param {{baseVars?: object, recipeVars?: object}} [defaults] compiled pack values
 */
export function buildKnobModel(pack, defaults = {}) {
	const baseVars = defaults.baseVars && typeof defaults.baseVars === "object" ? defaults.baseVars : {};
	const recipeVars = defaults.recipeVars && typeof defaults.recipeVars === "object" ? defaults.recipeVars : {};
	const tokens = pack && pack.tokens && typeof pack.tokens === "object" ? pack.tokens : {};

	const sourceScheme = pack && pack.colorScheme === "dark" ? "dark" : "light";
	const sourceTokens = tokens[sourceScheme] || tokens.light || tokens.dark || {};
	const colors = {
		light: colorGroupsForScheme(tokens.light || sourceTokens),
		dark: colorGroupsForScheme(tokens.dark || sourceTokens)
	};

	const typography = {
		fonts: typographyControls("fonts", "font").map((entry) => ({ ...entry, defaultValue: baseVars[entry.token] })),
		sizes: typographyControls("sizes", "length", { min: 8, max: 48, step: 0.5 }).map((entry) => ({ ...entry, defaultValue: baseVars[entry.token] })),
		weights: typographyControls("weights", "weight").map((entry) => ({ ...entry, defaultValue: baseVars[entry.token] })),
		leading: typographyControls("leading", "lineHeight", { min: 0.8, max: 3, step: 0.05 }).map((entry) => ({ ...entry, defaultValue: baseVars[entry.token] })),
		tracking: typographyControls("tracking", "text").map((entry) => ({ ...entry, defaultValue: baseVars[entry.token] }))
	};

	const shape = {
		radii: RADII_DEFS.map((entry) => ({
			id: `radius.${entry.key}`, key: entry.key, label: entry.label,
			token: `--dshte-radius-${kebabCase(entry.key)}`, setToken: null,
			kind: "length", min: 0, max: 64, step: 1, defaultValue: baseVars[`--dshte-radius-${kebabCase(entry.key)}`]
		})),
		spacing: SPACING_DEFS.map((entry) => ({
			id: `space.${entry.key}`, key: entry.key, label: entry.label,
			token: `--dshte-space-${kebabCase(entry.key)}`, setToken: null,
			kind: "length", min: 0, max: 128, step: 1, defaultValue: baseVars[`--dshte-space-${kebabCase(entry.key)}`]
		})),
		shadows: SHADOW_DEFS.map((entry) => ({
			id: `shadow.${entry.key}`, key: entry.key, label: entry.label,
			token: `--dshte-shadow-${kebabCase(entry.key)}`, setToken: null,
			kind: "text", defaultValue: baseVars[`--dshte-shadow-${kebabCase(entry.key)}`]
		}))
	};

	const regions = REGION_DEFS.map((region) => ({
		key: region.key,
		label: region.label,
		props: REGION_PROP_DEFS.filter((def) => def.ui !== false).map((def) => {
			const token = regionVarName(region.key, def.prop);
			return {
				id: `${region.key}.${def.prop}`, prop: def.prop, label: def.label, hint: def.hint || null,
				token, setToken: regionSetToken(region.key, def.prop), kind: def.kind,
				defaultValue: recipeVars[token]
			};
		})
	}));

	const components = COMPONENT_DEFS.map((component) => ({
		key: component.key,
		label: component.label,
		knobs: component.knobs.map((knob) => {
			const def = KNOB_DEFS[knob];
			const token = componentVarName(component.key, knob);
			return {
				id: `${component.key}.${knob}`, knob, label: def.label, token,
				setToken: componentSetToken(component.key, knob), kind: def.kind,
				min: def.min, max: def.max, step: def.step, options: def.options || null,
				defaultValue: recipeVars[token]
			};
		})
	}));

	return {
		packId: pack && pack.id ? pack.id : null,
		scheme: pack && pack.colorScheme === "dark" ? "dark" : "light",
		colors, typography, shape, regions, components
	};
}

/* ── small draft helpers (used by the settings page) ────────────────────── */

/** Effective value: user override if present, else pack default. */
export function overrideValue(overrides, scheme, token) {
	const block = overrides && overrides[scheme];
	if (block && Object.prototype.hasOwnProperty.call(block, token)) return block[token];
	return undefined;
}

/**
 * Immutable override update. Passing value === null/undefined deletes the token.
 * @param {object} overrides current {light,dark}
 * @param {string[]|string} schemes scheme(s) to write
 * @param {string} token token name
 * @param {string|null|undefined} value
 */
export function withTokenOverride(overrides, schemes, token, value) {
	const list = Array.isArray(schemes) ? schemes : [schemes];
	const next = {
		light: { ...((overrides && overrides.light) || {}) },
		dark: { ...((overrides && overrides.dark) || {}) }
	};
	for (const scheme of list) {
		if (!next[scheme]) continue;
		if (value === null || value === undefined || value === "") delete next[scheme][token];
		else next[scheme][token] = value;
	}
	return next;
}

export function countOverrides(overrides) {
	let total = 0;
	for (const scheme of UI_SCHEMES) {
		const block = overrides && overrides[scheme];
		if (block && typeof block === "object") total += Object.keys(block).length;
	}
	return total;
}
