/**
 * Step 1 skeleton smoke tests (no browser, no network):
 * the package must satisfy the client-plugin contract and the built bundle
 * must stay in sync with its sources.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));

test("package identity matches the browser module id contract", () => {
	assert.equal(pkg.name, "dsh-tavern-skin-engine");
	assert.equal(pkg.dsh?.client?.platform, "web");
	assert.ok(pkg.version, "version must be non-empty for Tavern's plugin manifest check");
});

test("exports declare host half and client half", () => {
	assert.equal(pkg.exports?.["."], "./lib/index.js");
	const client = pkg.exports?.["./client"];
	const clientPath = typeof client === "string" ? client : client?.default;
	assert.equal(clientPath, "./lib/client.js");
	assert.ok(existsSync(path.join(root, "lib/index.js")), "host entry must exist");
	assert.ok(existsSync(path.join(root, "lib/client.js")), "client bundle must exist (run npm run build)");
});

test("host half exports name / inject / apply", () => {
	const host = read("lib/index.js");
	assert.match(host, /export const name = "dsh-tavern-skin-engine"/);
	assert.match(host, /export const inject = \["webServer"\]/);
	assert.match(host, /export function apply\(ctx\)/);
	assert.match(host, /\/dsh-tavern-skin\/ping/);
});

test("client bundle is a classic __ModuleLoader__ script with the right id", () => {
	const client = read("lib/client.js");
	assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
	assert.match(client, /id: "dsh-tavern-skin-engine"/);
	assert.match(client, /return \{ name: "dsh-tavern-skin-engine", apply, inject \}/);
	assert.match(client, /settings\.section/);
	assert.match(client, /skin-engine/);
});

test("client bundle requires only the react platform seed", () => {
	const client = read("lib/client.js");
	const required = [...client.matchAll(/require\((["'])([^"']+)\1\)/g)].map((match) => match[2]);
	assert.deepEqual([...new Set(required)], ["react"]);
});
