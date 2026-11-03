/**
 * Step 4 recipe compiler + drift probe tests (方案 §2.5/§4.5/§6.5).
 * Pure functions: no DOM is touched; the probe takes a minimal fake document.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	compileRecipes,
	renderFontFaces,
	listFontChecks,
	probeRegistry,
	probeSlots,
	registrySelectors,
	SLOT_HOOKS
} from "../src/shared/recipes.js";

const packRoot = fileURLToPath(new URL("../themes/cocreate-paper", import.meta.url));
const readPack = async () => JSON.parse(await readFile(path.join(packRoot, "theme.json"), "utf8"));

test("selectors prefer stable hooks and never hard-code build-hash class names", () => {
	const selectors = registrySelectors();
	const all = [
		...Object.values(selectors.regions).flat(),
		...Object.values(selectors.components).flat()
	];
	assert.ok(all.length >= 15);
	for (const selector of all) {
		assert.doesNotMatch(selector, /pI_x6G|EvIC1a|P3OORG|hHd-Xa|uV2eYG|bOPqQW|_markdown_/, `hash class used verbatim: ${selector}`);
	}
	// Every region/component must expose at least one attribute/slot/aria/semantic
	// primary selector; only sidebar uses the documented structural fallback.
	for (const [region, list] of Object.entries(selectors.regions)) {
		const primary = list[0];
		const stable = /\[data-|\[role=|\[aria-|\[data-slot|\.dsh-tavern-|^button\.|blockquote|pre|code/.test(primary);
		if (region === "sidebar") assert.match(primary, /\[class\*="_sidebarCol"\]/);
		else assert.ok(stable, `region ${region} primary selector is not a stable hook: ${primary}`);
	}
});

test("compileRecipes turns the example pack into prefixed variables + opt-in set tokens", async () => {
	const pack = await readPack();
	const result = compileRecipes(pack);
	assert.equal(result.counts.regions, 4);
	assert.equal(result.counts.components, 11);
	assert.ok(result.counts.declarations > 40, `declarations=${result.counts.declarations}`);
	assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));

	// lengths are normalized to px
	assert.equal(result.vars.light["--dshte-card-radius"], "10px");
	assert.equal(result.vars.light["--dshte-card-padding-x"], "20px");
	assert.equal(result.vars.light["--dshte-button-primary-height"], "33px");
	assert.equal(result.vars.light["--dshte-button-primary-font-size"], "11.5px");
	assert.equal(result.vars.light["--dshte-quote-border-width"], "3px");
	assert.equal(result.vars.light["--dshte-input-radius"], "14px");
	// raw values survive
	assert.equal(result.vars.light["--dshte-card-bg"], "var(--dshte-bg-surface)");
	assert.equal(result.vars.light["--dshte-region-center-shadow"], "inset 4px 0 0 0 var(--dshte-accent-weak)");
	assert.equal(result.vars.light["--dshte-region-rightbar-bg"], "transparent");
	// backgroundImage keeps the pack-relative url (rewritten later by the engine)
	assert.match(result.vars.light["--dshte-region-center-bg-image"], /^url\(assets\/images\/paper-grain-[0-9a-f]+\.svg\)$/);
	assert.ok(result.counts.assetUrls >= 1);
	// both schemes mirror the same visual values
	// typography / radii / spacing / shadows sugar (方案 §2.3 mapping table)
	assert.match(result.baseVars["--dshte-font-sans"], /PingFang SC/);
	assert.equal(result.baseVars["--dshte-text-body"], "13px");
	assert.equal(result.baseVars["--dshte-weight-bold"], "700");
	assert.equal(result.baseVars["--dshte-leading-body"], "1.6");
	assert.equal(result.baseVars["--dshte-tracking-eyebrow"], "0.12em");
	assert.equal(result.baseVars["--dshte-radius-card"], "10px");
	assert.equal(result.baseVars["--dshte-space-md"], "20px");
	assert.equal(result.baseVars["--dshte-shadow-card"], pack.shadows.card);
	assert.deepEqual(result.vars.light, result.vars.dark);
	// every variable has a matching opt-in set token and vice versa
	assert.equal(result.set.length, Object.keys(result.vars.light).length);
	assert.ok(result.set.includes("card.radius"));
	assert.ok(result.set.includes("region.center.backgroundImage"));
	assert.ok(result.set.includes("input.placeholderColor"));
});

test("compileRecipes ignores unknown regions/components/knobs with warnings (no throw)", () => {
	const pack = {
		regions: { sidebar: { width: "100px", background: "#fff" } },
		components: { card: { gridTemplateColumns: "1fr", radius: 12 }, unknownComponent: { x: 1 } }
	};
	const result = compileRecipes(pack);
	assert.equal(result.vars.light["--dshte-region-sidebar-bg"], "#fff");
	assert.equal(result.vars.light["--dshte-card-radius"], "12px");
	assert.ok(!("--dshte-region-sidebar-width" in result.vars.light));
	assert.ok(result.warnings.some((warning) => warning.includes("width")));
	assert.ok(result.warnings.some((warning) => warning.includes("unknownComponent")));
});

test("renderFontFaces emits @font-face with the asset route and correct formats", async () => {
	const pack = await readPack();
	const css = renderFontFaces(pack.typography, "/dsh-tavern-skin/assets/builtin/cocreate-paper");
	assert.equal((css.match(/@font-face/g) || []).length, 2);
	assert.match(css, /font-family: "COCREATE Display"/);
	assert.match(css, /url\("\/dsh-tavern-skin\/assets\/builtin\/cocreate-paper\/assets\/fonts\/cocreate-display-regular-[0-9a-f]+\.woff2"\)/);
	assert.match(css, /format\("woff2"\)/);
	assert.match(css, /font-weight: 400/);
	assert.match(css, /font-display: swap/);
	assert.equal(renderFontFaces({}, "/x"), "");
});

test("listFontChecks maps typography.fonts for document.fonts.load/check", async () => {
	const pack = await readPack();
	const checks = listFontChecks(pack.typography);
	assert.deepEqual(checks.map((font) => font.weight), [400, 500]);
	assert.ok(checks.every((font) => font.family === "COCREATE Display"));
});

function fakeDocument(counts) {
	return {
		querySelectorAll(selector) {
			const count = counts[selector] || 0;
			return { length: count, 0: {}, item: () => null };
		},
		querySelector(selector) {
			return (counts[selector] || 0) > 0 ? {} : null;
		}
	};
}

test("probeRegistry reports hit rate and missed components/regions", () => {
	// Real-session-like counts for most selectors; quote/code/fileCard untouched.
	const counts = {
		".dsh-tavern-user-bubble": 8,
		'[data-slot="conversation.composer.bar"] button[aria-label="发送消息"]': 1,
		"button.danger": 1,
		".dsh-tavern-choice-trigger": 4,
		"[data-composer-card]": 1,
		".dsh-tavern-side-row-main": 1,
		".dsh-tavern-side-title": 1,
		".dsh-tavern-mvu-receipt-summary": 1,
		".fork-status-card": 1,
		'[data-slot="root"] > [class*="_frame"] > [class*="_sidebarCol"]': 1,
		"[data-dsh-center-col]": 1,
		"[data-rightbar-col]": 1,
		'[role="dialog"]': 1
	};
	const report = probeRegistry(fakeDocument(counts));
	assert.equal(report.hit, 14);
	assert.equal(report.total, 16);
	assert.equal(report.hitRate, 87.5);
	assert.equal(report.missed.length, 2);
	assert.deepEqual(report.missed.map((entry) => entry.key).sort(), ["codeBlock", "quote"]);
});

test("probeRegistry on an empty document has a much lower hit rate than a real session", () => {
	const empty = probeRegistry(fakeDocument({}));
	const session = probeRegistry(fakeDocument({
		".dsh-tavern-user-bubble": 8, "button[aria-label=\"发送消息\"]": 1, ".dsh-tavern-choice-trigger": 4,
		"[data-composer-card]": 1, ".dsh-tavern-side-row-main": 1, ".dsh-tavern-side-title": 1,
		".dsh-tavern-mvu-receipt-summary": 1, ".fork-status-card": 1,
		'[data-slot="root"] > [class*="_frame"] > [class*="_sidebarCol"]': 1, "[data-dsh-center-col]": 1,
		"[data-rightbar-col]": 1, "[data-composer-stat] button": 1
	}));
	assert.equal(empty.hit, 0);
	assert.ok(session.hitRate > empty.hitRate + 50, `${session.hitRate} vs ${empty.hitRate}`);
});

test("probeSlots reports present/missing data-slot hooks", () => {
	const doc = fakeDocument({ '[data-slot="root"]': 1, '[data-slot="sidebar"]': 1, '[data-slot="main"]': 1 });
	const report = probeSlots(doc, ["root", "sidebar", "main", "conversation.chat.flow"]);
	assert.equal(report.hit, 3);
	assert.equal(report.total, 4);
	assert.deepEqual(report.missing, ["conversation.chat.flow"]);
	assert.ok(SLOT_HOOKS.includes("conversation.chat.flow"));
	assert.ok(SLOT_HOOKS.length >= 20);
});
