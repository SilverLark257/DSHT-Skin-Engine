/**
 * Unit tests for src/shared/bundle-format.js (.dshte.json round-trip).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	BUNDLE_FORMAT,
	buildBundle,
	parseBundle,
	stringifyBundle,
	base64ToBytes,
	bytesToBase64,
	formatBytes
} from "../src/shared/bundle-format.js";

const required = {
	"--dsw-alias-bg-base": "#111111",
	"--dsw-alias-bg-layer-1": "#222222",
	"--dsw-alias-brand-primary": "#333333",
	"--dsw-alias-label-primary": "#eeeeee",
	"--dsw-alias-label-secondary": "#bbbbbb",
	"--dsw-alias-border-l1": "#444444",
	"--dsw-alias-border-l2": "#555555"
};
const pack = () => ({
	format: "dshte.theme",
	formatVersion: 1,
	id: "bundle-pack",
	name: "Bundle Pack",
	colorScheme: "light",
	tokens: { light: { ...required } }
});

test("base64 helpers round-trip every byte length", () => {
	for (const size of [0, 1, 2, 3, 4, 5, 63, 64, 65, 255]) {
		const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 37) % 256);
		assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
	}
	assert.equal(formatBytes(1536), "1.5 KB");
});

test("build → stringify → parse preserves pod pack and text/binary files", () => {
	const png = Uint8Array.from([137, 80, 78, 71, 0, 1, 2, 255]);
	const built = buildBundle({
		pack: pack(),
		files: { "theme.css": "body { color: #fff; }\n", "assets/images/x.png": png },
		now: () => "2026-11-02T23:00:00.000Z"
	});
	assert.equal(built.ok, true, JSON.stringify(built.errors));
	assert.equal(built.bundle.format, BUNDLE_FORMAT);
	const text = stringifyBundle(built.bundle);
	const parsed = parseBundle(text);
	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	assert.equal(parsed.pack.id, "bundle-pack");
	assert.equal(parsed.files.get("theme.css"), "body { color: #fff; }\n");
	assert.deepEqual([...parsed.files.get("assets/images/x.png")], [...png]);
	assert.deepEqual(parsed.stats, { fileCount: 2, totalBytes: "body { color: #fff; }\n".length + png.length, packErrors: 0, packWarnings: 0 });
});

test("parsed text/plain values are rejected for binary paths", () => {
	const parsed = parseBundle({
		format: BUNDLE_FORMAT,
		formatVersion: 1,
		pack: pack(),
		files: { "assets/images/x.png": "not a data url" }
	});
	assert.equal(parsed.ok, false);
	assert.ok(parsed.errors.some((issue) => issue.code === "decode"));
});

test("buildBundle rejects theme.json inside files and unsafe paths", () => {
	const reserved = buildBundle({ pack: pack(), files: { "theme.json": "{}" } });
	assert.equal(reserved.ok, false);
	assert.ok(reserved.errors.some((issue) => issue.code === "reserved-file"));
	const traversal = buildBundle({ pack: pack(), files: { "../evil.css": "body{}" } });
	assert.equal(traversal.ok, false);
	assert.ok(traversal.errors.some((issue) => issue.code === "unsafe-path"));
});

test("parseBundle rejects oversized raw text and bad envelopes", () => {
	const huge = parseBundle("x".repeat(2048), { maxBundleBytes: 1024 });
	assert.equal(huge.ok, false);
	assert.ok(huge.errors.some((issue) => issue.code === "bundle-too-large"));
	const notJson = parseBundle("{ nope");
	assert.ok(notJson.errors.some((issue) => issue.code === "json-parse"));
	const wrongVersion = parseBundle({ format: BUNDLE_FORMAT, formatVersion: 2, pack: pack(), files: {} });
	assert.ok(wrongVersion.errors.some((issue) => issue.code === "value" && issue.path === "formatVersion"));
});

test("newer exporting engine only warns", () => {
	const parsed = parseBundle({ format: BUNDLE_FORMAT, formatVersion: 1, engineVersion: "9.0.0", pack: pack(), files: {} });
	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	assert.ok(parsed.warnings.some((issue) => issue.code === "newer-engine"));
});

test("pack errors inside a bundle are prefixed with pack.", () => {
	const bad = pack();
	delete bad.tokens.light["--dsw-alias-border-l2"];
	const parsed = parseBundle({ format: BUNDLE_FORMAT, formatVersion: 1, pack: bad, files: {} });
	assert.equal(parsed.ok, false);
	assert.ok(parsed.errors.some((issue) => issue.path === "pack.colorScheme" || issue.path === 'pack.tokens.light["--dsw-alias-border-l2"]'));
});
