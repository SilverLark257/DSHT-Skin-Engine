/**
 * Step 5 — client core checks (纯 Node，无 DOM 依赖).
 *
 * Two layers:
 *   1. 行为：用最小 window/document/localStorage/fetch 桩执行 store.js 片段，
 *      验证 §2.3 的持久化/去抖/安全模式/损坏回退/清缓存语义。
 *   2. 结构：静态断言 engine.js / engine.css / main.js 满足契约 §4/§5 的硬约束
 *      （预览路径不得出现 overrideTokens、typography 规则必须逐项 opt-in 等）。
 *
 * 不 require 真实 DOM 库；不执行 build（由 Lead 做最终构建）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, ROOT), "utf8");
const STORE_SOURCE = read("src/client/store.js");
const ENGINE_SOURCE = read("src/client/engine.js");
const ENGINE_CSS = read("src/client/styles/engine.css");
const MAIN_SOURCE = read("src/client/main.js");

/* ── 极简浏览器桩 ─────────────────────────────────────────────────────── */

function makeLocalStorage() {
	const map = new Map();
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => { map.set(key, String(value)); },
		removeItem: (key) => { map.delete(key); },
		clear: () => map.clear(),
		key: (index) => [...map.keys()][index] ?? null,
		get length() { return map.size; },
		_map: map
	};
}

function makeStore(env = {}) {
	const localStorage = env.localStorage || makeLocalStorage();
	const calls = env.calls || [];
	const handler = env.handler || (() => ({ value: {} }));
	const fetchImpl = env.fetchImpl || (async (url, init) => {
		const request = JSON.parse(init.body);
		calls.push(request);
		const result = handler(request);
		if (result && result.throw) throw new Error(result.throw);
		if (result && result.status && result.status >= 400) {
			return { ok: false, status: result.status, json: async () => ({ ok: false, error: { message: result.error || "failed" } }) };
		}
		return { ok: true, status: 200, json: async () => ({ ok: true, value: result.value === undefined ? {} : result.value }) };
	});
	const documentStub = {
		fonts: { add() {}, delete() { return true; }, load: async () => [], check: () => true },
		body: null
	};
	const windowStub = { localStorage, FontFace: undefined };
	const factory = new Function("TAG", "log", "window", "document", "fetch", `${STORE_SOURCE}\nreturn createStateStore;`);
	const create = factory("[test]", () => {}, windowStub, documentStub, fetchImpl);
	return { store: create(), localStorage, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ── 1. store.js 行为 ─────────────────────────────────────────────────── */

test("store exposes the §2.3 surface and uses a 1000ms host debounce", () => {
	const { store } = makeStore();
	for (const key of ["get", "subscribe", "set", "hydrate", "api", "hostStatus", "flush", "saveNow", "isSafeMode", "setSafeMode", "getUi", "setUi", "getCustomCss", "setCustomCss", "clearLocalCache", "snapshot"]) {
		assert.equal(typeof store[key], "function", `missing store.${key}()`);
	}
	for (const key of ["list", "add", "remove", "restore"]) {
		assert.equal(typeof store.userFonts[key], "function", `missing store.userFonts.${key}()`);
	}
	assert.equal(store.hostStatus().hostDebounceMs, 1000);
	assert.equal(store.get().format, "dshte.state");
	assert.equal(store.getUi().previewLive, true);
});

test("store.set validates like the host and never writes invalid state", () => {
	const { store, localStorage } = makeStore();
	const badId = store.set({ activePackId: "BAD ID" });
	assert.equal(badId.ok, false);
	assert.match(badId.error, /activePackId/);

	const badToken = store.set({ overrides: { light: { "not-a-token": "#fff" }, dark: {} } });
	assert.equal(badToken.ok, false);
	assert.match(badToken.error, /token 名不合法/);

	const longValue = store.set({ overrides: { light: { "--dsw-alias-bg-base": "x".repeat(2001) }, dark: {} } });
	assert.equal(longValue.ok, false);

	assert.equal(store.get().activePackId, "cocreate-paper");
	assert.equal(localStorage.getItem("dshte:state:v1"), null);
});

test("store.set writes the localStorage seed immediately and debounces the host write", async () => {
	const { store, localStorage, calls } = makeStore({ handler: () => ({ value: {} }) });
	const result = store.set({ activePackId: "my-pack", overrides: { light: { "--dsw-alias-bg-base": "#3366cc" }, dark: {} } }, { reason: "overrides", debounceMs: 5 });
	assert.equal(result.ok, true);
	assert.equal(store.get().activePackId, "my-pack");
	const seed = JSON.parse(localStorage.getItem("dshte:state:v1"));
	assert.equal(seed.overrides.light["--dsw-alias-bg-base"], "#3366cc");

	assert.equal(calls.length, 0, "host write must be debounced, not immediate");
	const written = await store.flush();
	assert.equal(written.ok, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].method, "state.set");
	assert.equal(calls[0].args.state.activePackId, "my-pack");
	assert.equal(store.hostStatus().writeCount, 1);
	await tick();
});

test("store.set merges overrides scheme-wise but an explicit empty block clears", () => {
	const { store } = makeStore();
	store.set({ overrides: { light: { "--dshte-text-body": "15px" }, dark: { "--dshte-text-body": "15px" } } });
	store.set({ overrides: { light: { "--dshte-text-body": "17px" } } });
	assert.equal(store.get().overrides.light["--dshte-text-body"], "17px");
	assert.equal(store.get().overrides.dark["--dshte-text-body"], "15px");
	store.set({ overrides: { light: {}, dark: {} } });
	assert.deepEqual(store.get().overrides, { light: {}, dark: {} });
});

test("hydrate keeps the local seed when the host reports fresh:true and writes it back", async () => {
	const localStorage = makeLocalStorage();
	localStorage.setItem("dshte:state:v1", JSON.stringify({
		format: "dshte.state", version: 1, activePackId: "seed-pack", enabled: true,
		schemePolicy: null, overrides: { light: {}, dark: {} }
	}));
	const { store, calls } = makeStore({
		localStorage,
		handler: (request) => (request.method === "state.get"
			? { value: { format: "dshte.state", version: 1, activePackId: "cocreate-paper", enabled: true, schemePolicy: null, overrides: { light: {}, dark: {} }, fresh: true } }
			: { value: {} })
	});
	await store.hydrate();
	assert.equal(store.get().activePackId, "seed-pack", "fresh host must not clobber the local seed");
	const written = await store.flush();
	assert.equal(written.ok, true);
	assert.ok(calls.some((call) => call.method === "state.set"));
});

test("hydrate makes the host state authoritative and rewrites the seed", async () => {
	const { store, localStorage } = makeStore({
		handler: (request) => (request.method === "state.get"
			? { value: { format: "dshte.state", version: 1, activePackId: "host-pack", enabled: false, schemePolicy: "inherit", overrides: { light: { "--dsw-alias-bg-base": "#123456" }, dark: {} } } }
			: { value: {} })
	});
	await store.hydrate();
	assert.equal(store.get().activePackId, "host-pack");
	assert.equal(store.get().enabled, false);
	assert.equal(store.get().schemePolicy, "inherit");
	const seed = JSON.parse(localStorage.getItem("dshte:state:v1"));
	assert.equal(seed.activePackId, "host-pack");
});

test("hydrate never throws when the host is unavailable and surfaces lastError", async () => {
	const { store } = makeStore({ fetchImpl: async () => { throw new Error("network down"); } });
	await store.hydrate();
	const status = store.hostStatus();
	assert.equal(status.available, false);
	assert.match(status.lastError, /network down/);
});

test("a corrupt localStorage seed falls back to defaults and is reported", () => {
	const localStorage = makeLocalStorage();
	localStorage.setItem("dshte:state:v1", "{not json");
	const { store } = makeStore({ localStorage });
	assert.equal(store.get().activePackId, "cocreate-paper");
	assert.equal(store.snapshot().corruptSeed, true);

	const bad = makeLocalStorage();
	bad.setItem("dshte:state:v1", JSON.stringify({ format: "dshte.state", version: 1, overrides: { light: { nope: "#fff" } } }));
	const second = makeStore({ localStorage: bad }).store;
	assert.equal(second.snapshot().corruptSeed, true);
});

test("safe mode is a persisted lifeline and survives clearLocalCache", async () => {
	const localStorage = makeLocalStorage();
	const { store } = makeStore({ localStorage, handler: () => ({ value: { format: "dshte.state", version: 1, activePackId: null, enabled: true, schemePolicy: null, overrides: { light: {}, dark: {} } } }) });
	assert.equal(store.isSafeMode(), false);
	store.setSafeMode(true);
	assert.equal(localStorage.getItem("dshte:safe:v1"), "1");
	assert.equal(store.isSafeMode(), true);
	const cleared = await store.clearLocalCache();
	assert.ok(cleared.kept.includes("dshte:safe:v1"));
	assert.equal(store.isSafeMode(), true, "safe mode must never be cleared with the cache");
	store.setSafeMode(false);
	assert.equal(localStorage.getItem("dshte:safe:v1"), null);
});

test("ui preferences and custom CSS persist with versioned keys", () => {
	const localStorage = makeLocalStorage();
	const first = makeStore({ localStorage }).store;
	assert.equal(first.setUi({ previewLive: false }).previewLive, false);
	first.setCustomCss("body { color: red; }");
	assert.deepEqual(first.getCustomCss().text, "body { color: red; }");
	assert.match(first.getCustomCss().savedAt, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(JSON.parse(localStorage.getItem("dshte:ui:v1")).previewLive, false);
	assert.equal(JSON.parse(localStorage.getItem("dshte:userCss:v1")).text, "body { color: red; }");

	const second = makeStore({ localStorage }).store;
	assert.equal(second.getUi().previewLive, false);
	assert.equal(second.getCustomCss().text, "body { color: red; }");

	second.setCustomCss("");
	assert.equal(localStorage.getItem("dshte:userCss:v1"), null);
	assert.equal(second.snapshot().userCss.present, false);
});

test("clearLocalCache removes the four cache keys, keeps safe and rehydrates from the host", async () => {
	const localStorage = makeLocalStorage();
	localStorage.setItem("dshte:userFonts:v1", JSON.stringify([
		{ id: "uabc123", family: "ignored", weight: 400, style: "normal", fileName: "a.woff2", mime: "font/woff2", dataUrl: "data:font/woff2;base64,AAAA", bytes: 10 }
	]));
	const { store } = makeStore({
		localStorage,
		handler: () => ({ value: { format: "dshte.state", version: 1, activePackId: "host-pack", enabled: true, schemePolicy: null, overrides: { light: {}, dark: {} } } })
	});
	store.set({ activePackId: "local-pack" });
	store.setUi({ previewLive: false });
	store.setCustomCss("a { color: red; }");
	store.setSafeMode(true);
	assert.equal(store.userFonts.list().length, 1);

	const result = await store.clearLocalCache();
	assert.equal(result.removed.length, 4);
	assert.ok(result.removed.includes("dshte:state:v1"));
	assert.ok(result.removed.includes("dshte:userCss:v1"));
	assert.deepEqual(result.kept, ["dshte:safe:v1"]);
	assert.equal(store.get().activePackId, "host-pack", "host state must win after the cache reset");
	assert.equal(store.getUi().previewLive, true);
	assert.equal(store.getCustomCss().text, "");
	assert.equal(store.userFonts.list().length, 0);
});

test("userFonts rejects bad type/size/quota with an inline-visible error", async () => {
	const { store } = makeStore();
	const badType = await store.userFonts.add({ name: "evil.exe", size: 10, type: "application/octet-stream" });
	assert.equal(badType.ok, false);
	assert.match(badType.error, /woff2/);
	const tooBig = await store.userFonts.add({ name: "big.woff2", size: 2 * 1024 * 1024, type: "font/woff2" });
	assert.equal(tooBig.ok, false);
	assert.match(tooBig.error, /1.5 MB/);
	const noApi = await store.userFonts.add({ name: "ok.woff2", size: 1024, type: "font/woff2" });
	assert.equal(noApi.ok, false);
	assert.match(noApi.error, /FontFace/);
});

test("snapshot exposes key presence/bytes without token values", () => {
	const localStorage = makeLocalStorage();
	const { store } = makeStore({ localStorage });
	store.set({ overrides: { light: { "--dsw-alias-bg-base": "#000000" }, dark: {} } });
	const snapshot = store.snapshot();
	assert.equal(snapshot.keys["dshte:state:v1"].present, true);
	assert.equal(typeof snapshot.keys["dshte:state:v1"].bytes, "number");
	assert.equal(snapshot.keys["dshte:safe:v1"], null);
	assert.equal(snapshot.safeMode, false);
	assert.equal(snapshot.host.hostDebounceMs, 1000);
	assert.equal(JSON.stringify(snapshot).includes("#000000"), false, "snapshot must not leak token values");
});

/* ── 2. engine.js 结构约束 ────────────────────────────────────────────── */

test("engine.js stays a classic script fragment (no import/export/require)", () => {
	for (const [name, source] of [["store.js", STORE_SOURCE], ["engine.js", ENGINE_SOURCE]]) {
		assert.equal(/^\s*(import|export)\s/m.test(source), false, `${name} must not use import/export`);
		assert.equal(/\brequire\s*\(/.test(source), false, `${name} must not require()`);
	}
});

test("engine.js preview path never stacks a token layer", () => {
	const match = /function preview\(overrides\) \{([\s\S]*?)\n\t\}/.exec(ENGINE_SOURCE);
	assert.ok(match, "preview(overrides) not found");
	assert.equal(match[1].includes("overrideTokens"), false, "preview must not call overrideTokens");
	assert.equal(/store\.(set|setCustomCss|setUi)\s*\(/.test(match[1]), false, "preview must not write store state");

	const applyMatch = /function apply\(reason, options = \{\}\) \{([\s\S]*?)\n\t\}/.exec(ENGINE_SOURCE);
	assert.ok(applyMatch, "apply() not found");
	assert.ok(applyMatch[1].includes("overrideTokens"), "apply() is still the only stacking path");
	assert.ok(applyMatch[1].includes("removePreviewStyle"), "apply() must drop a pending preview");
});

test("engine.js exposes the Step 5 surface and diagnostics additions", () => {
	for (const needle of ["compilePackPlan", "function preview(", "function clearPreview(", "function setUserCss(", "function setSafeMode(", "function reloadPack(", "deriveExtraSetTokens(", "baseVarSetTokens(", "committedSetTokens", "dshte-preview", "dshte-user-css", "lateStyles", "styleOrder", "safeMode", "step: 7"]) {
		assert.ok(ENGINE_SOURCE.includes(needle), `engine.js missing ${needle}`);
	}
	assert.ok(/runtime\.userCssText/.test(ENGINE_SOURCE));
	assert.ok(/store\.userFonts\.restore\(\)/.test(ENGINE_SOURCE), "boot must restore local fonts");
	assert.ok(/store\.getCustomCss\(\)/.test(ENGINE_SOURCE), "boot must inject saved custom CSS");
});

test("engine.js start() honours the safe-mode lifeline", () => {
	const match = /async function start\(\) \{([\s\S]*?)\n\t\}/.exec(ENGINE_SOURCE);
	assert.ok(match, "start() not found");
	const body = match[1];
	assert.ok(body.includes("store.isSafeMode()"));
	assert.ok(body.includes("safeMode"));
	const safeBranch = body.slice(body.indexOf("if (runtime.safeMode)"));
	assert.ok(safeBranch.indexOf("return") >= 0, "safe mode must return before theme injection");
});

/* ── 3. engine.css typography ─────────────────────────────────────────── */

test("engine.css appends the five opt-in typography rules", () => {
	const section = ENGINE_CSS.slice(ENGINE_CSS.indexOf("Step 5: typography"));
	assert.ok(section.length > 0, "typography section missing");
	for (const token of ["typography.font.sans", "typography.font.mono", "typography.text.body", "typography.leading.body", "typography.tracking.eyebrow"]) {
		assert.ok(section.includes(`[data-dshte-set~="${token}"]`), `missing opt-in rule for ${token}`);
	}
	assert.ok(section.includes("var(--dshte-font-sans)"));
	assert.ok(section.includes("var(--dshte-font-mono)"));
	assert.ok(section.includes("var(--dshte-text-body)"));
	assert.ok(section.includes("var(--dshte-leading-body)"));
	assert.ok(section.includes("var(--dshte-tracking-eyebrow)"));

	// 逐项 opt-in：不存在无 data-dshte-set 前缀的选择器块。
	const selectors = section.split("\n").filter((line) => /\{$/.test(line.trim()) && line.trim().indexOf("/*") !== 0);
	for (const selector of selectors) {
		assert.ok(selector.includes("data-dshte-set"), `unscoped typography rule: ${selector.trim()}`);
	}
	// 不写布局属性（方案 §2.5），也不出现构建哈希类名。
	assert.equal(/\b(grid-template|grid-area|grid-column|flex-basis|min-width|max-width|position\s*:)\b/.test(section), false);
	assert.equal(/_[A-Za-z0-9]{5,}\b/.test(section), false, "typography rules must not embed build-hash class names");
});

/* ── 4. main.js include order (契约 §1) ───────────────────────────────── */

test("main.js keeps the frozen include order and Step 5 entry points", () => {
	// Only inspect the factory body: the header comment mentions the markers too.
	const factory = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('const React = require("react")'));
	const order = [
		"// @include ./parts/log.js",
		"// @inline-shared ../shared/token-plan.js",
		"// @inline-shared ../shared/css-precheck.js",
		"// @include ./store.js",
		"// @inline-shared ../shared/recipes.js",
		"// @inline-shared ../shared/ui-knobs.js",
		"// @inline-css ./styles/engine.css",
		"// @include ./engine.js",
		"// @builtin-packs"
	];
	let cursor = -1;
	for (const marker of order) {
		const index = factory.indexOf(marker);
		assert.ok(index > cursor, `${marker} is out of order in main.js`);
		cursor = index;
	}
	for (const needle of ["preview: (overrides) => engine.preview(overrides)", "clearPreview: () => engine.clearPreview()", "setUserCss: (text) => engine.setUserCss(text)", "setSafeMode: (on) => engine.setSafeMode(on)", "reloadPack: () => engine.reloadPack()", "storeSnapshot: () => store.snapshot()"]) {
		assert.ok(MAIN_SOURCE.includes(needle), `main.js missing ${needle}`);
	}
});
