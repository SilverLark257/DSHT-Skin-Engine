/**
 * Tests for src/shared/css-precheck.js — the pack theme.css gate used before
 * injection (方案 §2.7: line-numbered syntax precheck + layout scan + url rewrite).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	precheckThemeCss,
	rewriteAssetUrls,
	listAssetUrls,
	utf8ByteLength
} from "../src/shared/css-precheck.js";

const VALID = `/* comment with { braces } that must be ignored */
[data-slot="sidebar.brand.name"] {
  font-family: var(--dshte-font-brand);
  font-weight: 800;
}
html[data-dsh-material="none"] * {
  -webkit-backdrop-filter: none !important;
}
`;

test("valid CSS passes with warnings only for !important", () => {
	const result = precheckThemeCss(VALID);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.errors.length, 0);
	assert.equal(result.stats.importantCount, 1);
	assert.ok(result.warnings.some((item) => item.code === "important-count"));
});

test("missing closing brace reports the rule's opening line", () => {
	const result = precheckThemeCss('[data-slot="a"] {\n  color: red;\n');
	assert.equal(result.ok, false);
	const error = result.errors.find((item) => item.code === "css-brace");
	assert.ok(error);
	assert.equal(error.line, 1);
	assert.match(error.message, /缺少右花括号/);
	assert.match(error.message, /^第 1 行/);
});

test("extra closing brace reports its line", () => {
	const result = precheckThemeCss('/* x */\n[data-slot="a"] { color: red; }\n}\n');
	assert.equal(result.ok, false);
	const error = result.errors.find((item) => item.code === "css-brace" && /多了一个右花括号/.test(item.message));
	assert.ok(error);
	assert.equal(error.line, 3);
});

test("unterminated string reports the line it started", () => {
	const result = precheckThemeCss('[data-slot="a"] {\n  content: "oops;\n}\n');
	assert.equal(result.ok, false);
	const error = result.errors.find((item) => item.code === "css-string");
	assert.ok(error);
	assert.equal(error.line, 2);
});

test("@import is rejected with a line number", () => {
	const result = precheckThemeCss('@import url("https://evil.example/x.css");\n');
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((item) => item.code === "css-import" && item.line === 1));
});

test("external url() is rejected with a line number", () => {
	const result = precheckThemeCss('[data-slot="a"] {\n  background: url(https://evil.example/x.png);\n}\n');
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((item) => item.code === "external-resource" && item.line === 2));
});

test("assets/ and /dsh-tavern-skin/assets/ and data: urls are allowed", () => {
	const result = precheckThemeCss(
		'[data-slot="a"] {\n'
		+ "  background-image: url(assets/images/x.png);\n"
		+ "  border-image: url('/dsh-tavern-skin/assets/builtin/p/assets/images/y.png') 1;\n"
		+ "  mask-image: url(data:image/svg+xml;base64,AAAA);\n"
		+ "}\n",
		{ filename: "ok.css" }
	);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("grid-template-columns is always a layout error", () => {
	const result = precheckThemeCss('[data-slot="root"] > [class*="_frame"] {\n  grid-template-columns: 200px 1fr;\n}\n');
	assert.equal(result.ok, false);
	const error = result.errors.find((item) => item.code === "layout-forbidden");
	assert.ok(error);
	assert.equal(error.line, 2);
	assert.match(error.message, /grid-template-columns/);
});

test("layout properties on three-column hooks are errors; elsewhere width is allowed", () => {
	const hook = precheckThemeCss('[data-slot="root"] > [class*="_frame"] { width: 100%; }\n');
	assert.equal(hook.ok, false);
	assert.ok(hook.errors.some((item) => item.code === "layout-forbidden"));

	const plain = precheckThemeCss('.some-card { width: 100%; }\n');
	assert.equal(plain.ok, true, JSON.stringify(plain.errors));
});

test("allowUnsafe downgrades layout errors to warnings (explicit unsafe pack)", () => {
	const result = precheckThemeCss('[data-slot="root"] > [class*="_frame"] { width: 100%; }\n', { allowUnsafe: true });
	assert.equal(result.ok, true);
	assert.ok(result.warnings.some((item) => item.code === "layout-forbidden"));
});

test("url(assets/…) is rewritten to the plugin asset route, other urls untouched", () => {
	const css = 'a {\n  background: url(assets/images/x.svg);\n  mask: url("assets/fonts/f.woff2");\n  border: url(/dsh-tavern-skin/assets/builtin/p/a.png);\n  content: url(data:image/png;base64,AA);\n}\n';
	const rewritten = rewriteAssetUrls(css, "/dsh-tavern-skin/assets/builtin/cocreate-paper/");
	assert.match(rewritten, /url\("\/dsh-tavern-skin\/assets\/builtin\/cocreate-paper\/assets\/fonts\/f\.woff2"\)/);
	assert.match(rewritten, /url\(\/dsh-tavern-skin\/assets\/builtin\/cocreate-paper\/assets\/images\/x\.svg\)/);
	// absolute + data urls stay as they are
	assert.match(rewritten, /url\(\/dsh-tavern-skin\/assets\/builtin\/p\/a\.png\)/);
	assert.match(rewritten, /url\(data:image\/png;base64,AA\)/);
	assert.deepEqual(listAssetUrls(css), ["assets/images/x.svg", "assets/fonts/f.woff2"]);
});

test("size limit rejects an oversized css", () => {
	const result = precheckThemeCss("[data-slot=\"a\"] { color: red; }\n".repeat(2000), { limits: { bytes: 1024 } });
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((item) => item.code === "css-too-large"));
});

test("empty css is a warning, not an error", () => {
	const result = precheckThemeCss("   \n");
	assert.equal(result.ok, true);
	assert.ok(result.warnings.some((item) => item.code === "empty-css"));
});

test("utf8ByteLength counts multi-byte characters", () => {
	assert.equal(utf8ByteLength("abc"), 3);
	assert.equal(utf8ByteLength("中文"), 6);
	assert.equal(utf8ByteLength("😀"), 4);
});
