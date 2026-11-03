/**
 * dsh-tavern-skin-engine — theme pack v1 schema + validators.
 *
 * Pure module (no Node/DOM APIs) shared by:
 *   - scripts/pack-check.mjs          (CLI validation)
 *   - the browser half (Step 3+)      (runtime validation before applying a pack)
 *   - the host half (Step 6+)         (re-validate anything arriving over HTTP)
 *
 * Design rules (方案 §2.3/§2.4/§2.5):
 *   - error   → the pack must NOT load
 *   - warning → the pack loads, the settings page shows a yellow note
 *   - nothing is silently dropped: unknown fields produce a warning with a
 *     field path, invalid values produce an error with a field path + reason.
 *
 * Path convention: `tokens.light["--dsw-alias-bg-base"]`, `regions.sidebar.width`.
 */

export const PACK_FORMAT = "dshte.theme";
export const PACK_FORMAT_VERSION = 1;

/** Version stamped into bundles and compared against `engine`. */
export const ENGINE_VERSION = "0.1.0";

export const LIMITS = Object.freeze({
	packBytes: 16 * 1024 * 1024,
	fileBytes: 8 * 1024 * 1024,
	cssBytes: 1024 * 1024,
	fileCount: 200,
	tokenCount: 400,
	packCount: 100
});

/** Tokens dream-skin also requires; keeps existing packs portable (调查报告 §1.2). */
export const REQUIRED_TOKENS = Object.freeze([
	"--dsw-alias-bg-base",
	"--dsw-alias-bg-layer-1",
	"--dsw-alias-brand-primary",
	"--dsw-alias-label-primary",
	"--dsw-alias-label-secondary",
	"--dsw-alias-border-l1",
	"--dsw-alias-border-l2"
]);

export const TOKEN_PREFIXES = Object.freeze(["--dsw-", "--dsh-tavern-", "--dshte-"]);

export const SCHEME_POLICIES = Object.freeze(["mirror", "inherit"]);
export const COLOR_SCHEMES = Object.freeze(["light", "dark"]);

export const TOP_LEVEL_KNOWN = Object.freeze([
	"format", "formatVersion", "release", "id", "name", "nameZh", "author",
	"description", "license", "homepage", "tags", "engine", "colorScheme",
	"missingScheme", "tokens", "typography", "radii", "spacing", "shadows",
	"regions", "components", "preview", "assets", "css"
]);

export const TYPOGRAPHY_KEYS = Object.freeze([
	"sans", "latin", "display", "mono", "sizes", "weights", "leading", "tracking", "fonts"
]);
export const TYPOGRAPHY_SIZE_KEYS = Object.freeze([
	"eyebrow", "brand", "panel", "h2", "body", "note", "nav", "group", "button", "meta", "chip"
]);
export const TYPOGRAPHY_WEIGHT_KEYS = Object.freeze(["regular", "medium", "semibold", "bold", "black"]);
export const TYPOGRAPHY_LEADING_KEYS = Object.freeze(["body", "tight"]);
export const TYPOGRAPHY_TRACKING_KEYS = Object.freeze(["eyebrow"]);

export const RADII_KEYS = Object.freeze(["quote", "sm", "card", "input", "pill"]);
export const SPACING_KEYS = Object.freeze([
	"xxs", "xs", "sm", "md", "lg", "xl", "xxl", "xxxl",
	"inputPad", "sidebarInset", "navPadX", "rightbarInset"
]);
export const SHADOW_KEYS = Object.freeze(["card", "spine", "line"]);

export const REGION_NAMES = Object.freeze(["sidebar", "center", "rightbar", "composer", "settings"]);
export const REGION_PROPS = Object.freeze([
	"background", "backgroundImage", "borderColor", "borderWidth",
	"shadow", "opacity", "backdropFilter"
]);
/** Anything layout-changing is forbidden in regions (方案 §2.5). */
export const REGION_FORBIDDEN_PROPS = Object.freeze([
	"width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
	"padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
	"margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
	"display", "position", "inset", "top", "right", "bottom", "left",
	"grid", "gridTemplateColumns", "gridTemplateRows", "gridArea",
	"flex", "flexDirection", "order", "transform", "overflow", "zIndex"
]);

export const COMPONENT_NAMES = Object.freeze([
	"card", "buttonPrimary", "buttonDanger", "buttonGhost", "input", "quote",
	"navItem", "eyebrow", "badge", "fileCard", "codeBlock"
]);

/** Per-component knob vocabulary (方案 §2.5). */
const COLOR_KNOBS = ["background", "color", "borderColor", "activeBackground", "activeColor", "placeholderColor"];
const LENGTH_KNOBS = ["radius", "height", "fontSize", "paddingX", "paddingY", "borderWidth"];
const TEXT_KNOBS = ["fontWeight", "lineHeight", "letterSpacing", "textTransform", "borderStyle", "shadow"];
export const COMPONENT_KNOBS = Object.freeze({
	card: [...COLOR_KNOBS, "borderWidth", "radius", "shadow", "paddingX", "paddingY"],
	buttonPrimary: [...COLOR_KNOBS, "borderWidth", "radius", "shadow", "height", "fontSize", "fontWeight", "paddingX", "paddingY"],
	buttonDanger: [...COLOR_KNOBS, "borderWidth", "radius", "shadow", "height", "fontSize", "fontWeight", "paddingX", "paddingY"],
	buttonGhost: [...COLOR_KNOBS, "borderWidth", "radius", "shadow", "height", "fontSize", "fontWeight", "paddingX", "paddingY"],
	input: [...COLOR_KNOBS, "borderWidth", "radius", "shadow", "fontSize", "lineHeight", "paddingX", "paddingY"],
	quote: [...COLOR_KNOBS, "borderWidth", "borderStyle", "radius", "fontSize", "lineHeight", "paddingX", "paddingY", "letterSpacing"],
	navItem: ["color", "activeBackground", "activeColor", "radius", "height", "fontSize", "fontWeight", "paddingX", "paddingY"],
	eyebrow: ["color", "fontSize", "fontWeight", "letterSpacing", "textTransform"],
	badge: ["background", "color", "borderColor", "borderWidth", "radius", "fontSize", "fontWeight", "paddingX", "paddingY"],
	fileCard: [...COLOR_KNOBS, "borderWidth", "radius", "shadow", "fontSize", "lineHeight", "paddingX", "paddingY"],
	codeBlock: ["background", "color", "borderColor", "borderWidth", "radius", "fontSize", "lineHeight", "paddingX", "paddingY"]
});

/** font file / image file / document whitelists (方案 §2.2). */
export const FILE_EXTENSIONS = Object.freeze({
	font: Object.freeze(["woff2", "woff", "ttf", "otf"]),
	image: Object.freeze(["png", "jpg", "jpeg", "webp", "svg", "avif"]),
	document: Object.freeze(["json", "css", "md", "txt"])
});

const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;
const RESERVED_IDS = new Set(["light", "dark", "system"]);
const RELEASE_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const TOKEN_NAME_RE = /^--(?:dsw|dsh-tavern|dshte)-[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_CSS_VALUE_BANNED = [";", "}", "</style", "@import", "javascript:", "expression("];

// ── small helpers ──────────────────────────────────────────────────────────

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const issue = (path, code, message) => ({ path, code, message });

function walkUnknownKeys(object, known, basePath, warnings) {
	for (const key of Object.keys(object)) {
		if (!known.includes(key)) warnings.push(issue(`${basePath}.${key}`, "unknown-field", `${basePath} 不认识字段「${key}」，v1 会忽略它（不会静默丢弃：这就是提示）`));
	}
}

function checkStringField(value, path, errors, { max = 500, required = false } = {}) {
	if (value === undefined || value === null) {
		if (required) errors.push(issue(path, "missing-field", `${path} 必填（字符串）`));
		return;
	}
	if (typeof value !== "string") { errors.push(issue(path, "type", `${path} 必须是字符串`)); return; }
	if (required && value.trim().length === 0) errors.push(issue(path, "empty", `${path} 不能为空`));
	if (value.length > max) errors.push(issue(path, "too-long", `${path} 超过 ${max} 字符（当前 ${value.length}）`));
}

function parseSemver(text) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text || "").trim());
	if (!match) return null;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemver(a, b) {
	for (const key of ["major", "minor", "patch"]) {
		if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
	}
	return 0;
}

/** Supports `>=1.2.3`, `>1.2.3`, `<=1.2.3`, `<1.2.3`, `=1.2.3`, `^1.2.3`, `~1.2.3`, bare `1.2.3`, and space-separated conjunctions. */
function satisfiesRange(range, version) {
	const text = String(range || "").trim();
	if (!text) return true;
	const current = parseSemver(version);
	if (!current) return null;
	for (const part of text.split(/\s+/)) {
		const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(part);
		if (!match) return null;
		const target = parseSemver(match[2]);
		const op = match[1] || "=";
		const cmp = compareSemver(current, target);
		if (op === ">=" && cmp < 0) return false;
		if (op === ">" && cmp <= 0) return false;
		if (op === "<=" && cmp > 0) return false;
		if (op === "<" && cmp >= 0) return false;
		if (op === "=" && cmp !== 0) return false;
		if (op === "^" && (current.major !== target.major || cmp < 0)) return false;
		if (op === "~" && (current.major !== target.major || current.minor !== target.minor || cmp < 0)) return false;
	}
	return true;
}

/** CSS custom-property value safety + resource rules (方案 §2.4). */
function checkCssValue(value, path, errors, warnings) {
	if (typeof value !== "string") { errors.push(issue(path, "type", `${path} 必须是字符串（CSS 值）`)); return; }
	const text = value.trim();
	if (text.length === 0) { errors.push(issue(path, "empty", `${path} 不能是空字符串`)); return; }
	if (text.length > 2000) { errors.push(issue(path, "too-long", `${path} 的值超过 2000 字符`)); return; }
	// Semicolons/braces inside url(...) are legal (data: URLs use `;base64`);
	// check the value with every url(...) collapsed first.
	const withoutUrls = text.replace(/url\(\s*(['"]?)[^'")]*\1\s*\)/gi, "url()");
	for (const banned of SAFE_CSS_VALUE_BANNED) {
		if (withoutUrls.includes(banned)) {
			errors.push(issue(path, "unsafe-value", `${path} 的值包含不允许的片段「${banned}」（会破坏样式块或引入外部资源）`));
			return;
		}
	}
	if (text.includes("\n") || text.includes("\r")) warnings.push(issue(path, "multiline-value", `${path} 的值含换行，建议写成单行`));
	const urlMatches = [...text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
	for (const match of urlMatches) {
		const target = match[2].trim();
		const ok = target.startsWith("assets/")
			|| target.startsWith("/dsh-tavern-skin/assets/")
			|| target.startsWith("data:");
		if (!ok) errors.push(issue(path, "external-resource", `${path} 的 url() 只能引用包内 assets/ 或 /dsh-tavern-skin/assets/（data: 允许），当前是「${target}」`));
	}
}

/** Relative path safety inside a theme pack (方案 §2.2/§2.8). */
export function checkPackPath(path, { allowRootFiles = true } = {}) {
	if (typeof path !== "string" || path.trim().length === 0) return "路径必须是非空字符串";
	const text = path.trim();
	if (text.length > 200) return "路径超过 200 字符";
	if (text.includes("\\")) return "请用 / 分隔（不允许反斜杠）";
	if (text.startsWith("/")) return "不允许绝对路径";
	if (/^[A-Za-z]:/.test(text)) return "不允许盘符路径";
	if (text.includes("\0")) return "不允许 NUL 字符";
	const segments = text.split("/");
	if (segments.some((segment) => segment === "" || segment === ".")) return "路径含空段或 . 段";
	if (segments.some((segment) => segment === "..")) return "路径穿越（..）被拒绝";
	if (!allowRootFiles && segments.length < 2) return "该资源必须位于子目录中";
	return null;
}

function extensionOf(path) {
	const match = /\.([A-Za-z0-9]+)$/.exec(path);
	return match ? match[1].toLowerCase() : "";
}

function checkPackFileRule(path, errors) {
	const problem = checkPackPath(path);
	if (problem) { errors.push(issue(`files["${path}"]`, "unsafe-path", `文件路径不安全：${problem}`)); return; }
	const segments = path.split("/");
	const name = segments[segments.length - 1];
	if (!allowExtension(name, segments, errors, path)) return;
}

function allowExtension(name, segments, errors, path) {
	const ext = extensionOf(name);
	if (segments.length === 1) {
		const rootAllowed = name === "theme.json" || name === "theme.css" || name === "preview.png" || name === "README.md" || name === "LICENSE";
		if (!rootAllowed) errors.push(issue(`files["${path}"]`, "file-location", `根目录只允许 theme.json / theme.css / preview.png / README.md / LICENSE，当前「${name}」`));
		return rootAllowed;
	}
	if (segments[0] === "assets" && segments[1] === "fonts") {
		if (!FILE_EXTENSIONS.font.includes(ext)) { errors.push(issue(`files["${path}"]`, "file-extension", `assets/fonts/ 只允许 ${FILE_EXTENSIONS.font.join("/")}，当前 .${ext || "(无扩展名)"}`)); return false; }
		return true;
	}
	if (segments[0] === "assets" && segments[1] === "images") {
		if (!FILE_EXTENSIONS.image.includes(ext)) { errors.push(issue(`files["${path}"]`, "file-extension", `assets/images/ 只允许 ${FILE_EXTENSIONS.image.join("/")}，当前 .${ext || "(无扩展名)"}`)); return false; }
		return true;
	}
	errors.push(issue(`files["${path}"]`, "file-location", "只允许 assets/fonts/*、assets/images/* 与根目录白名单文件"));
	return false;
}

// ── pack.json validators ───────────────────────────────────────────────────

function validateTokens(pack, errors, warnings) {
	const tokens = pack.tokens;
	if (!isPlainObject(tokens)) { errors.push(issue("tokens", "type", "tokens 必填，且必须是 { light: {...}, dark?: {...} } 对象")); return; }
	for (const scheme of Object.keys(tokens)) {
		if (!COLOR_SCHEMES.includes(scheme)) { errors.push(issue(`tokens.${scheme}`, "unknown-scheme", `tokens 只允许 light / dark 两个键，出现「${scheme}」`)); continue; }
		const block = tokens[scheme];
		if (!isPlainObject(block)) { errors.push(issue(`tokens.${scheme}`, "type", `tokens.${scheme} 必须是对象`)); continue; }
		const names = Object.keys(block);
		if (names.length > LIMITS.tokenCount) errors.push(issue(`tokens.${scheme}`, "too-many-tokens", `tokens.${scheme} 最多 ${LIMITS.tokenCount} 个（当前 ${names.length}）`));
		for (const name of names) {
			const path = `tokens.${scheme}["${name}"]`;
			if (!TOKEN_NAME_RE.test(name)) {
				errors.push(issue(path, "token-prefix", `token 名「${name}」不合法：只允许 --dsw- / --dsh-tavern- / --dshte- 前缀 + 字母数字下划线连字符`));
				continue;
			}
			checkCssValue(block[name], path, errors, warnings);
		}
	}
	if (!isPlainObject(tokens[pack.colorScheme])) {
		if (COLOR_SCHEMES.includes(pack.colorScheme)) errors.push(issue(`tokens.${pack.colorScheme}`, "missing-scheme", `colorScheme 是「${pack.colorScheme}」，但 tokens.${pack.colorScheme} 不存在`));
	}
}

function validateTypography(pack, errors, warnings) {
	const typography = pack.typography;
	if (typography === undefined) return;
	if (!isPlainObject(typography)) { errors.push(issue("typography", "type", "typography 必须是对象")); return; }
	walkUnknownKeys(typography, TYPOGRAPHY_KEYS, "typography", warnings);
	for (const key of ["sans", "latin", "display", "mono"]) {
		if (typography[key] === undefined) continue;
		if (typeof typography[key] !== "string" || typography[key].trim() === "") errors.push(issue(`typography.${key}`, "type", `typography.${key} 必须是非空字符串（字体栈）`));
	}
	const sizes = typography.sizes;
	if (sizes !== undefined) {
		if (!isPlainObject(sizes)) errors.push(issue("typography.sizes", "type", "typography.sizes 必须是对象"));
		else {
			walkUnknownKeys(sizes, TYPOGRAPHY_SIZE_KEYS, "typography.sizes", warnings);
			for (const [key, value] of Object.entries(sizes)) {
				const path = `typography.sizes.${key}`;
				if (typeof value === "number" && value > 0 && value <= 96) continue;
				if (typeof value === "string" && /^\d+(?:\.\d+)?(?:px|rem|em)$/.test(value.trim())) continue;
				errors.push(issue(path, "type", `${path} 必须是正数（px）或 <number>px/rem/em`));
			}
		}
	}
	const weights = typography.weights;
	if (weights !== undefined) {
		if (!isPlainObject(weights)) errors.push(issue("typography.weights", "type", "typography.weights 必须是对象"));
		else {
			walkUnknownKeys(weights, TYPOGRAPHY_WEIGHT_KEYS, "typography.weights", warnings);
			for (const [key, value] of Object.entries(weights)) {
				const path = `typography.weights.${key}`;
				if (typeof value === "number" && value >= 100 && value <= 900) continue;
				errors.push(issue(path, "type", `${path} 必须是 100–900 的数字`));
			}
		}
	}
	const leading = typography.leading;
	if (leading !== undefined) {
		if (!isPlainObject(leading)) errors.push(issue("typography.leading", "type", "typography.leading 必须是对象"));
		else {
			walkUnknownKeys(leading, TYPOGRAPHY_LEADING_KEYS, "typography.leading", warnings);
			for (const [key, value] of Object.entries(leading)) {
				const path = `typography.leading.${key}`;
				if (typeof value === "number" && value > 0 && value <= 4) continue;
				errors.push(issue(path, "type", `${path} 必须是 0–4 的数字（行高倍数）`));
			}
		}
	}
	const tracking = typography.tracking;
	if (tracking !== undefined) {
		if (!isPlainObject(tracking)) errors.push(issue("typography.tracking", "type", "typography.tracking 必须是对象"));
		else {
			walkUnknownKeys(tracking, TYPOGRAPHY_TRACKING_KEYS, "typography.tracking", warnings);
			for (const [key, value] of Object.entries(tracking)) {
				const path = `typography.tracking.${key}`;
				if (typeof value === "string" && /^-?\d*\.?\d+(?:px|em|rem)$/.test(value.trim())) continue;
				errors.push(issue(path, "type", `${path} 必须是 px/em/rem 长度字符串`));
			}
		}
	}
	const fonts = typography.fonts;
	if (fonts !== undefined) {
		if (!Array.isArray(fonts)) errors.push(issue("typography.fonts", "type", "typography.fonts 必须是数组"));
		else {
			if (fonts.length > 8) errors.push(issue("typography.fonts", "too-many", "typography.fonts 最多 8 条"));
			fonts.forEach((font, index) => {
				const path = `typography.fonts[${index}]`;
				if (!isPlainObject(font)) { errors.push(issue(path, "type", `${path} 必须是对象`)); return; }
				walkUnknownKeys(font, ["family", "file", "weight", "style", "display", "unicodeRange"], path, warnings);
				if (!isNonEmptyString(font.family)) errors.push(issue(`${path}.family`, "missing-field", `${path}.family 必填（非空字符串）`));
				if (!isNonEmptyString(font.file)) errors.push(issue(`${path}.file`, "missing-field", `${path}.file 必填（包内相对路径）`));
				else {
					const problem = checkPackPath(font.file);
					if (problem) errors.push(issue(`${path}.file`, "unsafe-path", `${path}.file 路径不安全：${problem}`));
					else if (!font.file.startsWith("assets/fonts/")) errors.push(issue(`${path}.file`, "file-location", `${path}.file 必须位于 assets/fonts/ 下`));
					else if (!FILE_EXTENSIONS.font.includes(extensionOf(font.file))) errors.push(issue(`${path}.file`, "file-extension", `${path}.file 扩展名必须是 ${FILE_EXTENSIONS.font.join("/")}`));
				}
				if (font.weight !== undefined && !(typeof font.weight === "number" || typeof font.weight === "string")) errors.push(issue(`${path}.weight`, "type", `${path}.weight 必须是数字或字符串（如 "400"）`));
				if (font.style !== undefined && !["normal", "italic", "oblique"].includes(font.style)) errors.push(issue(`${path}.style`, "enum", `${path}.style 只能是 normal / italic / oblique`));
				if (font.display !== undefined && !["auto", "block", "swap", "fallback", "optional"].includes(font.display)) errors.push(issue(`${path}.display`, "enum", `${path}.display 只能是 auto / block / swap / fallback / optional`));
			});
		}
	}
}

function validateLengthObject(pack, field, keys, errors, warnings, { max = 512 } = {}) {
	const value = pack[field];
	if (value === undefined) return;
	if (!isPlainObject(value)) { errors.push(issue(field, "type", `${field} 必须是对象`)); return; }
	walkUnknownKeys(value, keys, field, warnings);
	for (const [key, item] of Object.entries(value)) {
		const path = `${field}.${key}`;
		if (typeof item === "number") {
			if (Number.isFinite(item) && item >= 0 && item <= max) continue;
			errors.push(issue(path, "range", `${path} 必须是 0–${max} 的数字`));
			continue;
		}
		if (typeof item === "string" && /^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(item.trim())) continue;
		errors.push(issue(path, "type", `${path} 必须是数字（自动补 px）或 <number>px/rem/em/%`));
	}
}

function validateShadows(pack, errors, warnings) {
	const value = pack.shadows;
	if (value === undefined) return;
	if (!isPlainObject(value)) { errors.push(issue("shadows", "type", "shadows 必须是对象")); return; }
	walkUnknownKeys(value, SHADOW_KEYS, "shadows", warnings);
	for (const [key, item] of Object.entries(value)) checkCssValue(item, `shadows.${key}`, errors, warnings);
}

function validateRegions(pack, errors, warnings) {
	const regions = pack.regions;
	if (regions === undefined) return;
	if (!isPlainObject(regions)) { errors.push(issue("regions", "type", "regions 必须是对象")); return; }
	for (const name of Object.keys(regions)) {
		const path = `regions.${name}`;
		if (!REGION_NAMES.includes(name)) { errors.push(issue(path, "unknown-region", `regions 只允许 ${REGION_NAMES.join(" / ")}，出现「${name}」`)); continue; }
		const block = regions[name];
		if (!isPlainObject(block)) { errors.push(issue(path, "type", `${path} 必须是对象`)); continue; }
		for (const [prop, item] of Object.entries(block)) {
			const propPath = `${path}.${prop}`;
			if (REGION_FORBIDDEN_PROPS.includes(prop)) {
				errors.push(issue(propPath, "layout-forbidden", `${propPath} 是布局属性，v1 明确禁止（会压住宿主内联 grid、废掉三栏拖动把手；见 方案 §2.5）`));
				continue;
			}
			if (!REGION_PROPS.includes(prop)) { errors.push(issue(propPath, "unknown-prop", `${propPath} 不在区域白名单 ${REGION_PROPS.join(" / ")} 内`)); continue; }
			if (prop === "opacity") {
				if (typeof item !== "number" || item < 0 || item > 1) errors.push(issue(propPath, "range", `${propPath} 必须是 0–1 的数字`));
				continue;
			}
			if (prop === "borderWidth") {
				if (typeof item === "number" && item >= 0) continue;
				if (typeof item === "string" && /^\d+(?:\.\d+)?px$/.test(item.trim())) continue;
				errors.push(issue(propPath, "type", `${propPath} 必须是数字（px）或 <number>px`));
				continue;
			}
			checkCssValue(item, propPath, errors, warnings);
		}
	}
}

function validateComponents(pack, errors, warnings) {
	const components = pack.components;
	if (components === undefined) return;
	if (!isPlainObject(components)) { errors.push(issue("components", "type", "components 必须是对象")); return; }
	for (const name of Object.keys(components)) {
		const path = `components.${name}`;
		if (!COMPONENT_NAMES.includes(name)) { errors.push(issue(path, "unknown-component", `components 只允许 ${COMPONENT_NAMES.join(" / ")}，出现「${name}」`)); continue; }
		const block = components[name];
		if (!isPlainObject(block)) { errors.push(issue(path, "type", `${path} 必须是对象`)); continue; }
		const knobs = COMPONENT_KNOBS[name];
		for (const [knob, item] of Object.entries(block)) {
			const knobPath = `${path}.${knob}`;
			if (!knobs.includes(knob)) { errors.push(issue(knobPath, "unknown-knob", `${knobPath} 不在 ${name} 的 knob 白名单（${knobs.join(" / ")}）内`)); continue; }
			if (["background", "color", "borderColor", "activeBackground", "activeColor", "placeholderColor", "shadow"].includes(knob)) {
				checkCssValue(item, knobPath, errors, warnings);
				continue;
			}
			if (["radius", "height", "fontSize", "paddingX", "paddingY", "borderWidth"].includes(knob)) {
				if (typeof item === "number" && item >= 0) continue;
				if (typeof item === "string" && /^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(item.trim())) continue;
				errors.push(issue(knobPath, "type", `${knobPath} 必须是数字（px）或 <number>px/rem/em/%`));
				continue;
			}
			if (knob === "fontWeight") {
				if (typeof item === "number" && item >= 100 && item <= 900) continue;
				if (typeof item === "string" && /^(normal|bold|[1-9]00)$/.test(item.trim())) continue;
				errors.push(issue(knobPath, "type", `${knobPath} 必须是 100–900 数字或 normal/bold`));
				continue;
			}
			if (knob === "lineHeight") {
				if (typeof item === "number" && item > 0 && item <= 4) continue;
				if (typeof item === "string" && /^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(item.trim())) continue;
				errors.push(issue(knobPath, "type", `${knobPath} 必须是 0–4 数字或长度字符串`));
				continue;
			}
			if (knob === "letterSpacing") {
				if (typeof item === "string" && /^-?\d*\.?\d+(?:px|em|rem)$/.test(item.trim())) continue;
				errors.push(issue(knobPath, "type", `${knobPath} 必须是 px/em/rem 长度字符串`));
				continue;
			}
			if (knob === "textTransform") {
				if (["none", "uppercase", "lowercase", "capitalize"].includes(item)) continue;
				errors.push(issue(knobPath, "enum", `${knobPath} 只能是 none/uppercase/lowercase/capitalize`));
				continue;
			}
			if (knob === "borderStyle") {
				if (["none", "solid", "dashed", "dotted", "double"].includes(item)) continue;
				errors.push(issue(knobPath, "enum", `${knobPath} 只能是 none/solid/dashed/dotted/double`));
				continue;
			}
			checkCssValue(item, knobPath, errors, warnings);
		}
	}
}

function validatePreview(pack, errors) {
	const preview = pack.preview;
	if (preview === undefined) return;
	if (!isPlainObject(preview)) { errors.push(issue("preview", "type", "preview 必须是对象")); return; }
	for (const key of ["bg", "fg", "accent"]) {
		const value = preview[key];
		if (value === undefined) continue;
		if (typeof value !== "string" || value.trim() === "") errors.push(issue(`preview.${key}`, "type", `preview.${key} 必须是非空颜色字符串`));
	}
}

function validateAssets(pack, errors, warnings) {
	const assets = pack.assets;
	if (assets === undefined) return;
	if (!isPlainObject(assets)) { errors.push(issue("assets", "type", "assets 必须是对象")); return; }
	walkUnknownKeys(assets, ["preview"], "assets", warnings);
	if (assets.preview !== undefined) {
		if (typeof assets.preview !== "string") errors.push(issue("assets.preview", "type", "assets.preview 必须是相对路径字符串"));
		else {
			const problem = checkPackPath(assets.preview);
			if (problem) errors.push(issue("assets.preview", "unsafe-path", `assets.preview 路径不安全：${problem}`));
			else if (!FILE_EXTENSIONS.image.includes(extensionOf(assets.preview))) errors.push(issue("assets.preview", "file-extension", `assets.preview 必须是 ${FILE_EXTENSIONS.image.join("/")} 图片`));
		}
	}
}

function validateCssField(pack, errors) {
	const css = pack.css;
	if (css === undefined) return;
	if (typeof css !== "string" || css.trim() !== "theme.css") {
		errors.push(issue("css", "value", "v1 只允许 css: \"theme.css\"（包内唯一的自定义 CSS 文件）"));
	}
}

// ── public: theme pack ────────────────────────────────────────────────────

/**
 * Validate one parsed theme.json object (not the file system).
 * @param {unknown} pack
 * @param {{engineVersion?: string}} [options]
 */
export function validateThemePack(pack, options = {}) {
	const errors = [];
	const warnings = [];
	const engineVersion = options.engineVersion || ENGINE_VERSION;

	if (!isPlainObject(pack)) {
		return { ok: false, errors: [issue("$", "type", "theme.json 顶层必须是对象")], warnings, stats: null, normalized: null };
	}

	// manifest
	if (pack.format !== PACK_FORMAT) errors.push(issue("format", "value", `format 必须是 "${PACK_FORMAT}"，当前是 ${JSON.stringify(pack.format)}`));
	if (pack.formatVersion !== PACK_FORMAT_VERSION) errors.push(issue("formatVersion", "value", `formatVersion 必须是数字 ${PACK_FORMAT_VERSION}，当前是 ${JSON.stringify(pack.formatVersion)}`));
	walkUnknownKeys(pack, TOP_LEVEL_KNOWN, "$", warnings);

	if (typeof pack.id !== "string" || !ID_RE.test(pack.id)) errors.push(issue("id", "pattern", "id 必须匹配 ^[a-z][a-z0-9-]{2,47}$（小写字母开头，允许数字与连字符）"));
	else if (RESERVED_IDS.has(pack.id) || pack.id.startsWith("builtin-")) errors.push(issue("id", "reserved", `id「${pack.id}」是保留名（light/dark/system/builtin-*）`));
	checkStringField(pack.name, "name", errors, { max: 48, required: true });
	checkStringField(pack.nameZh, "nameZh", errors, { max: 48 });
	checkStringField(pack.description, "description", errors, { max: 200 });
	checkStringField(pack.license, "license", errors, { max: 80 });
	checkStringField(pack.homepage, "homepage", errors, { max: 200 });

	if (pack.release !== undefined) {
		if (typeof pack.release !== "string" || !RELEASE_RE.test(pack.release)) errors.push(issue("release", "pattern", "release 必须是 semver（如 1.0.0）"));
	}
	if (pack.author !== undefined) {
		if (typeof pack.author === "string") checkStringField(pack.author, "author", errors, { max: 80 });
		else if (isPlainObject(pack.author)) {
			checkStringField(pack.author.name, "author.name", errors, { max: 80, required: true });
			checkStringField(pack.author.url, "author.url", errors, { max: 200 });
		} else errors.push(issue("author", "type", "author 必须是字符串或 { name, url? }"));
	}
	if (pack.tags !== undefined) {
		if (!Array.isArray(pack.tags)) errors.push(issue("tags", "type", "tags 必须是字符串数组"));
		else {
			if (pack.tags.length > 8) errors.push(issue("tags", "too-many", "tags 最多 8 个"));
			pack.tags.forEach((tag, index) => {
				if (typeof tag !== "string") errors.push(issue(`tags[${index}]`, "type", `tags[${index}] 必须是字符串`));
				else if (tag !== tag.toLowerCase()) warnings.push(issue(`tags[${index}]`, "lowercase", "tag 建议小写"));
			});
		}
	}
	if (pack.engine !== undefined) {
		const result = satisfiesRange(pack.engine, engineVersion);
		if (result === null) errors.push(issue("engine", "pattern", `engine 不是可识别的 semver 范围（如 ">=0.1.0"）：${JSON.stringify(pack.engine)}`));
		else if (result === false) errors.push(issue("engine", "incompatible", `该包要求引擎 ${pack.engine}，当前引擎 ${engineVersion} 不满足`));
	}
	if (!COLOR_SCHEMES.includes(pack.colorScheme)) errors.push(issue("colorScheme", "enum", "colorScheme 必填，只能是 \"light\" 或 \"dark\""));
	if (pack.missingScheme !== undefined && !SCHEME_POLICIES.includes(pack.missingScheme)) errors.push(issue("missingScheme", "enum", "missingScheme 只能是 \"mirror\" 或 \"inherit\""));

	validateTokens(pack, errors, warnings);
	if (isPlainObject(pack.tokens) && COLOR_SCHEMES.includes(pack.colorScheme) && isPlainObject(pack.tokens[pack.colorScheme])) {
		const schemeTokens = pack.tokens[pack.colorScheme];
		for (const token of REQUIRED_TOKENS) {
			if (!hasOwn(schemeTokens, token)) errors.push(issue(`tokens.${pack.colorScheme}["${token}"]`, "missing-required-token", `缺少必填 token「${token}」（与 dream-skin 保持互通，见 方案 §2.3）`));
		}
		if (isPlainObject(pack.tokens.dark) && pack.colorScheme === "light") {
			for (const token of REQUIRED_TOKENS) {
				if (!hasOwn(pack.tokens.dark, token)) warnings.push(issue(`tokens.dark["${token}"]`, "dark-fallback", `dark 档缺少「${token}」，引擎会回退到 light 档的值（UI 会提示“深色未完整设计”）`));
			}
		}
	}

	validateTypography(pack, errors, warnings);
	validateLengthObject(pack, "radii", RADII_KEYS, errors, warnings, { max: 9999 });
	validateLengthObject(pack, "spacing", SPACING_KEYS, errors, warnings, { max: 512 });
	validateShadows(pack, errors, warnings);
	validateRegions(pack, errors, warnings);
	validateComponents(pack, errors, warnings);
	validatePreview(pack, errors);
	validateAssets(pack, errors, warnings);
	validateCssField(pack, errors);

	const stats = isPlainObject(pack.tokens)
		? {
			schemes: Object.keys(pack.tokens),
			tokens: Object.entries(pack.tokens).filter(([, block]) => isPlainObject(block)).reduce((total, [, block]) => total + Object.keys(block).length, 0),
			regions: isPlainObject(pack.regions) ? Object.keys(pack.regions).length : 0,
			components: isPlainObject(pack.components) ? Object.keys(pack.components).length : 0
		}
		: null;

	return {
		ok: errors.length === 0,
		errors,
		warnings,
		stats,
		normalized: {
			meta: {
				id: pack.id, name: pack.name, nameZh: pack.nameZh, release: pack.release || "1.0.0",
				colorScheme: pack.colorScheme, missingScheme: pack.missingScheme || "mirror", engine: pack.engine || null
			},
			tokens: isPlainObject(pack.tokens) ? pack.tokens : {},
			typography: pack.typography || null,
			radii: pack.radii || null,
			spacing: pack.spacing || null,
			shadows: pack.shadows || null,
			regions: pack.regions || null,
			components: pack.components || null,
			preview: pack.preview || null,
			css: pack.css || null
		}
	};
}

/** Parse raw theme.json text; keeps the JSON syntax error readable. */
export function parseThemeJson(text) {
	try {
		return { ok: true, pack: JSON.parse(text), errors: [] };
	} catch (error) {
		return { ok: false, pack: null, errors: [issue("$", "json-parse", `theme.json 不是合法 JSON：${error && error.message ? error.message : String(error)}`)] };
	}
}

// ── public: file manifest ─────────────────────────────────────────────────

/**
 * Validate the file list of a pack directory.
 * @param {{path: string, size: number}[]} files  paths are pack-relative POSIX paths
 * @param {{limits?: object, declared?: string[]}} [options] declared files must exist
 */
export function validateFileManifest(files, options = {}) {
	const limits = { ...LIMITS, ...(options.limits || {}) };
	const errors = [];
	const warnings = [];
	if (!Array.isArray(files)) return { ok: false, errors: [issue("files", "type", "files 必须是数组")], warnings, stats: null };

	const seen = new Set();
	let total = 0;
	for (const file of files) {
		if (!isPlainObject(file) || typeof file.path !== "string") { errors.push(issue("files[]", "type", "files[] 每项必须是 { path, size }")); continue; }
		const path = file.path;
		const size = typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0 ? file.size : null;
		if (seen.has(path)) errors.push(issue(`files["${path}"]`, "duplicate", `文件重复声明：${path}`));
		seen.add(path);
		checkPackFileRule(path, errors);
		if (size === null) errors.push(issue(`files["${path}"]`, "size", `files["${path}"].size 必须是非负数字`));
		else if (size > limits.fileBytes) errors.push(issue(`files["${path}"]`, "file-too-large", `文件「${path}」${(size / 1024 / 1024).toFixed(2)} MB，超过单文件上限 ${(limits.fileBytes / 1024 / 1024).toFixed(0)} MB`));
		if (size !== null) total += size;
	}
	if (files.length > limits.fileCount) errors.push(issue("files", "too-many-files", `文件数量 ${files.length} 超过上限 ${limits.fileCount}`));
	if (total > limits.packBytes) errors.push(issue("files", "pack-too-large", `包总大小 ${(total / 1024 / 1024).toFixed(2)} MB，超过上限 ${(limits.packBytes / 1024 / 1024).toFixed(0)} MB`));
	for (const declared of options.declared || []) {
		if (!seen.has(declared)) errors.push(issue(`files["${declared}"]`, "missing-file", `theme.json 声明了「${declared}」，但包目录里没有这个文件`));
	}
	return { ok: errors.length === 0, errors, warnings, stats: { fileCount: files.length, totalBytes: total } };
}

// ── public: theme.css (unsafe channel scanner) ────────────────────────────

const CSS_GLOBAL_LAYOUT_PROPS = ["grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-column", "grid-row", "grid-area"];
const CSS_HOOK_LAYOUT_PROPS = ["width", "height", "min-width", "max-width", "min-height", "max-height", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "display", "position", "inset", "top", "right", "bottom", "left", "transform", "overflow"];
const LAYOUT_HOOK_RE = /(\[data-slot\s*=\s*["']?(root|sidebar|main|rightbar|shell\.bottom)["']?\]|_frame\b|_sidebarCol\b|_centerCol\b|_rightbarCol\b|\[data-side\b|\[data-sidebar-right-panel\b|\[data-dsh-center-col\b|\[data-rightbar-col\b)/;

function stripCssComments(css) {
	let output = "";
	let line = 1;
	for (let i = 0; i < css.length; i++) {
		const char = css[i];
		if (char === "\n") line++;
		if (char === "/" && css[i + 1] === "*") {
			let j = i + 2;
			while (j < css.length && !(css[j] === "*" && css[j + 1] === "/")) { if (css[j] === "\n") line++; j++; }
			i = j + 1;
			output += " ";
			continue;
		}
		output += char;
	}
	return output;
}

/** @param {string} css @param {{filename?: string, limits?: object}} [options] */
export function validateThemeCss(css, options = {}) {
	const limits = { ...LIMITS, ...(options.limits || {}) };
	const filename = options.filename || "theme.css";
	const errors = [];
	const warnings = [];
	if (typeof css !== "string") return { ok: false, errors: [issue(filename, "type", `${filename} 必须是字符串`)], warnings };

	const bytes = BufferByteLength(css);
	if (bytes > limits.cssBytes) errors.push(issue(filename, "css-too-large", `${filename} ${(bytes / 1024).toFixed(1)} KB，超过上限 ${(limits.cssBytes / 1024).toFixed(0)} KB`));

	const stripped = stripCssComments(css);
	const lineOf = (index) => stripped.slice(0, index).split("\n").length;

	// strings-aware scan: braces, @import, url(), declarations
	const stack = [];
	let pending = "";
	let line = 1;
	let importantCount = 0;
	let inString = null;
	let declaration = "";
	const flushDeclaration = () => {
		const text = declaration.trim();
		declaration = "";
		if (!text) return;
		if (/^@import\b/i.test(text)) { errors.push(issue(filename, "css-import", `第 ${line} 行：theme.css 不允许 @import（会引入外部资源/绕过包内资源规则）`)); return; }
		if (text.startsWith("@")) return;
		const colon = text.indexOf(":");
		if (colon < 0) return;
		const property = text.slice(0, colon).trim().toLowerCase();
		const value = text.slice(colon + 1).trim();
		const selector = stack.length ? stack[stack.length - 1].selector : "";
		const ruleLine = stack.length ? stack[stack.length - 1].line : line;
		const inAtRule = selector.startsWith("@");
		if (value.includes("!important")) importantCount++;
		if (inAtRule) return;
		if (CSS_GLOBAL_LAYOUT_PROPS.includes(property)) {
			errors.push(issue(filename, "layout-forbidden", `第 ${ruleLine} 行：${selector || "(全局)"} 使用了布局属性「${property}」——v1 禁止（会压住宿主内联 grid/拖动把手）`));
			return;
		}
		if (LAYOUT_HOOK_RE.test(selector) && CSS_HOOK_LAYOUT_PROPS.includes(property)) {
			errors.push(issue(filename, "layout-forbidden", `第 ${ruleLine} 行：${selector} 使用了布局属性「${property}」——命中三栏/列钩子，v1 禁止（方案 §2.5）`));
			return;
		}
		if (property === "position" && /(?:^|\s)(fixed|absolute)(?:\s|$)/.test(value)) warnings.push(issue(filename, "position-warning", `第 ${ruleLine} 行：${selector} 使用 position:${value.replace(/!important/, "").trim()}，可能覆盖宿主浮层（允许但请确认）`));
		const urls = [...text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
		for (const match of urls) {
			const target = match[2].trim();
			const allowed = target.startsWith("assets/") || target.startsWith("/dsh-tavern-skin/assets/") || target.startsWith("data:");
			if (!allowed) errors.push(issue(filename, "external-resource", `第 ${line} 行：url(${target}) 只能引用包内 assets/、/dsh-tavern-skin/assets/ 或 data:`));
		}
	};

	for (let i = 0; i < stripped.length; i++) {
		const char = stripped[i];
		if (char === "\n") line++;
		if (inString) {
			if (char === inString && stripped[i - 1] !== "\\") inString = null;
			if (stack.length > 0) declaration += char; else pending += char;
			continue;
		}
		if (char === '"' || char === "'") { inString = char; if (stack.length > 0) declaration += char; else pending += char; continue; }
		if (char === "{") {
			stack.push({ selector: pending.trim(), line });
			pending = "";
			declaration = "";
			continue;
		}
		if (char === "}") {
			flushDeclaration();
			if (stack.length === 0) errors.push(issue(filename, "css-brace", `第 ${line} 行附近：多了一个右花括号 }`));
			else stack.pop();
			pending = "";
			continue;
		}
		if (char === ";") {
			if (stack.length === 0) {
				const statement = pending.trim();
				pending = "";
				if (/^@import\b/i.test(statement)) errors.push(issue(filename, "css-import", `第 ${line} 行：theme.css 不允许 @import`));
				else if (statement && !/^@(charset|namespace)\b/i.test(statement)) warnings.push(issue(filename, "css-statement", `第 ${line} 行：顶层语句「${statement.slice(0, 60)}」不是规则块，已忽略`));
				continue;
			}
			flushDeclaration();
			continue;
		}
		if (stack.length > 0) declaration += char;
		else pending += char;
	}
	if (stack.length > 0) {
		const open = stack[stack.length - 1];
		errors.push(issue(filename, "css-brace", `第 ${open.line} 行的规则块「${open.selector.slice(0, 60)}」缺少右花括号 }`));
	}
	if (importantCount > 0) warnings.push(issue(filename, "important-count", `${filename} 使用了 ${importantCount} 处 !important（允许，但请确认不会压住宿主状态样式）`));
	if (errors.length === 0 && stripped.trim().length === 0) warnings.push(issue(filename, "empty-css", `${filename} 是空文件`));
	return { ok: errors.length === 0, errors, warnings, stats: { bytes, importantCount } };
}

function BufferByteLength(text) {
	// Avoid Buffer in the browser half: count UTF-8 bytes manually.
	let bytes = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
		else bytes += 3;
	}
	return bytes;
}
