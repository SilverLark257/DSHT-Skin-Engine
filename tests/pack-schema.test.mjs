/**
 * Unit tests for src/shared/pack-schema.js (validator core).
 * Each case asserts BOTH the ok flag and the field path of the error/warning —
 * "field path + readable reason" is the contract, silent drops are failures.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	LIMITS,
	REQUIRED_TOKENS,
	parseThemeJson,
	validateFileManifest,
	validateThemeCss,
	validateThemePack,
	checkPackPath
} from "../src/shared/pack-schema.js";

const required = {
	"--dsw-alias-bg-base": "#FAF9F5",
	"--dsw-alias-bg-layer-1": "#FFFDF8",
	"--dsw-alias-brand-primary": "#CC785C",
	"--dsw-alias-label-primary": "#2E2921",
	"--dsw-alias-label-secondary": "#6B6459",
	"--dsw-alias-border-l1": "#E6E0D6",
	"--dsw-alias-border-l2": "#D5CDC1"
};
const base = () => ({
	format: "dshte.theme",
	formatVersion: 1,
	release: "1.0.0",
	id: "unit-pack",
	name: "Unit Pack",
	colorScheme: "light",
	tokens: { light: { ...required } }
});
const codes = (result) => result.errors.map((item) => item.code);
const paths = (result) => result.errors.map((item) => item.path);

test("valid minimal pack passes and normalizes defaults", () => {
	const result = validateThemePack(base());
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.deepEqual(result.errors, []);
	assert.equal(result.normalized.meta.missingScheme, "mirror");
	assert.equal(result.stats.tokens, REQUIRED_TOKENS.length);
});

test("missing required token reports tokens.<scheme>[\"…\"] path", () => {
	const pack = base();
	delete pack.tokens.light["--dsw-alias-label-secondary"];
	const result = validateThemePack(pack);
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((item) => item.code === "missing-required-token" && item.path === 'tokens.light["--dsw-alias-label-secondary"]'));
});

test("invalid colorScheme does not cascade into misleading token errors", () => {
	const pack = base();
	pack.colorScheme = "auto";
	const result = validateThemePack(pack);
	assert.deepEqual(codes(result), ["enum"]);
	assert.equal(paths(result)[0], "colorScheme");
});

test("unknown token prefix is an error; unknown top-level field is a warning", () => {
	const pack = base();
	pack.tokens.light["--brand-color"] = "#fff";
	pack.unknownField = 1;
	const result = validateThemePack(pack);
	assert.ok(result.errors.some((item) => item.code === "token-prefix" && item.path === 'tokens.light["--brand-color"]'));
	assert.ok(result.warnings.some((item) => item.code === "unknown-field" && item.path === "$.unknownField"));
});

test("unsafe token values (; } external url) are rejected with the field path", () => {
	const semicolon = base();
	semicolon.tokens.light["--dsw-alias-bg-base"] = "#fff; } body { display:none";
	const external = base();
	external.tokens.light["--dshte-image"] = "url(https://evil.example/x.png)";
	const brace = base();
	brace.tokens.light["--dshte-bad"] = "a}";
	assert.ok(codes(validateThemePack(semicolon)).includes("unsafe-value"));
	assert.ok(codes(validateThemePack(external)).includes("external-resource"));
	assert.ok(codes(validateThemePack(brace)).includes("unsafe-value"));
});

test("asset-relative url() and data: values are allowed", () => {
	const pack = base();
	pack.tokens.light["--dshte-image"] = "url(assets/images/x.png)";
	pack.tokens.light["--dshte-abs"] = "url(/dsh-tavern-skin/assets/pack/x/y.png)";
	pack.tokens.light["--dshte-data"] = "url(data:image/svg+xml;base64,AAAA)";
	assert.equal(validateThemePack(pack).ok, true);
});

test("regions reject layout properties and unknown properties with reasons", () => {
	const layout = base();
	layout.regions = { sidebar: { width: 280 } };
	const unknown = base();
	unknown.regions = { sidebar: { borderRadius: "8px" } };
	const layoutResult = validateThemePack(layout);
	const unknownResult = validateThemePack(unknown);
	assert.ok(layoutResult.errors.some((item) => item.code === "layout-forbidden" && item.path === "regions.sidebar.width"));
	assert.ok(layoutResult.errors[0].message.includes("拖动把手"));
	assert.ok(unknownResult.errors.some((item) => item.code === "unknown-prop" && item.path === "regions.sidebar.borderRadius"));
});

test("components validate knob whitelist and types", () => {
	const badKnob = base();
	badKnob.components = { card: { gridTemplateColumns: "1fr" } };
	const badType = base();
	badType.components = { card: { radius: "big" } };
	const okPack = base();
	okPack.components = { card: { radius: 10, background: "var(--dshte-bg-surface)" } };
	assert.ok(codes(validateThemePack(badKnob)).includes("unknown-knob"));
	assert.ok(codes(validateThemePack(badType)).includes("type"));
	assert.equal(validateThemePack(okPack).ok, true);
});

test("engine range is honoured (too-new engine is an error, bad syntax is an error)", () => {
	const tooNew = base();
	tooNew.engine = ">=9.0.0";
	const badSyntax = base();
	badSyntax.engine = "latest";
	assert.ok(codes(validateThemePack(tooNew)).includes("incompatible"));
	assert.ok(codes(validateThemePack(badSyntax)).includes("pattern"));
});

test("dark block without required tokens only warns (mirror fallback)", () => {
	const pack = base();
	pack.tokens.dark = { "--dsw-alias-bg-base": "#111111" };
	const result = validateThemePack(pack);
	assert.equal(result.ok, true);
	assert.ok(result.warnings.filter((item) => item.code === "dark-fallback").length >= 6);
});

test("reserved / malformed ids are rejected", () => {
	for (const id of ["light", "dark", "system", "builtin-x", "Bad ID", "a"]) {
		const pack = base();
		pack.id = id;
		assert.equal(validateThemePack(pack).ok, false, id);
	}
});

test("file manifest enforces path safety, extensions and sizes", () => {
	assert.equal(checkPackPath("assets/images/x.png"), null);
	assert.ok(checkPackPath("../evil.png"));
	assert.ok(checkPackPath("assets\\fonts\\x.woff2"));
	assert.ok(checkPackPath("/abs/x.png"));
	const traversal = validateFileManifest([{ path: "../evil.png", size: 10 }]);
	assert.ok(codes(traversal).includes("unsafe-path"));
	const bigFile = validateFileManifest([{ path: "assets/images/x.png", size: LIMITS.fileBytes + 1 }]);
	assert.ok(codes(bigFile).includes("file-too-large"));
	const bigPack = validateFileManifest(
		[{ path: "assets/images/a.png", size: 60 }, { path: "assets/images/b.png", size: 60 }],
		{ limits: { packBytes: 100 } }
	);
	assert.ok(codes(bigPack).includes("pack-too-large"));
	const missing = validateFileManifest([{ path: "theme.css", size: 10 }], { declared: ["assets/images/missing.png"] });
	assert.ok(codes(missing).includes("missing-file"));
});

test("theme.css scanner: layout props, @import, external url, braces, !important", () => {
	const hookLayout = validateThemeCss('[data-slot="main"] { width: 100px; }');
	assert.ok(codes(hookLayout).includes("layout-forbidden"));
	const grid = validateThemeCss(".x { grid-template-columns: 1fr; }");
	assert.ok(codes(grid).includes("layout-forbidden"));
	const importRule = validateThemeCss('@import url("https://evil.example/x.css");');
	assert.ok(codes(importRule).includes("css-import"));
	const external = validateThemeCss("body { background: url(https://evil.example/x.png); }");
	assert.ok(codes(external).includes("external-resource"));
	const unbalanced = validateThemeCss("body { color: #fff;");
	assert.ok(codes(unbalanced).includes("css-brace"));
	const safe = validateThemeCss('html[data-dsh-material="none"] * { backdrop-filter: none !important; }\n*::-webkit-scrollbar { width: 10px; }');
	assert.equal(safe.ok, true, JSON.stringify(safe.errors));
	assert.ok(safe.warnings.some((item) => item.code === "important-count"));
});

test("parseThemeJson keeps JSON syntax errors readable", () => {
	const parsed = parseThemeJson('{ "format": "dshte.theme", ');
	assert.equal(parsed.ok, false);
	assert.ok(parsed.errors[0].message.includes("theme.json 不是合法 JSON"));
});

test("normalized output never drops a valid pack's data", () => {
	const pack = base();
	pack.regions = { sidebar: { background: "#fff" } };
	pack.typography = { sizes: { body: 13 } };
	const result = validateThemePack(pack);
	assert.equal(result.normalized.components, null);
	assert.equal(result.normalized.regions.sidebar.background, "#fff");
	assert.equal(result.normalized.typography.sizes.body, 13);
});
