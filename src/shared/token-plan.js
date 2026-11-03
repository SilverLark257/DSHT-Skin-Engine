/**
 * dsh-tavern-skin-engine — token planning (pure, shared by the browser half and tests).
 *
 * Responsibilities (方案 §2.4/§6.4):
 *   - split a pack's token table into HOST tokens (`--dsw-*`, `--dsh-tavern-*`,
 *     applied through ctx.theme.overrideTokens) and ENGINE tokens (`--dshte-*`,
 *     written into the engine's own <style> block);
 *   - resolve light/dark pairs for every HOST token (overrideTokens requires
 *     `{ light, dark }` per token) according to `missingScheme` (`mirror` /
 *     `inherit`);
 *   - merge the user's per-scheme overrides on top of the pack;
 *   - render the engine-variable CSS (plus the `!important` fallback block for
 *     tokens the host layer refused);
 *   - diff the composed host tokens against what was applied (diagnostics).
 *
 * No DOM/Node APIs: the build inlines this file into the classic client bundle
 * (see scripts/build-client.mjs `@inline-shared`), and `tests/token-plan.test.mjs`
 * imports it directly.
 */

export const HOST_TOKEN_PREFIXES = ["--dsw-", "--dsh-tavern-"];
export const ENGINE_TOKEN_PREFIX = "--dshte-";
export const SCHEMES = ["light", "dark"];

export function isHostToken(name) {
	return HOST_TOKEN_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isEngineToken(name) {
	return name.startsWith(ENGINE_TOKEN_PREFIX);
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Minimal defense-in-depth for values that end up inside a <style> block. */
export function isSafeCssValue(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false;
	if (/[;}<]|<\/style|@import|javascript:|expression\(/i.test(value)) return false;
	const urls = [...value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
	return urls.every((match) => /^(assets\/|\/dsh-tavern-skin\/assets\/|data:)/.test(match[2].trim()));
}

/** Keep only string values in an overrides table ({light:{},dark:{}}). */
export function normalizeOverrides(overrides) {
	const out = { light: {}, dark: {} };
	if (!isPlainObject(overrides)) return out;
	for (const scheme of SCHEMES) {
		const block = overrides[scheme];
		if (!isPlainObject(block)) continue;
		for (const [name, value] of Object.entries(block)) {
			if (typeof value === "string" && isSafeCssValue(value)) out[scheme][name] = value;
		}
	}
	return out;
}

/**
 * @param {object} pack validated theme.json
 * @param {{overrides?: object, schemePolicy?: "mirror"|"inherit"|null}} [options]
 */
export function buildTokenPlan(pack, options = {}) {
	const scheme = pack && pack.colorScheme === "dark" ? "dark" : "light";
	const otherScheme = scheme === "light" ? "dark" : "light";
	const policy = options.schemePolicy || (pack && pack.missingScheme) || "mirror";
	const tokens = isPlainObject(pack && pack.tokens) ? pack.tokens : {};
	const overrides = normalizeOverrides(options.overrides);
	const warnings = [];

	let light = isPlainObject(tokens.light) ? { ...tokens.light } : {};
	let dark = isPlainObject(tokens.dark) ? { ...tokens.dark } : {};
	if (policy === "mirror") {
		// A pack that only designs one scheme mirrors the other one, so the skin
		// looks the same after a light/dark flip (方案 §2.3 missingScheme).
		light = { ...(isPlainObject(tokens.light) ? tokens.light : dark) };
		dark = { ...(isPlainObject(tokens.dark) ? tokens.dark : light) };
		Object.assign(light, overrides.light);
		Object.assign(dark, overrides.dark);
	} else {
		Object.assign(light, overrides.light);
		Object.assign(dark, overrides.dark);
	}
	const byScheme = { light, dark };

	const host = {};
	const engine = { light: {}, dark: {} };
	const rejected = [];
	for (const target of SCHEMES) {
		for (const [name, value] of Object.entries(byScheme[target])) {
			if (isHostToken(name)) {
				if (!isSafeCssValue(value)) { rejected.push({ name, scheme: target, reason: "unsafe-value" }); continue; }
				host[name] = host[name] || {};
				host[name][target] = value;
			} else if (isEngineToken(name)) {
				if (!isSafeCssValue(value)) { rejected.push({ name, scheme: target, reason: "unsafe-value" }); continue; }
				engine[target][name] = value;
			} else {
				rejected.push({ name, scheme: target, reason: "unknown-prefix" });
			}
		}
	}
	// overrideTokens requires both modes for every host token: mirror a single side.
	for (const [name, pair] of Object.entries(host)) {
		if (pair.light === undefined) pair.light = pair.dark;
		if (pair.dark === undefined) pair.dark = pair.light;
	}
	if (rejected.some((item) => item.reason === "unknown-prefix")) warnings.push("存在未知前缀的 token，已忽略");
	return {
		packId: pack && pack.id,
		scheme,
		otherScheme,
		policy,
		host,
		engine,
		hostTokenCount: Object.keys(host).length,
		engineTokenCount: Object.keys(engine.light).length + Object.keys(engine.dark).length,
		rejected,
		warnings
	};
}

/** Expected value of one host token in the given scheme. */
export function expectedHostValue(plan, scheme, name) {
	const pair = plan.host[name];
	if (!pair) return undefined;
	return pair[scheme === "dark" ? "dark" : "light"];
}

const COLOR_LIKE = /^#[0-9a-f]{3,8}$/i;
const normalizeColor = (value) => value.trim().toLowerCase();
const normalizeValue = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Compare the composed host token values with the plan.
 * Only exact-comparable values (hex colors) participate; others are reported
 * as "unverifiable" so the diagnostics page never lies.
 */
export function diffComposedTokens(plan, scheme, readValue) {
	const mismatched = [];
	const unverifiable = [];
	const missing = [];
	for (const [name, pair] of Object.entries(plan.host)) {
		const expected = expectedHostValue(plan, scheme, name);
		const actual = readValue(name);
		if (actual === undefined || actual === null || actual === "") { missing.push({ name, expected }); continue; }
		if (!COLOR_LIKE.test(expected)) { unverifiable.push({ name, expected, actual }); continue; }
		if (normalizeColor(actual) !== normalizeColor(expected)) mismatched.push({ name, expected, actual });
	}
	return { mismatched, missing, unverifiable };
}

/**
 * Render the engine <style> content.
 * @param {object} plan buildTokenPlan result
 * @param {{fallback?: {light: object, dark: object}}} [options] host tokens the
 *   host layer refused (rendered with `!important` as a safety net)
 */
export function renderVarsCss(plan, options = {}) {
	const blocks = [];
	const engineLight = plan.engine.light || {};
	const engineDark = plan.engine.dark || {};
	if (Object.keys(engineLight).length > 0) blocks.push(`:root {\n${renderDeclarations(engineLight, "")}\n}`);
	if (Object.keys(engineDark).length > 0) blocks.push(`body[data-ds-dark-theme] {\n${renderDeclarations(engineDark, "")}\n}`);
	const fallback = options.fallback || null;
	if (fallback) {
		const lightDecl = renderDeclarations(fallback.light || {}, "!important");
		const darkDecl = renderDeclarations(fallback.dark || {}, "!important");
		// The shell publishes token values as INLINE custom properties on <body>
		// (调查报告 §2.2). A `:root` declaration would lose to that inline value
		// because the body's own declaration is not inherited — so the fallback
		// must target <body> itself.
		if (lightDecl.trim()) blocks.push(`body {\n${lightDecl}\n}`);
		if (darkDecl.trim()) blocks.push(`body[data-ds-dark-theme] {\n${darkDecl}\n}`);
	}
	return blocks.join("\n");
}

function renderDeclarations(values, important) {
	return Object.entries(values)
		.filter(([name, value]) => isSafeCssValue(value) && (isHostToken(name) || isEngineToken(name)))
		.map(([name, value]) => `  ${name}: ${value}${important ? " !important" : ""};`)
		.join("\n");
}

/** Names of the 7 tokens that must always resolve (used by diagnostics). */
export const REQUIRED_HOST_TOKENS = [
	"--dsw-alias-bg-base",
	"--dsw-alias-bg-layer-1",
	"--dsw-alias-brand-primary",
	"--dsw-alias-label-primary",
	"--dsw-alias-label-secondary",
	"--dsw-alias-border-l1",
	"--dsw-alias-border-l2"
];
