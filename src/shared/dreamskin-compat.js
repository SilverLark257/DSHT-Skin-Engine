/**
 * dream-skin 主题包 → 本引擎 v1 包映射（纯模块，宿主/测试共用）
 *
 * 方案 §2.8 / Step 6 契约 §6：Tavern 里 dream-skin 的「主题包」是单 JSON
 * （`format:"dsh-dream-skin/pack"`、`version:1`、`manifest.tokens` 里 7 个必填颜色 token +
 * 任意"像颜色"的 token，其余字段一律丢弃）。这里把它映射成本引擎的 v1 包：
 *
 *   - 只接受 `--dsw-` / `--dsh-tavern-` / `--dshte-` 前缀的 token；
 *   - 值必须是 dream-skin 认可的颜色字面量（`#rgb` / `#rrggbb` / `rgb()/rgba()/hsl()/hsla()`），
 *     非颜色 token 丢弃并写进映射报告（绝不静默：`dropped` 里带原因）；
 *   - 7 个必填 token 缺任一 → 可读错误拒绝（沿用 dream-skin 的必填集合，保证互通）；
 *   - 目标 id = `imported-` + 规范化源 id（小写、非法字符→`-`、去尾 `-`、总长 ≤47；
 *     源 id 已以 `imported-` 开头则不再重复加）；
 *   - 生成 v1 包：`tokens.light` 与 `tokens.dark` **同值**（`missingScheme:"mirror"`），
 *     `preview` 取 bg-base / label-primary / brand-primary 三个 token 的颜色。
 *
 * 无 Node/DOM API：宿主（lib/host/packs-io.js）与 `node --test` 直接 import。
 */
import { REQUIRED_TOKENS, TOKEN_PREFIXES, ENGINE_VERSION, validateThemePack } from "./pack-schema.js";

export const DREAMSKIN_FORMAT = "dsh-dream-skin/pack";
export const DREAMSKIN_VERSION = 1;
export const IMPORTED_ID_PREFIX = "imported-";
export const MAX_ID_LENGTH = 47;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FUNCTIONAL_COLOR_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[^()]*\)$/i;
const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

/** dream-skin 的「像颜色」判定（调查报告 §1.2：`looksLikeColor`，S/lib/client.js:3585-3590）。 */
export function looksLikeColor(value) {
	if (typeof value !== "string") return false;
	const text = value.trim();
	if (text.length === 0) return false;
	return HEX_COLOR_RE.test(text) || FUNCTIONAL_COLOR_RE.test(text);
}

/** 该 token 名是否属于允许的前缀（`--dsw-` / `--dsh-tavern-` / `--dshte-`）。 */
export function hasAllowedPrefix(token) {
	if (typeof token !== "string") return false;
	return TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** 源 id → 目标 id（`imported-` 前缀；小写、非法字符→`-`、去尾 `-`、总长 ≤47）。 */
export function normalizeImportedId(sourceId) {
	let base = String(sourceId === undefined || sourceId === null ? "" : sourceId)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
	if (base === "") base = "pack";
	const prefix = base.startsWith(IMPORTED_ID_PREFIX) ? "" : IMPORTED_ID_PREFIX;
	const maxBase = Math.max(1, MAX_ID_LENGTH - prefix.length);
	if (base.length > maxBase) base = base.slice(0, maxBase).replace(/-+$/, "");
	let id = `${prefix}${base}`;
	if (id.length > MAX_ID_LENGTH) id = id.slice(0, MAX_ID_LENGTH).replace(/-+$/, "");
	if (!ID_RE.test(id)) id = `${IMPORTED_ID_PREFIX}pack`;
	return id;
}

/** 快速识别输入是否声称是 dream-skin 主题包（不负责完整校验）。 */
export function isDreamSkinPack(input) {
	return isPlainObject(input) && (input.format === DREAMSKIN_FORMAT || isPlainObject(input.manifest));
}

const issue = (path, code, message) => ({ path, code, message });

/**
 * dream-skin 包 → 本引擎 v1 包。
 * @param {unknown} input 已 JSON.parse 的 dream-skin 主题包对象
 * @param {{sourceId?: string}} [options]
 * @returns {{ok: boolean, errors: object[], warnings: object[], pack: object|null, report: object|null}}
 */
export function mapDreamSkinPack(input, options = {}) {
	const errors = [];
	const warnings = [];

	if (!isPlainObject(input)) {
		return { ok: false, errors: [issue("$", "type", "dream-skin 主题包必须是 JSON 对象")], warnings, pack: null, report: null };
	}
	if (input.format !== DREAMSKIN_FORMAT) {
		errors.push(issue("format", "value", `dream-skin 主题包 format 必须是 "${DREAMSKIN_FORMAT}"，当前是 ${JSON.stringify(input.format)}`));
	}
	if (input.version !== DREAMSKIN_VERSION) {
		errors.push(issue("version", "value", `dream-skin 主题包 version 必须是 ${DREAMSKIN_VERSION}，当前是 ${JSON.stringify(input.version)}`));
	}
	const manifest = input.manifest;
	if (!isPlainObject(manifest)) {
		errors.push(issue("manifest", "type", "dream-skin 主题包必须有 manifest 对象"));
		return { ok: false, errors, warnings, pack: null, report: null };
	}
	if (!isNonEmptyString(manifest.id)) errors.push(issue("manifest.id", "missing-field", "manifest.id 必填（非空字符串）"));
	if (!isNonEmptyString(manifest.name)) errors.push(issue("manifest.name", "missing-field", "manifest.name 必填（非空字符串）"));
	if (manifest.colorScheme !== "light" && manifest.colorScheme !== "dark") {
		errors.push(issue("manifest.colorScheme", "enum", `manifest.colorScheme 只能是 "light" 或 "dark"，当前是 ${JSON.stringify(manifest.colorScheme)}`));
	}
	if (!isPlainObject(manifest.tokens)) {
		errors.push(issue("manifest.tokens", "type", "manifest.tokens 必填，且必须是 { token 名: 颜色值 } 对象"));
	}

	const mapped = [];
	const dropped = [];
	const mappedValues = new Map();
	const rawValues = new Map();
	if (isPlainObject(manifest.tokens)) {
		for (const [token, value] of Object.entries(manifest.tokens)) {
			rawValues.set(token, value);
			if (typeof value !== "string") {
				dropped.push({ token, value: value === undefined ? null : value, reason: "值不是字符串（dream-skin 只接受颜色字符串）" });
				continue;
			}
			if (!hasAllowedPrefix(token)) {
				dropped.push({ token, value, reason: "未知 token 前缀（只允许 --dsw- / --dsh-tavern- / --dshte-）" });
				continue;
			}
			if (!looksLikeColor(value)) {
				dropped.push({ token, value, reason: "值不是颜色（只接受 #rgb / #rrggbb / rgb() / rgba() / hsl() / hsla()）" });
				continue;
			}
			mapped.push({ token, value: value.trim() });
			mappedValues.set(token, value.trim());
		}
		for (const token of REQUIRED_TOKENS) {
			if (!rawValues.has(token)) {
				errors.push(issue(`manifest.tokens["${token}"]`, "missing-required-token", `缺少 dream-skin 必填 token「${token}」`));
				continue;
			}
			if (!mappedValues.has(token)) {
				errors.push(issue(`manifest.tokens["${token}"]`, "invalid-required-token", `必填 token「${token}」的值不是合法颜色：${JSON.stringify(rawValues.get(token))}`));
			}
		}
	}

	if (errors.length > 0) return { ok: false, errors, warnings, pack: null, report: null };

	const sourceId = manifest.id;
	const targetId = normalizeImportedId(sourceId);
	const colorScheme = manifest.colorScheme;
	const tokenBlock = {};
	for (const entry of mapped) tokenBlock[entry.token] = entry.value;

	const notes = [];
	if (targetId !== sourceId) notes.push(`目标 id 已规范化为「${targetId}」（源 id「${sourceId}」）`);
	notes.push("所有 token 以相同值写入 light / dark 两档（missingScheme: \"mirror\"），保证切到深色时不丢色");
	if (dropped.length > 0) notes.push(`共丢弃 ${dropped.length} 个 token（非颜色/未知前缀），明细见 dropped`);
	const ignoredManifestKeys = Object.keys(manifest).filter((key) => !["id", "name", "nameZh", "colorScheme", "tokens", "author", "version", "description"].includes(key));
	if (ignoredManifestKeys.length > 0) notes.push(`manifest 其余字段已丢弃：${ignoredManifestKeys.join("、")}`);

	const pack = {
		format: "dshte.theme",
		formatVersion: 1,
		release: isNonEmptyString(manifest.version) ? manifest.version.trim() : "1.0.0",
		id: targetId,
		name: manifest.name.trim().slice(0, 48),
		...(isNonEmptyString(manifest.nameZh) ? { nameZh: manifest.nameZh.trim().slice(0, 48) } : {}),
		author: isNonEmptyString(manifest.author) ? manifest.author.trim().slice(0, 80) : "anonymous",
		description: (isNonEmptyString(manifest.description) ? manifest.description.trim() : "").slice(0, 200),
		colorScheme,
		missingScheme: "mirror",
		tokens: { light: { ...tokenBlock }, dark: { ...tokenBlock } }
	};

	const preview = {};
	const previewSources = {
		bg: "--dsw-alias-bg-base",
		fg: "--dsw-alias-label-primary",
		accent: "--dsw-alias-brand-primary"
	};
	for (const [key, token] of Object.entries(previewSources)) {
		if (mappedValues.has(token)) preview[key] = mappedValues.get(token);
	}
	if (Object.keys(preview).length === 3) pack.preview = preview;
	else notes.push("preview 颜色未能全部取自 bg-base / label-primary / brand-primary，已省略色卡");

	const validation = validateThemePack(pack, { engineVersion: options.engineVersion || ENGINE_VERSION });
	if (!validation.ok) {
		for (const item of validation.errors) errors.push({ ...item, path: item.path === "$" ? "mapped-pack" : `mapped-pack.${item.path}` });
		return { ok: false, errors, warnings, pack: null, report: null };
	}
	warnings.push(...validation.warnings);

	const report = {
		sourceId,
		sourceName: manifest.name,
		targetId,
		colorScheme,
		mapped,
		dropped,
		notes
	};
	return { ok: true, errors, warnings, pack, report };
}
