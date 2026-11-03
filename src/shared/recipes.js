/**
 * dsh-tavern-skin-engine — selector registry + recipe compiler + drift probe.
 *
 * 方案 §2.5/§4.5/§6.5:
 *   - a versioned registry of host DOM hooks for the 5 regions and 11 components;
 *   - selectors prefer `data-slot` / `data-*` / semantic ARIA hooks captured from a
 *     REAL conversation (docs/selector-registry.md); build-hash class names are
 *     never used as primary selectors (only `[class*="_frame"]`-style structural
 *     fallbacks where no attribute exists, and they are labelled as such);
 *   - `compileRecipes(pack)` turns JSON `regions` / `components` into `--dshte-*`
 *     variables plus a "set" token list consumed by engine.css
 *     (`[data-dshte-set~="card.radius"] …`), so a pack only affects the knobs it
 *     actually declares — no silent reset of host defaults;
 *   - `probeRegistry(doc)` counts hits/misses for the diagnostics row
 *     (钩子命中率 / 未命中组件) and the Step 4 acceptance probe.
 *
 * This file is inlined into the classic client bundle (`// @include`), so it must
 * not contain import/export statements at runtime; `export` keywords are stripped
 * by scripts/build-client.mjs.
 */

/** Regions: `regions.<name>.<prop>` → `--dshte-region-<name>-<suffix>`. */
const REGION_REGISTRY = {
	sidebar: {
		label: "左栏",
		confidence: "structural-fallback",
		note: "列 div 是实际盒子；[data-slot=\"sidebar\"] 是 display:contents。兜底用 _sidebarCol 后缀（哈希前缀会漂移，后缀由 DSH 布局模块稳定生成）。",
		selectors: ['[data-slot="root"] > [class*="_frame"] > [class*="_sidebarCol"]']
	},
	center: {
		label: "中栏",
		confidence: "attribute",
		note: "中栏列 div 自带 data-dsh-center-col（dom-snapshot §2）。",
		selectors: ['[data-dsh-center-col]', '[data-slot="root"] > [class*="_frame"] > [class*="_centerCol"]']
	},
	rightbar: {
		label: "右栏",
		confidence: "attribute",
		note: "右栏列 div 自带 data-rightbar-col。",
		selectors: ['[data-rightbar-col]', '[data-slot="root"] > [class*="_frame"] > [class*="_rightbarCol"]']
	},
	composer: {
		label: "输入坞",
		confidence: "attribute",
		note: "输入坞的实际盒子是 [data-composer-card]（conversation.composer.bar 内的 card），[data-slot] 容器均为 display:contents。",
		selectors: ['[data-composer-card]']
	},
	settings: {
		label: "设置页",
		confidence: "semantic",
		note: "设置页渲染在宿主 dialog 内（role=dialog）。",
		selectors: ['[role="dialog"]']
	}
};

/** Components: `components.<name>.<knob>` → `--dshte-<kebab-name>-<kebab-knob>`. */
const COMPONENT_REGISTRY = {
	card: {
		label: "消息卡（用户气泡卡）",
		confidence: "tavern-class",
		note: "真实会话实测：用户消息是带底板的 .dsh-tavern-user-bubble（8 个，bg #FFFDF8 / r14 / p14-16）；助手正文 .dsh-tavern-assistant 是裸文档流（无底板），不套卡片配方，保持阅读排版。",
		selectors: [".dsh-tavern-user-bubble", '[data-chat-flow-kind="user"] .dsh-tavern-user-bubble', '[data-dsh-icon-role="user"] .dsh-tavern-user-bubble']
	},
	buttonPrimary: {
		label: "主按钮（发送）",
		confidence: "aria-label",
		note: "发送按钮没有 data-*，用 input.composer.bar 内的 aria-label=发送消息（zh 界面）。",
		selectors: ['[data-slot="conversation.composer.bar"] button[aria-label="发送消息"]']
	},
	buttonDanger: {
		label: "危险按钮（回退/删除）",
		confidence: "aria-role",
		note: "真实会话实测：button.danger（更多菜单里的“回退第 N 轮”）与 .dsh-tavern-error-withdraw 等错误控制条。",
		selectors: ["button.danger", '[data-slot="conversation.input.dock"] [role="menuitem"].danger']
	},
	buttonGhost: {
		label: "次级按钮（生成候选/重生成）",
		confidence: "tavern-class",
		note: "真实会话实测：.dsh-tavern-choice-trigger（4 个，dock 操作按钮）带 data-fork-action；另有 .dsh-tavern-btn 为 header 按钮。",
		selectors: [".dsh-tavern-choice-trigger", '[data-slot="conversation.input.dock"] [data-fork-action]', ".dsh-tavern-btn"]
	},
	input: {
		label: "输入坞卡片",
		confidence: "attribute",
		note: "[data-composer-card] 是实际白底盒子；[data-composer-input] 是 contenteditable 正文（Lexical）。",
		selectors: ['[data-composer-card]']
	},
	quote: {
		label: "引用块",
		confidence: "semantic",
		note: "markdown 渲染出的 blockquote（真实会话计数 0，属预期未命中）。",
		selectors: ['[data-slot="conversation.session"] blockquote', '[data-slot="conversation.chat.flow"] blockquote']
	},
	navItem: {
		label: "左栏导航/会话行",
		confidence: "tavern-class",
		note: "真实会话实测：button.dsh-tavern-side-row-main（1 个；home 0 个）。Tavern 自己的语义类，非构建哈希。",
		selectors: [".dsh-tavern-side-row-main", '[data-slot="sidebar.workspaces"] [class*="side-row-main"]']
	},
	eyebrow: {
		label: "眉标（品牌/分组标题）",
		confidence: "tavern-class",
		note: "真实会话实测：Tavern 没有 uppercase+0.12em 的真眉标，最接近的是 .dsh-tavern-side-title（12px 分组标题）；回退到稳定 slot sidebar.brand.mark/name。",
		selectors: [".dsh-tavern-side-title", '[data-slot="sidebar.brand.mark"]', '[data-slot="sidebar.brand.name"]']
	},
	badge: {
		label: "状态徽标",
		confidence: "tavern-class",
		note: "真实会话实测：.dsh-tavern-mvu-receipt-summary（“变量已更新 · N 项”，home 0 / session 1）+ 输入坞统计药丸 [data-composer-stat] button。",
		selectors: [".dsh-tavern-mvu-receipt-summary", "[data-composer-stat] button", '[data-slot="conversation.composer.dock"] [data-composer-stat]']
	},
	fileCard: {
		label: "文件卡 / 右栏面板卡",
		confidence: "tavern-class",
		note: "真实会话没有附件文件卡；右栏是 Tavern 状态面板 .fork-status-card / .dsh-tavern-status-section（home 0 / session 1）。如实标注为“最接近的卡”。",
		selectors: [".fork-status-card", '[data-sidebar-right-panel] .dsh-tavern-status-section']
	},
	codeBlock: {
		label: "代码块",
		confidence: "semantic",
		note: "markdown pre/code（真实会话计数 0，属预期未命中）。",
		selectors: ['[data-slot="conversation.session"] pre', '[data-slot="conversation.session"] code']
	}
};

/** Expected `[data-slot]` hooks (drop-in for the "钩子命中率" diagnostic). */
export const SLOT_HOOKS = [
	"root", "sidebar", "sidebar.brand.mark", "sidebar.brand.name", "sidebar.panellist",
	"sidebar.workspaces", "sidebar.settings", "main", "main.conversation",
	"conversation.header", "conversation.session.header", "conversation.session",
	"conversation.chat.flow", "conversation.chat.node", "conversation.composer",
	"conversation.composer.bar", "conversation.composer.dock", "conversation.input.dock",
	"conversation.input.overlay", "conversation.input.permission", "conversation.input.model",
	"conversation.input.attachments", "rightbar", "rightbar.session", "shell.bottom", "shell.overlay"
];

/** Knob → CSS declaration kind (mirrors src/shared/pack-schema.js COMPONENT_KNOBS). */
const KNOB_KINDS = {
	background: "raw", color: "raw", borderColor: "raw", activeBackground: "raw",
	activeColor: "raw", placeholderColor: "raw", shadow: "raw",
	borderWidth: "length", radius: "length", height: "length", fontSize: "length",
	paddingX: "length", paddingY: "length",
	fontWeight: "number", lineHeight: "line-height", letterSpacing: "raw",
	textTransform: "raw", borderStyle: "raw"
};

/** Region prop → variable suffix + kind. */
const REGION_PROP_SPEC = {
	background: { suffix: "bg", kind: "raw" },
	backgroundImage: { suffix: "bg-image", kind: "raw" },
	borderColor: { suffix: "border-color", kind: "raw" },
	borderWidth: { suffix: "border-width", kind: "length" },
	shadow: { suffix: "shadow", kind: "raw" },
	opacity: { suffix: "opacity", kind: "opacity" },
	backdropFilter: { suffix: "backdrop", kind: "raw" }
};

/** knob → variable suffix overrides (engine.css reads --dshte-<component>-bg, etc.). */
const COMPONENT_VAR_ALIASES = Object.freeze({ background: "bg", activeBackground: "active-bg", activeColor: "active-color" });

/** Compile the pack's typography/radii/spacing/shadows sugar into --dshte-* vars. */
export function compilePackBaseVars(pack) {
	const vars = {};
	const assign = (name, value) => { if (value !== null) vars[name] = value; };
	const typography = pack && pack.typography;
	if (typography && typeof typography === "object") {
		for (const key of ["sans", "latin", "display", "mono"]) {
			if (typeof typography[key] === "string" && typography[key].trim()) assign(`--dshte-font-${key}`, typography[key].trim());
		}
		if (typography.sizes && typeof typography.sizes === "object") {
			for (const [key, raw] of Object.entries(typography.sizes)) {
				const value = normalizeRecipeValue("length", raw);
				if (value !== null) assign(`--dshte-text-${kebab(key)}`, value);
			}
		}
		if (typography.weights && typeof typography.weights === "object") {
			for (const [key, raw] of Object.entries(typography.weights)) {
				const value = normalizeRecipeValue("number", raw);
				if (value !== null) assign(`--dshte-weight-${kebab(key)}`, value);
			}
		}
		if (typography.leading && typeof typography.leading === "object") {
			for (const [key, raw] of Object.entries(typography.leading)) {
				const value = normalizeRecipeValue("line-height", raw);
				if (value !== null) assign(`--dshte-leading-${kebab(key)}`, value);
			}
		}
		if (typography.tracking && typeof typography.tracking === "object") {
			for (const [key, raw] of Object.entries(typography.tracking)) {
				const value = normalizeRecipeValue("raw", raw);
				if (value !== null) assign(`--dshte-tracking-${kebab(key)}`, value);
			}
		}
	}
	for (const [key, raw] of Object.entries((pack && pack.radii) || {})) {
		const value = normalizeRecipeValue("length", raw);
		if (value !== null) assign(`--dshte-radius-${kebab(key)}`, value);
	}
	for (const [key, raw] of Object.entries((pack && pack.spacing) || {})) {
		const value = normalizeRecipeValue("length", raw);
		if (value !== null) assign(`--dshte-space-${kebab(key)}`, value);
	}
	for (const [key, raw] of Object.entries((pack && pack.shadows) || {})) {
		const value = normalizeRecipeValue("raw", raw);
		if (value !== null) assign(`--dshte-shadow-${kebab(key)}`, value);
	}
	return vars;
}

const RECIPE_SAFE_VALUE = /[;}<]|<\/style|@import|javascript:|expression\(/i;

function kebab(value) {
	return String(value).replace(/[A-Z]/g, (char) => "-" + char.toLowerCase());
}

function recipeSafeValue(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false;
	return !RECIPE_SAFE_VALUE.test(value);
}

function normalizeRecipeValue(kind, value) {
	if (kind === "length") {
		if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
		if (typeof value === "string" && /^-?\d*\.?\d+(?:px|rem|em|%)$/.test(value.trim())) return value.trim();
		return null;
	}
	if (kind === "number") {
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
		if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
		return null;
	}
	if (kind === "opacity") {
		if (typeof value === "number" && value >= 0 && value <= 1) return String(value);
		return null;
	}
	if (kind === "line-height") {
		if (typeof value === "number" && value > 0 && value <= 4) return String(value);
		if (typeof value === "string" && /^-?\d*\.?\d+(?:px|rem|em|%)$/.test(value.trim())) return value.trim();
		return null;
	}
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return recipeSafeValue(trimmed) ? trimmed : null;
}

/**
 * Compile a pack's `regions` / `components` blocks into `--dshte-*` variables.
 * Both schemes receive the same values (these blocks are not per-scheme).
 * @param {object} pack validated theme.json
 */
export function compileRecipes(pack) {
	const vars = { light: {}, dark: {} };
	const set = [];
	const warnings = [];
	const counts = { regions: 0, components: 0, declarations: 0, assetUrls: 0 };

	const assign = (name, value, token) => {
		vars.light[name] = value;
		vars.dark[name] = value;
		set.push(token);
		counts.declarations += 1;
		if (/url\(\s*['"]?assets\//i.test(value)) counts.assetUrls += 1;
	};

	const regions = pack && pack.regions;
	if (regions && typeof regions === "object") {
		for (const [region, block] of Object.entries(regions)) {
			if (!REGION_REGISTRY[region]) { warnings.push(`未知分区「${region}」已忽略`); continue; }
			if (!block || typeof block !== "object") continue;
			counts.regions += 1;
			for (const [prop, raw] of Object.entries(block)) {
				const spec = REGION_PROP_SPEC[prop];
				if (!spec) { warnings.push(`分区 ${region} 的属性「${prop}」不在白名单，已忽略`); continue; }
				const value = normalizeRecipeValue(spec.kind, raw);
				if (value === null) { warnings.push(`分区 ${region}.${prop} 的值不合法，已忽略`); continue; }
				assign(`--dshte-region-${kebab(region)}-${spec.suffix}`, value, `region.${region}.${prop}`);
			}
		}
	}

	const components = pack && pack.components;
	if (components && typeof components === "object") {
		for (const [component, block] of Object.entries(components)) {
			if (!COMPONENT_REGISTRY[component]) { warnings.push(`未知组件「${component}」已忽略`); continue; }
			if (!block || typeof block !== "object") continue;
			counts.components += 1;
			for (const [knob, raw] of Object.entries(block)) {
				const kind = KNOB_KINDS[knob];
				if (!kind) { warnings.push(`组件 ${component} 的 knob「${knob}」不在白名单，已忽略`); continue; }
				const value = normalizeRecipeValue(kind === "raw" && knob === "borderStyle" ? "raw" : kind, raw);
				if (value === null) { warnings.push(`组件 ${component}.${knob} 的值不合法，已忽略`); continue; }
				assign(`--dshte-${kebab(component)}-${COMPONENT_VAR_ALIASES[knob] || kebab(knob)}`, value, `${component}.${knob}`);
			}
		}
	}

	set.sort();
	const baseVars = compilePackBaseVars(pack);
	counts.baseDeclarations = Object.keys(baseVars).length;
	return { vars, baseVars, set, warnings, counts };
}

/** Build a `@font-face` block for every declared typography font. */
export function renderFontFaces(typography, assetBase) {
	const fonts = typography && Array.isArray(typography.fonts) ? typography.fonts : [];
	const base = String(assetBase || "").replace(/\/+$/, "");
	return fonts.map((font) => {
		const file = typeof font.file === "string" ? font.file.trim() : "";
		if (!file || !base) return "";
		const extension = (file.split(".").pop() || "").toLowerCase();
		const format = extension === "woff2" ? "woff2" : extension === "woff" ? "woff" : extension === "otf" ? "opentype" : "truetype";
		const family = String(font.family || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
		const weight = font.weight === undefined ? 400 : font.weight;
		const style = font.style === undefined ? "normal" : font.style;
		const display = font.display === undefined ? "swap" : font.display;
		const unicodeRange = typeof font.unicodeRange === "string" && font.unicodeRange.trim() ? ` unicode-range: ${font.unicodeRange.trim()};` : "";
		return `@font-face {\n  font-family: "${family}";\n  src: url("${base}/${file}") format("${format}");\n  font-weight: ${weight};\n  font-style: ${style};\n  font-display: ${display};${unicodeRange}\n}`;
	}).filter(Boolean).join("\n");
}

/** Fonts worth loading/checking with the FontFaceSet API. */
export function listFontChecks(typography) {
	const fonts = typography && Array.isArray(typography.fonts) ? typography.fonts : [];
	return fonts.filter((font) => font && typeof font.family === "string" && font.family.trim())
		.map((font) => ({
			family: font.family.trim(),
			weight: font.weight === undefined ? 400 : font.weight,
			style: font.style === undefined ? "normal" : font.style,
			file: typeof font.file === "string" ? font.file : null
		}));
}

function probeSelector(doc, selectors) {
	for (const selector of selectors) {
		try {
			const nodes = doc.querySelectorAll(selector);
			if (nodes && nodes.length > 0) return { selector, count: nodes.length };
		} catch { /* invalid selector: try the next fallback */ }
	}
	return { selector: null, count: 0 };
}

/** Drift probe for regions + components (read-only, cheap). */
export function probeRegistry(doc) {
	if (!doc || typeof doc.querySelectorAll !== "function") {
		return { entries: [], hit: 0, total: 0, hitRate: 0, missed: [], at: new Date().toISOString() };
	}
	const entries = [];
	const collect = (kind, registry) => {
		for (const [key, entry] of Object.entries(registry)) {
			const result = probeSelector(doc, entry.selectors);
			entries.push({
				kind, key, label: entry.label, confidence: entry.confidence,
				selectors: entry.selectors.slice(),
				hit: result.count > 0, count: result.count, selector: result.selector
			});
		}
	};
	collect("region", REGION_REGISTRY);
	collect("component", COMPONENT_REGISTRY);
	const hit = entries.filter((entry) => entry.hit).length;
	const total = entries.length;
	return {
		entries,
		hit,
		total,
		hitRate: total === 0 ? 0 : Math.round((hit / total) * 1000) / 10,
		missed: entries.filter((entry) => !entry.hit).map((entry) => ({ kind: entry.kind, key: entry.key, label: entry.label, selectors: entry.selectors })),
		at: new Date().toISOString()
	};
}

/** Probe the expected `[data-slot]` hook inventory. */
export function probeSlots(doc, slots = SLOT_HOOKS) {
	if (!doc || typeof doc.querySelector !== "function") return { hit: 0, total: slots.length, hitRate: 0, present: [], missing: slots.slice() };
	const present = [];
	const missing = [];
	for (const slot of slots) {
		let found = false;
		try { found = !!doc.querySelector(`[data-slot="${slot}"]`); } catch { found = false; }
		if (found) present.push(slot);
		else missing.push(slot);
	}
	return {
		hit: present.length,
		total: slots.length,
		hitRate: slots.length === 0 ? 0 : Math.round((present.length / slots.length) * 1000) / 10,
		present,
		missing
	};
}

/** Selector lists for engine.css generation tests / docs. */
export function registrySelectors() {
	return {
		regions: Object.fromEntries(Object.entries(REGION_REGISTRY).map(([key, entry]) => [key, entry.selectors.slice()])),
		components: Object.fromEntries(Object.entries(COMPONENT_REGISTRY).map(([key, entry]) => [key, entry.selectors.slice()]))
	};
}
