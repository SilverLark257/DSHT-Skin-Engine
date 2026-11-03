/**
 * Step 5 knob-model tests (方案 §5.3 rows 8–12).
 * Pure functions only: no DOM, no browser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	STEP5_ROW_IDS,
	REGION_DEFS,
	REGION_PROP_DEFS,
	COMPONENT_DEFS,
	TYPOGRAPHY_DEFS,
	RADII_DEFS,
	SPACING_DEFS,
	SHADOW_DEFS,
	COLOR_GROUPS,
	kebabCase,
	regionVarName,
	regionSetToken,
	componentVarName,
	componentSetToken,
	typographyVarName,
	typographySetToken,
	setTokenForVar,
	deriveExtraSetTokens,
	baseVarSetTokens,
	normalizeKnobValue,
	buildKnobModel,
	withTokenOverride,
	overrideValue,
	countOverrides
} from "../src/shared/ui-knobs.js";
import { compileRecipes, compilePackBaseVars } from "../src/shared/recipes.js";
import { COMPONENT_KNOBS, COMPONENT_NAMES, REGION_NAMES, REGION_PROPS } from "../src/shared/pack-schema.js";

const packRoot = fileURLToPath(new URL("../themes/cocreate-paper", import.meta.url));
const readPack = async () => JSON.parse(await readFile(path.join(packRoot, "theme.json"), "utf8"));

test("row ids match the 15-row plan (方案 §5.2)", () => {
	assert.equal(STEP5_ROW_IDS.length, 15);
	assert.equal(new Set(STEP5_ROW_IDS).size, 15);
	assert.deepEqual(STEP5_ROW_IDS, [
		"pack", "preview", "preview-live", "import", "export", "manage", "scheme",
		"colors", "typography", "shape", "regions", "components", "custom-css",
		"diagnostics", "advanced"
	]);
});

test("vocabulary stays in sync with pack-schema (UI exposes the CSS-effective subset)", () => {
	assert.deepEqual(COMPONENT_DEFS.map((entry) => entry.key), [...COMPONENT_NAMES]);
	for (const component of COMPONENT_DEFS) {
		// every UI knob must be legal in the pack schema
		for (const knob of component.knobs) assert.ok(COMPONENT_KNOBS[component.key].includes(knob), `${component.key}.${knob}`);
	}
	assert.deepEqual(REGION_DEFS.map((entry) => entry.key), [...REGION_NAMES]);
	assert.deepEqual(REGION_PROP_DEFS.map((entry) => entry.prop), [...REGION_PROPS]);
});

test("every region/component control has a matching opt-in rule in engine.css", async () => {
	const css = await readFile(fileURLToPath(new URL("../src/client/styles/engine.css", import.meta.url)), "utf8");
	const model = buildKnobModel(await readPack());
	const entries = [
		...model.regions.flatMap((region) => region.props),
		...model.components.flatMap((component) => component.knobs)
	];
	assert.ok(entries.length > 80);
	for (const entry of entries) {
		assert.ok(entry.setToken, `missing setToken for ${entry.token}`);
		assert.ok(css.includes(`data-dshte-set~="${entry.setToken}"`), `no engine.css rule for ${entry.setToken} (${entry.token})`);
	}
});

test("variable names mirror compileRecipes() and engine.css vocabulary", async () => {
	const pack = await readPack();
	const result = compileRecipes(pack);
	const css = await readFile(fileURLToPath(new URL("../src/client/styles/engine.css", import.meta.url)), "utf8");
	assert.equal(componentVarName("card", "background"), "--dshte-card-bg");
	assert.equal(componentVarName("buttonPrimary", "height"), "--dshte-button-primary-height");
	assert.equal(componentVarName("navItem", "activeBackground"), "--dshte-nav-item-active-bg");
	assert.equal(componentVarName("input", "placeholderColor"), "--dshte-input-placeholder-color");
	assert.equal(regionVarName("center", "backgroundImage"), "--dshte-region-center-bg-image");
	assert.equal(regionVarName("composer", "backdropFilter"), "--dshte-region-composer-backdrop");
	// Set tokens the pack declares that DO have an engine.css rule must be editable
	// in the UI. Schema knobs without a dedicated rule (borderColor / borderStyle
	// are consumed together with borderWidth) stay pack-level for now.
	const unmapped = [];
	for (const setToken of result.set) {
		const varName = [...Object.keys(result.vars.light)].find((name) => setTokenForVar(name) === setToken);
		if (!varName) {
			unmapped.push(setToken);
			assert.equal(css.includes(`data-dshte-set~="${setToken}"`), false, `set token ${setToken} has a CSS rule but no UI mapping`);
			continue;
		}
		assert.ok(Object.prototype.hasOwnProperty.call(result.vars.light, varName));
	}
	assert.deepEqual(unmapped.sort(), ["card.borderColor", "fileCard.borderColor", "quote.borderColor", "quote.borderStyle"]);
	assert.equal(setTokenForVar("--dshte-card-bg"), "card.background");
	assert.equal(setTokenForVar("--dshte-region-center-bg-image"), "region.center.backgroundImage");
	assert.equal(setTokenForVar("--dshte-font-sans"), "typography.font.sans");
	assert.equal(setTokenForVar("--dshte-text-body"), "typography.text.body");
	assert.equal(setTokenForVar("--dshte-radius-card"), null);
	assert.equal(kebabCase("rightbarInset"), "rightbar-inset");
});

test("buildKnobModel exposes every pack token exactly once in the color groups", async () => {
	const pack = await readPack();
	const model = buildKnobModel(pack);
	for (const scheme of ["light", "dark"]) {
		const expected = Object.keys(pack.tokens[scheme] || pack.tokens[pack.colorScheme] || {}).sort();
		const actual = model.colors[scheme].flatMap((group) => group.tokens.map((entry) => entry.name)).sort();
		assert.deepEqual(actual, expected, scheme);
	}
	assert.equal(model.scheme, "light");
	assert.equal(model.packId, "cocreate-paper");
	const surface = model.colors.light.find((group) => group.key === "surface");
	assert.ok(surface && surface.tokens.some((entry) => entry.name === "--dsw-alias-bg-base" && entry.kind === "color"));
	const shape = model.colors.light.find((group) => group.key === "hostshape");
	assert.ok(shape && shape.tokens.some((entry) => entry.name === "--dsh-tavern-radius-md" && entry.kind === "length"));
});

test("buildKnobModel fills defaults from the compiled pack values", async () => {
	const pack = await readPack();
	const compiled = compileRecipes(pack);
	const baseVars = compilePackBaseVars(pack);
	const model = buildKnobModel(pack, { baseVars, recipeVars: compiled.vars.light });
	assert.equal(model.typography.fonts.find((entry) => entry.key === "sans").defaultValue, baseVars["--dshte-font-sans"]);
	assert.equal(model.typography.sizes.find((entry) => entry.key === "body").defaultValue, "13px");
	assert.equal(model.shape.radii.find((entry) => entry.key === "card").defaultValue, "10px");
	assert.equal(model.shape.spacing.find((entry) => entry.key === "md").defaultValue, "20px");
	assert.equal(model.shape.shadows.find((entry) => entry.key === "card").defaultValue, baseVars["--dshte-shadow-card"]);
	const cardRadius = model.components.find((entry) => entry.key === "card").knobs.find((knob) => knob.knob === "radius");
	assert.equal(cardRadius.token, "--dshte-card-radius");
	assert.equal(cardRadius.setToken, "card.radius");
	assert.equal(cardRadius.defaultValue, "10px");
	const centerBg = model.regions.find((entry) => entry.key === "center").props.find((prop) => prop.prop === "backgroundImage");
	assert.equal(centerBg.setToken, "region.center.backgroundImage");
	assert.match(centerBg.defaultValue, /^url\(assets\//);
	// every model entry carries a unique token/setToken pair
	const entries = [
		...model.typography.fonts, ...model.typography.sizes, ...model.typography.weights,
		...model.typography.leading, ...model.typography.tracking,
		...model.shape.radii, ...model.shape.spacing, ...model.shape.shadows,
		...model.regions.flatMap((region) => region.props),
		...model.components.flatMap((component) => component.knobs)
	];
	const tokens = entries.map((entry) => entry.token);
	assert.equal(new Set(tokens).size, tokens.length, "duplicate token in model");
	for (const entry of entries) {
		assert.ok(entry.id && entry.label && entry.token && entry.kind, JSON.stringify(entry));
	}
});

test("buildKnobModel survives a pack without tokens/typography", () => {
	const model = buildKnobModel({ id: "x" });
	assert.deepEqual(model.colors.light, []);
	assert.equal(model.typography.fonts.length, 4);
	assert.equal(model.regions.length, REGION_DEFS.length);
	assert.equal(model.components.length, COMPONENT_DEFS.length);
	assert.equal(TYPOGRAPHY_DEFS.sizes.length, 11);
	assert.equal(RADII_DEFS.length, 5);
	assert.equal(SPACING_DEFS.length, 12);
	assert.equal(SHADOW_DEFS.length, 3);
});

test("deriveExtraSetTokens turns user overrides into opt-in set tokens", () => {
	const overrides = {
		light: {
			"--dshte-card-radius": "14px",
			"--dshte-region-center-bg-image": "url(assets/images/x.svg)",
			"--dsw-alias-bg-base": "#123456"
		},
		dark: { "--dshte-text-body": "15px", "--dshte-font-sans": '"A", sans-serif' }
	};
	assert.deepEqual(deriveExtraSetTokens(overrides), [
		"card.radius",
		"region.center.backgroundImage",
		"typography.font.sans",
		"typography.text.body"
	]);
	assert.deepEqual(deriveExtraSetTokens(null), []);
	assert.deepEqual(deriveExtraSetTokens({ light: {}, dark: {} }), []);
});

test("baseVarSetTokens only emits typography set tokens", () => {
	const baseVars = {
		"--dshte-font-sans": "x", "--dshte-text-body": "13px", "--dshte-weight-bold": "700",
		"--dshte-leading-body": "1.6", "--dshte-tracking-eyebrow": "0.12em",
		"--dshte-radius-card": "10px", "--dshte-space-md": "20px", "--dshte-shadow-card": "0 1px 0 #000"
	};
	assert.deepEqual(baseVarSetTokens(baseVars), [
		"typography.font.sans", "typography.leading.body", "typography.text.body",
		"typography.tracking.eyebrow", "typography.weight.bold"
	]);
	assert.deepEqual(baseVarSetTokens(null), []);
});

test("normalizeKnobValue validates and normalizes each control kind", () => {
	const ok = (kind, value) => normalizeKnobValue(kind, value).ok;
	const normalized = (kind, value) => normalizeKnobValue(kind, value).value;
	assert.equal(normalized("color", " #ABCDEF "), "#abcdef");
	assert.equal(normalized("color", "var(--dshte-accent)"), "var(--dshte-accent)");
	assert.equal(normalized("color", "color-mix(in srgb, #7557A8 10%, transparent)"), "color-mix(in srgb, #7557A8 10%, transparent)");
	assert.equal(normalized("length", 12), "12px");
	assert.equal(normalized("length", "1.5rem"), "1.5rem");
	assert.equal(normalized("weight", "600"), "600");
	assert.equal(normalized("lineHeight", 1.6), "1.6");
	assert.equal(normalized("opacity", "0.85"), "0.85");
	assert.equal(normalized("font", '"Inter", sans-serif'), '"Inter", sans-serif');
	assert.equal(normalized("text", "url(assets/images/x.svg)"), "url(assets/images/x.svg)");
	assert.equal(normalized("enum", "uppercase"), "uppercase");
	for (const [kind, value] of [
		["color", ""], ["color", "not a color"], ["color", "red; }"], ["length", "abc"], ["length", "12vw"],
		["weight", "650"], ["lineHeight", "9"], ["opacity", "2"], ["text", "a } b"], ["font", ""], ["enum", ""]
	]) {
		const result = normalizeKnobValue(kind, value);
		assert.equal(result.ok, false, `${kind} ${JSON.stringify(value)} should be invalid`);
		assert.ok(result.error && result.error.length > 0);
	}
	assert.equal(ok("color", "#fff"), true);
	assert.equal(ok("length", "12px"), true);
	assert.equal(ok("color", "rgb(1,2,3)"), true);
});

test("draft override helpers are immutable and delete on null", () => {
	const base = { light: { "--dshte-card-radius": "10px" }, dark: { "--dshte-card-radius": "10px" } };
	const next = withTokenOverride(base, ["light", "dark"], "--dshte-card-radius", "14px");
	assert.deepEqual(next.light["--dshte-card-radius"], "14px");
	assert.deepEqual(next.dark["--dshte-card-radius"], "14px");
	assert.deepEqual(base.light["--dshte-card-radius"], "10px", "input must not be mutated");
	const removed = withTokenOverride(next, "light", "--dshte-card-radius", null);
	assert.equal("--dshte-card-radius" in removed.light, false);
	assert.equal(removed.dark["--dshte-card-radius"], "14px");
	assert.equal(countOverrides({ light: { a: "1" }, dark: { b: "2", c: "3" } }), 3);
	assert.equal(overrideValue({ light: { "--x": "1" } }, "light", "--x"), "1");
	assert.equal(overrideValue({ light: { "--x": "1" } }, "dark", "--x"), undefined);
});

test("color groups cover every known token with a Chinese label", () => {
	const seen = new Set();
	for (const group of COLOR_GROUPS) {
		assert.ok(group.key && group.label && group.tokens);
		for (const [name, label] of Object.entries(group.tokens)) {
			assert.match(name, /^--(dsw|dsh-tavern|dshte)-/);
			assert.ok(label && typeof label === "string");
			assert.equal(seen.has(name), false, `duplicate color token ${name}`);
			seen.add(name);
		}
	}
	// 54 labelled palette tokens; --dshte-font-brand is a font stack and falls
	// into the "其它" bucket (covered by the exact color-group coverage test).
	assert.equal(seen.size, 54, "expected 54 labelled palette tokens");
	assert.equal(typographyVarName("sizes", "body"), "--dshte-text-body");
	assert.equal(typographySetToken("sizes", "body"), "typography.text.body");
});
