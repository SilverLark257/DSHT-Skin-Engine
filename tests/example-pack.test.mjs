/**
 * Example pack (`themes/cocreate-paper`) acceptance:
 *   - passes the v1 validator
 *   - every design-spec §1/§3/§4/§5 number is present, exactly
 *   - theme.css uses only verified selectors (no build-hash classes) and the
 *     corrected material selector `html[data-dsh-material="none"]`
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	REQUIRED_TOKENS,
	validateThemePack,
	validateThemeCss,
	validateFileManifest
} from "../src/shared/pack-schema.js";

const packRoot = fileURLToPath(new URL("../themes/cocreate-paper", import.meta.url));
const readPack = async () => JSON.parse(await readFile(path.join(packRoot, "theme.json"), "utf8"));
const readCss = () => readFile(path.join(packRoot, "theme.css"), "utf8");

/** design-spec §1 token values (hex exactly as measured). */
const SPEC_TOKENS = {
	"--dsw-alias-bg-base": "#EFE8E0",
	"--dsw-alias-bg-layer-1": "#FEFAF7",
	"--dsw-alias-bg-layer-2": "#F6F1EB",
	"--dsw-alias-bg-layer-3": "#FFFFFF",
	"--dsw-specific-sidebar-fill": "#EFE7E4",
	"--dsw-specific-input-major": "#FFFFFF",
	"--dsw-specific-bubble": "#EAE2DF",
	"--dsw-alias-brand-primary": "#7557A8",
	"--dsw-alias-brand-text": "#FFFFFF",
	"--dsw-alias-button-primary-hover": "#63478F",
	"--dsw-alias-label-primary": "#14110F",
	"--dsw-alias-label-secondary": "#5F5A52",
	"--dsw-alias-label-tertiary": "#948F89",
	"--dsw-alias-border-l1": "#DCD8D7",
	"--dsw-alias-border-l2": "#CAC6C3",
	"--dsw-alias-markdown-code-block": "#EAE2DF",
	"--dsh-tavern-accent": "#7557A8",
	"--dsh-tavern-accent-soft": "#EAE4EE",
	"--dsh-tavern-accent-hairline": "#DCD8D7",
	"--dsh-tavern-radius-sm": "4px",
	"--dsh-tavern-radius-md": "8px",
	"--dsh-tavern-radius-lg": "10px",
	"--dshte-bg-sunken": "#D5D2CD",
	"--dshte-bg-gutter": "#F6F1EB",
	"--dshte-fg-body": "#35322C",
	"--dshte-fg-eyebrow": "#6D6278",
	"--dshte-fg-placeholder": "#797979",
	"--dshte-accent-weak": "#C8BDEB",
	"--dshte-accent-rule": "#6C5B89",
	"--dshte-accent-ink": "#5E4876",
	"--dshte-accent-pill": "#E1D7E5",
	"--dshte-danger": "#C34B5A",
	"--dshte-danger-bg": "#FCE4E7",
	"--dshte-success": "#2FB587",
	"--dshte-success-bg": "#E4F3EA",
	"--dshte-success-ink": "#36AF82",
	"--dshte-border-hairline": "#DCD8D7",
	"--dshte-border-rule": "#E9E2DA",
	"--dshte-border-sidebar": "#E5E1D9",
	"--dshte-shadow-line": "#CAC6C3",
	"--dshte-bg-accent-soft": "#EAE4EE",
	"--dshte-bg-accent-faint": "#F7F1FB",
	"--dshte-fg-inverse": "#FFFFFF"
};

/** design-spec §3 字号阶梯 / §4.2 间距 / §5 圆角. */
const SPEC_SIZES = { eyebrow: 10, brand: 16, panel: 20, h2: 16, body: 13, note: 11, nav: 12.5, group: 11, button: 11.5, meta: 10, chip: 12 };
const SPEC_SPACING = { xxs: 2, xs: 8, sm: 12, md: 20, lg: 28, xl: 36, xxl: 64, xxxl: 70, inputPad: 14, sidebarInset: 15, navPadX: 11, rightbarInset: 16 };
const SPEC_RADII = { quote: 4, sm: 8, card: 10, input: 14, pill: 9999 };

test("example pack passes v1 validation (only the !important warning expected)", async () => {
	const pack = await readPack();
	const result = validateThemePack(pack);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(pack.id, "cocreate-paper");
	assert.equal(pack.formatVersion, 1);
	assert.equal(pack.colorScheme, "light");
	assert.equal(pack.missingScheme, "mirror");
	assert.equal(pack.engine, ">=0.1.0");
	assert.deepEqual(result.errors, []);
	assert.ok(result.warnings.every((issue) => issue.code === "unknown-field" || issue.code === "important-count" || issue.code === "dark-fallback"));
});

test("design-spec §1 tokens are present 1:1", async () => {
	const pack = await readPack();
	for (const [token, value] of Object.entries(SPEC_TOKENS)) {
		assert.equal(pack.tokens.light[token], value, `${token} mismatch`);
	}
	for (const token of REQUIRED_TOKENS) assert.ok(token in pack.tokens.light, `missing required ${token}`);
	assert.equal(pack.preview.bg, "#EFE8E0");
	assert.equal(pack.preview.fg, "#14110F");
	assert.equal(pack.preview.accent, "#7557A8");
});

test("design-spec §3 typography scale matches exactly", async () => {
	const pack = await readPack();
	assert.deepEqual(pack.typography.sizes, SPEC_SIZES);
	assert.deepEqual(pack.typography.weights, { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 });
	assert.deepEqual(pack.typography.leading, { body: 1.6, tight: 1.35 });
	assert.equal(pack.typography.tracking.eyebrow, "0.12em");
	for (const key of ["sans", "latin", "display", "mono"]) assert.ok(pack.typography[key].includes(","), `font stack ${key}`);
});

test("design-spec §4 spacing and §5 radii match exactly", async () => {
	const pack = await readPack();
	assert.deepEqual(pack.spacing, SPEC_SPACING);
	assert.deepEqual(pack.radii, SPEC_RADII);
	assert.match(pack.shadows.card, /0 8px 20px rgba\(90,70,50,\.06\)/);
	assert.match(pack.shadows.spine, /191,178,231/);
	assert.equal(pack.shadows.line, "#CAC6C3");
});

test("regions/components carry the design-spec §6 decisions", async () => {
	const pack = await readPack();
	assert.deepEqual(Object.keys(pack.regions).sort(), ["center", "composer", "rightbar", "sidebar"]);
	assert.equal(pack.regions.rightbar.background, "transparent", "design-spec §10.8 default: right bar shows page background");
	assert.match(pack.regions.center.shadow, /inset 4px/);
	assert.deepEqual(Object.keys(pack.components).sort(), [
		"badge", "buttonDanger", "buttonGhost", "buttonPrimary", "card", "codeBlock",
		"eyebrow", "fileCard", "input", "navItem", "quote"
	]);
	assert.equal(pack.components.card.radius, 10);
	assert.equal(pack.components.buttonPrimary.height, 33);
	assert.equal(pack.components.quote.borderWidth, 3);
});

test("theme.css: only verified selectors, corrected material selector, no layout props", async () => {
	const css = await readCss();
	const result = validateThemeCss(css, { filename: "theme.css" });
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.ok(css.includes('html[data-dsh-material="none"]'));
	assert.ok(!css.includes("html [data-dsh-material"), "corrected selector must not have a descendant space");
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(!/pI_x6G|_frame|_sidebarCol|_centerCol|_rightbarCol/.test(withoutComments), "no build-hash selectors outside comments");
	assert.ok(!/url\(\s*['"]?https?:/i.test(withoutComments), "no external url()");
	assert.ok(!/@import/i.test(withoutComments));
});

test("example pack files are within limits and declared", async () => {
	const { readdir, stat } = await import("node:fs/promises");
	const files = [];
	const walk = async (directory, prefix) => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
			else files.push({ path: relative, size: (await stat(path.join(directory, entry.name))).size });
		}
	};
	await walk(packRoot, "");
	const result = validateFileManifest(files);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.ok(result.stats.totalBytes < 16 * 1024 * 1024);
	// Step 4: the example pack ships a font + a background image under assets/
	assert.ok(files.some((file) => /^assets\/fonts\/.*\.woff2$/.test(file.path)), "declared woff2 font exists");
	assert.ok(files.some((file) => /^assets\/images\/.*\.svg$/.test(file.path)), "declared background image exists");
});
