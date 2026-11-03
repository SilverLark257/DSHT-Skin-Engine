// Dev-only fixture generator: fixtures are committed as static files and are
// what the test suite reads. Re-run manually only when intentionally reshaping
// the fixture set: node tests/fixtures.generate.mjs
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./fixtures", import.meta.url));
rmSync(root, { recursive: true, force: true });
const write = (rel, data) => {
	const file = join(root, rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};

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
	id: "fixture-pack",
	name: "Fixture Pack",
	nameZh: "样例包",
	colorScheme: "light",
	tokens: { light: { ...required } }
});
const withCss = (pack) => ({ ...pack, css: "theme.css" });

// ── valid ────────────────────────────────────────────────────────────────
write("valid/minimal/theme.json", base());

write("valid/with-assets/theme.json", {
	...base(),
	id: "fixture-assets",
	name: "Fixture Assets",
	typography: {
		fonts: [{ family: "Fixture Sans", file: "assets/fonts/fixture.woff2", weight: 400, display: "swap" }],
		sizes: { body: 13 },
		tracking: { eyebrow: "0.12em" }
	},
	assets: { preview: "assets/images/preview.svg" },
	css: "theme.css"
});
write("valid/with-assets/theme.css", `@font-face { font-family: "Fixture Sans"; src: url(assets/fonts/fixture.woff2) format("woff2"); }\n[data-slot="sidebar.brand.name"] { letter-spacing: 0.12em; background-image: url(assets/images/preview.svg); }\n`);
write("valid/with-assets/assets/fonts/fixture.woff2", "dummy font bytes for validation only");
write("valid/with-assets/assets/images/preview.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#FAF9F5"/></svg>\n');

write("valid/unknown-fields/theme.json", {
	...base(),
	id: "fixture-unknown",
	unknownTopLevel: "ignored-with-warning",
	typography: { sizes: { body: 13 }, unknownTypographyKey: "x" }
});

write("valid/bundle/minimal.dshte.json", {
	format: "dshte.bundle",
	formatVersion: 1,
	exportedAt: "2026-11-02T23:00:00.000Z",
	engineVersion: "0.1.0",
	pack: base(),
	files: {}
});

write("valid/bundle/with-files.dshte.json", {
	format: "dshte.bundle",
	formatVersion: 1,
	exportedAt: "2026-11-02T23:00:00.000Z",
	engineVersion: "0.1.0",
	pack: withCss({ ...base(), id: "fixture-bundle-files" }),
	files: { "theme.css": "body { --dshte-fixture: 1; }\n" }
});

// ── invalid: manifest / tokens ────────────────────────────────────────────
write("invalid/truncated-json/theme.json", '{ "format": "dshte.theme", "formatVersion": 1, "tokens": { "light": {');
write("invalid/bad-token-value/theme.json", { ...base(), tokens: { light: { ...required, "--dsw-alias-bg-base": "#FAF9F5; } body { display:none" } } });
write("invalid/unknown-prefix/theme.json", { ...base(), tokens: { light: { ...required, "--brand-color": "#CC785C" } } });
write("invalid/missing-required-token/theme.json", { ...base(), tokens: { light: { "--dsw-alias-bg-base": "#FAF9F5" } } });
write("invalid/missing-color-scheme/theme.json", (() => { const pack = base(); delete pack.colorScheme; return pack; })());
write("invalid/bad-color-scheme/theme.json", { ...base(), colorScheme: "auto" });
write("invalid/bad-id/theme.json", { ...base(), id: "Bad ID" });
write("invalid/engine-too-new/theme.json", { ...base(), engine: ">=9.0.0" });
write("invalid/external-url-token/theme.json", { ...base(), tokens: { light: { ...required, "--dshte-wallpaper": "url(http://evil.example/x.png)" } } });

// ── invalid: whitelists / types ──────────────────────────────────────────
write("invalid/region-layout-prop/theme.json", { ...base(), regions: { sidebar: { width: 280 } } });
write("invalid/region-unknown-prop/theme.json", { ...base(), regions: { sidebar: { borderRadius: "8px" } } });
write("invalid/component-unknown-knob/theme.json", { ...base(), components: { card: { gridTemplateColumns: "1fr" } } });
write("invalid/component-type/theme.json", { ...base(), components: { card: { radius: "big" } } });
write("invalid/bad-typography/theme.json", { ...base(), typography: { sizes: { body: "huge" } } });
write("invalid/asset-traversal/theme.json", { ...base(), assets: { preview: "../../evil.png" } });

// ── invalid: theme.css ───────────────────────────────────────────────────
write("invalid/theme-css-layout/theme.json", withCss({ ...base(), id: "fixture-css-layout" }));
write("invalid/theme-css-layout/theme.css", '[data-slot="root"] [class*="_frame"] { grid-template-columns: 280px 1fr !important; }\n');
write("invalid/theme-css-unbalanced/theme.json", withCss({ ...base(), id: "fixture-css-unbalanced" }));
write("invalid/theme-css-unbalanced/theme.css", "body { color: #fff;\n");
write("invalid/theme-css-external-url/theme.json", withCss({ ...base(), id: "fixture-css-url" }));
write("invalid/theme-css-external-url/theme.css", 'body { background: url(https://evil.example/x.png); }\n');

// ── invalid: bundles ─────────────────────────────────────────────────────
write("invalid/bundle/bad-format.dshte.json", { format: "something.else", formatVersion: 1, pack: base(), files: {} });
write("invalid/bundle/traversal.dshte.json", {
	format: "dshte.bundle", formatVersion: 1, engineVersion: "0.1.0", pack: base(),
	files: { "../evil.css": "body{}" }
});
write("invalid/bundle/bad-base64.dshte.json", {
	format: "dshte.bundle", formatVersion: 1, engineVersion: "0.1.0", pack: base(),
	files: { "assets/images/x.png": "data:image/png;base64,!!!!not-base64!!!!" }
});
write("invalid/bundle/missing-pack.dshte.json", { format: "dshte.bundle", formatVersion: 1, files: {} });

console.log("fixtures written to", root);
