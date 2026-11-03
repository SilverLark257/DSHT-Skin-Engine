/**
 * Fixture tests: every on-disk fixture is exercised through the same code path
 * the CLI uses. Invalid fixtures must report a specific error CODE and a field
 * PATH; valid fixtures must pass (warnings allowed).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	parseThemeJson,
	validateThemePack,
	validateThemeCss,
	validateFileManifest
} from "../src/shared/pack-schema.js";
import { parseBundle } from "../src/shared/bundle-format.js";

const root = fileURLToPath(new URL("./fixtures", import.meta.url));

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (entry.isFile()) out.push({ path: path.relative(root, full).split(path.sep).join("/"), full });
	}
	return out;
}

async function loadPackFixture(fixturePath) {
	const text = await readFile(path.join(fixturePath, "theme.json"), "utf8");
	const parsed = parseThemeJson(text);
	if (!parsed.ok) return { parsed, result: null, css: null };
	const result = validateThemePack(parsed.pack);
	const files = await walk(fixturePath);
	const manifest = await Promise.all(files.map(async (file) => ({ path: path.relative(fixturePath, file.full).split(path.sep).join("/"), size: (await stat(file.full)).size })));
	const fileResult = validateFileManifest(manifest);
	let css = null;
	if (typeof parsed.pack.css === "string") {
		const file = files.find((item) => item.full === path.join(fixturePath, parsed.pack.css));
		if (file) css = validateThemeCss(await readFile(file.full, "utf8"), { filename: parsed.pack.css });
	}
	return { parsed, result, fileResult, css, files };
}

const invalidCases = [
	{ dir: "invalid/truncated-json", code: "json-parse" },
	{ dir: "invalid/bad-token-value", code: "unsafe-value" },
	{ dir: "invalid/unknown-prefix", code: "token-prefix" },
	{ dir: "invalid/missing-required-token", code: "missing-required-token" },
	{ dir: "invalid/missing-color-scheme", code: "enum" },
	{ dir: "invalid/bad-color-scheme", code: "enum" },
	{ dir: "invalid/bad-id", code: "pattern" },
	{ dir: "invalid/engine-too-new", code: "incompatible" },
	{ dir: "invalid/external-url-token", code: "external-resource" },
	{ dir: "invalid/region-layout-prop", code: "layout-forbidden" },
	{ dir: "invalid/region-unknown-prop", code: "unknown-prop" },
	{ dir: "invalid/component-unknown-knob", code: "unknown-knob" },
	{ dir: "invalid/component-type", code: "type" },
	{ dir: "invalid/bad-typography", code: "type" },
	{ dir: "invalid/asset-traversal", code: "unsafe-path" },
	{ dir: "invalid/theme-css-layout", code: "layout-forbidden" },
	{ dir: "invalid/theme-css-unbalanced", code: "css-brace" },
	{ dir: "invalid/theme-css-external-url", code: "external-resource" }
];

test("fixture inventory is >= 20 cases", async () => {
	const invalidDirs = (await readdir(path.join(root, "invalid"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
	const validDirs = (await readdir(path.join(root, "valid"), { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== "bundle").length;
	const bundles = (await readdir(path.join(root, "valid/bundle"))).length + (await readdir(path.join(root, "invalid/bundle"))).length;
	assert.ok(invalidDirs + validDirs + bundles >= 20, `only ${invalidDirs + validDirs + bundles} cases`);
});

for (const item of invalidCases) {
	test(`invalid fixture: ${item.dir} → ${item.code} with a field path`, async () => {
		const fixture = path.join(root, item.dir);
		const loaded = await loadPackFixture(fixture);
		const all = [...(loaded.parsed.errors || []), ...((loaded.result && loaded.result.errors) || []), ...((loaded.fileResult && loaded.fileResult.errors) || []), ...((loaded.css && loaded.css.errors) || [])];
		const hit = all.find((issue) => issue.code === item.code);
		assert.ok(hit, `expected code ${item.code}, got ${JSON.stringify(all)}`);
		assert.ok(typeof hit.path === "string" && hit.path.length > 0, "every issue must carry a field path");
		assert.ok(typeof hit.message === "string" && hit.message.length > 8, "every issue must carry a readable reason");
	});
}

test("valid fixtures pass (warnings allowed)", async () => {
	for (const dir of ["valid/minimal", "valid/unknown-fields", "valid/with-assets"]) {
		const loaded = await loadPackFixture(path.join(root, dir));
		assert.equal(loaded.parsed.ok, true, `${dir}: ${JSON.stringify(loaded.parsed.errors)}`);
		assert.equal(loaded.result.ok, true, `${dir}: ${JSON.stringify(loaded.result.errors)}`);
		assert.equal(loaded.fileResult.ok, true, `${dir}: ${JSON.stringify(loaded.fileResult.errors)}`);
		if (loaded.css) assert.equal(loaded.css.ok, true, `${dir}: ${JSON.stringify(loaded.css.errors)}`);
	}
});

test("unknown fields are reported as warnings, never dropped silently", async () => {
	const loaded = await loadPackFixture(path.join(root, "valid/unknown-fields"));
	assert.equal(loaded.result.ok, true);
	const warningPaths = loaded.result.warnings.map((item) => item.path);
	assert.ok(warningPaths.includes("$.unknownTopLevel"));
	assert.ok(warningPaths.includes("typography.unknownTypographyKey"));
});

test("bundle fixtures: valid pass, invalid fail with paths", async () => {
	const valid = parseBundle(JSON.parse(await readFile(path.join(root, "valid/bundle/with-files.dshte.json"), "utf8")));
	assert.equal(valid.ok, true, JSON.stringify(valid.errors));
	assert.equal(valid.files.get("theme.css"), "body { --dshte-fixture: 1; }\n");

	const cases = [
		["invalid/bundle/bad-format.dshte.json", "value", "format"],
		["invalid/bundle/traversal.dshte.json", "unsafe-path", 'files["../evil.css"]'],
		["invalid/bundle/bad-base64.dshte.json", "decode", 'files["assets/images/x.png"]'],
		["invalid/bundle/missing-pack.dshte.json", "type", "pack"]
	];
	for (const [rel, code, expectedPath] of cases) {
		const text = await readFile(path.join(root, rel), "utf8");
		const parsed = parseBundle(text);
		assert.equal(parsed.ok, false, rel);
		assert.ok(parsed.errors.some((item) => item.code === code && item.path === expectedPath), `${rel}: ${JSON.stringify(parsed.errors)}`);
		for (const issue of parsed.errors) assert.ok(issue.path.length > 0, `${rel}: issue without path`);
	}
});
