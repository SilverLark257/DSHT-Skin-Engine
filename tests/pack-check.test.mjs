/**
 * CLI tests for scripts/pack-check.mjs.
 * The acceptance criteria say: `node scripts/pack-check.mjs themes/cocreate-paper`
 * passes, and negative fixtures print "field path + reason" (no silent failures).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (args) => {
	const result = spawnSync(process.execPath, [path.join(root, "scripts/pack-check.mjs"), ...args], { cwd: root, encoding: "utf8" });
	return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
};

test("example pack passes the CLI", () => {
	const result = run(["themes/cocreate-paper"]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /pack: cocreate-paper/);
	assert.match(result.stdout, /RESULT: OK/);
	assert.match(result.stdout, /stats: .*"tokens":\d+/);
});

test("negative fixture prints the field path and a reason", () => {
	const result = run(["tests/fixtures/invalid/region-layout-prop"]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /regions\.sidebar\.width/);
	assert.match(result.stdout, /layout-forbidden/);
	assert.match(result.stdout, /拖动把手/);
});

test("truncated JSON is reported as a theme.json parse error", () => {
	const result = run(["tests/fixtures/invalid/truncated-json"]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /json-parse/);
	assert.match(result.stdout, /theme\.json 不是合法 JSON/);
});

test("size-limit failure is reachable via flags (oversize case)", () => {
	const result = run(["themes/cocreate-paper", "--max-pack-bytes", "100"]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /pack-too-large/);
	assert.match(result.stdout, /超过上限/);
});

test("bundle mode validates both directions", () => {
	const valid = run(["--bundle", "tests/fixtures/valid/bundle/with-files.dshte.json"]);
	assert.equal(valid.status, 0, valid.stdout);
	assert.match(valid.stdout, /RESULT: OK/);
	const invalid = run(["--bundle", "tests/fixtures/invalid/bundle/traversal.dshte.json"]);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stdout, /unsafe-path/);
	assert.match(invalid.stdout, /\.\.\/evil\.css/);
});

test("--json emits a machine-readable report", () => {
	const result = run(["themes/cocreate-paper", "--json"]);
	assert.equal(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.ok, true);
	assert.equal(parsed.mode, "directory");
	assert.ok(Array.isArray(parsed.warnings));
	assert.equal(parsed.pack.id, "cocreate-paper");
});

test("usage errors exit with code 2", () => {
	const result = run([]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /usage:/);
});
