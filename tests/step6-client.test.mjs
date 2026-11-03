/**
 * Step 6 — client half checks (纯 Node，无 DOM 依赖).
 *
 * Two layers (same style as tests/step5-engine.test.mjs):
 *   1. 行为：用最小 window/document/localStorage/fetch 桩执行 store.js 片段，覆盖
 *      §3 迁移 / §4.1 apiRaw + 包注册表 + userCss/userFonts 走 state.ui / snapshot；
 *   2. 结构 + 纯函数：rows-packio.js 的预检/参数构造函数（import 三种来源、坏样本、
 *      CSS 预检、路径安全）与 §4.2 data 属性 / main.js `__dshteStep6` 守卫。
 *
 * 不 require DOM 库；不执行 build（Lead 做最终构建）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { precheckThemeCss } from "../src/shared/css-precheck.js";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, ROOT), "utf8");
const STORE_SOURCE = read("src/client/store.js");
const PACKIO_SOURCE = read("src/client/parts/rows-packio.js");
const ROWSPACK_SOURCE = read("src/client/parts/rows-pack.js");
const SETTINGS_SOURCE = read("src/client/parts/settings.js");
const MAIN_SOURCE = read("src/client/main.js");

/* ── 极简浏览器桩（与 Step 5 测试一致） ──────────────────────────────── */

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
			return { ok: false, status: result.status, json: async () => ({ ok: false, error: result.error || { message: "failed" } }) };
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

const V1_STATE = {
	format: "dshte.state",
	version: 1,
	activePackId: "cocreate-paper",
	enabled: true,
	schemePolicy: null,
	overrides: { light: {}, dark: {} }
};
const V2_STATE = {
	...V1_STATE,
	version: 2,
	ui: { previewLive: true, userCss: { text: "", savedAt: null }, userFonts: [] }
};
const FONT_ENTRY = {
	id: "u1234abcd",
	family: "dshte-user-u1234abcd",
	weight: 400,
	style: "normal",
	fileName: "a.woff2",
	mime: "font/woff2",
	dataUrl: "data:font/woff2;base64,AAAA",
	bytes: 3
};
const PACKS_LIST = {
	builtin: [{ id: "cocreate-paper", name: "CoCreate Paper", source: "builtin" }],
	user: [{ id: "my-pack", name: "My Pack", nameZh: "我的包", source: "user", bytes: 1200, fileCount: 2 }],
	counts: { builtin: 1, user: 1, trash: 0, total: 2 },
	limits: { packCount: 100, packBytes: 16777216, fileBytes: 8388608 }
};

/* ── 1. store.js — apiRaw + 包注册表 ───────────────────────────────────── */

test("store.apiRaw never throws and exposes code/message/details/status", async () => {
	const { store } = makeStore({
		fetchImpl: async (url, init) => {
			const request = JSON.parse(init.body);
			if (request.method === "packs.import") {
				return {
					ok: false,
					status: 400,
					json: async () => ({
						ok: false,
						error: {
							code: "needs-confirmation",
							message: "该包包含自定义 CSS（可影响整个界面），请确认来源可信后重试",
							details: [{ path: "files[\"theme.css\"]", code: "contains-custom-css", message: "包含 theme.css" }]
						}
					})
				};
			}
			return { ok: true, status: 200, json: async () => ({ ok: true, value: { hello: "world" } }) };
		}
	});
	assert.equal(typeof store.apiRaw, "function");
	const ok = await store.apiRaw("state.get");
	assert.equal(ok.ok, true);
	assert.equal(ok.status, 200);
	assert.deepEqual(ok.value, { hello: "world" });
	assert.equal(ok.error, null);

	const bad = await store.apiRaw("packs.import", { source: "bundle" });
	assert.equal(bad.ok, false);
	assert.equal(bad.status, 400);
	assert.equal(bad.error.code, "needs-confirmation");
	assert.equal(bad.error.details[0].path, "files[\"theme.css\"]");
	assert.match(bad.error.message, /自定义 CSS/);

	const network = makeStore({ fetchImpl: async () => { throw new Error("network down"); } }).store;
	const down = await network.apiRaw("state.get");
	assert.equal(down.ok, false);
	assert.equal(down.error.code, "network");
	assert.match(down.error.message, /network down/);

	await assert.rejects(store.api("packs.import", {}), /自定义 CSS/);
});

test("packs registry caches packs.list and exposes packs/packMeta/isBuiltin + snapshot", async () => {
	const { store } = makeStore({
		handler: (request) => (request.method === "packs.list" ? { value: PACKS_LIST } : { value: {} })
	});
	const before = store.packs();
	assert.deepEqual(before.builtin, []);
	const refreshed = await store.refreshPacks();
	assert.equal(refreshed.builtin.length, 1);
	assert.equal(refreshed.user.length, 1);
	assert.equal(refreshed.user[0].id, "my-pack");
	assert.equal(store.packs().user[0].nameZh, "我的包");
	assert.equal(store.packMeta("my-pack").name, "My Pack");
	assert.equal(store.packMeta("cocreate-paper").id, "cocreate-paper");
	assert.equal(store.packMeta("nope"), null);
	assert.equal(store.isBuiltin("cocreate-paper"), true);
	assert.equal(store.isBuiltin("my-pack"), false);
	const snapshot = store.snapshot();
	assert.equal(snapshot.packs.builtin[0].id, "cocreate-paper");
	assert.equal(snapshot.packs.user[0].id, "my-pack");
	assert.equal(snapshot.uiMigrated, false);
	assert.equal(snapshot.pendingImport, null);
	store.setPendingImport({ source: "bundle", phase: "upload" });
	assert.equal(store.snapshot().pendingImport.source, "bundle");
});

test("refreshTrash caches trash.list (and survives a failing host)", async () => {
	const { store } = makeStore({
		handler: (request) => (request.method === "trash.list"
			? { value: { entries: [{ trashId: "my-pack-20261103-071500-000", id: "my-pack", name: "My Pack", deletedAt: "2026-11-03T07:15:00.000Z", bytes: 10, fileCount: 2 }], count: 1 } }
			: { value: {} })
	});
	await store.refreshTrash();
	assert.equal(store.trash().count, 1);
	assert.equal(store.trash().entries[0].trashId, "my-pack-20261103-071500-000");
	assert.equal(store.snapshot().trash.entries.length, 1);

	const offline = makeStore({ fetchImpl: async () => { throw new Error("offline"); } }).store;
	await offline.refreshTrash();
	assert.equal(offline.trash().count, 0);
	assert.ok(offline.trash().error);
});

/* ── 2. store.js — schema v2 + Step 5 本地大 payload 迁移 ─────────────── */

test("hydrate accepts schema v1 and v2 (ui is validated, invalid ui is rejected)", () => {
	const v1 = makeStore().store;
	const one = v1.sanitizeState(V1_STATE);
	assert.equal(one.ok, true);
	assert.equal(one.state.version, 1);
	const two = v1.sanitizeState(V2_STATE);
	assert.equal(two.ok, true);
	assert.equal(two.state.version, 2);
	assert.equal(two.state.ui.previewLive, true);
	assert.equal(two.state.ui.userCss.text, "");
	const withFont = v1.sanitizeState({ ...V2_STATE, ui: { ...V2_STATE.ui, userFonts: [FONT_ENTRY] } });
	assert.equal(withFont.ok, true);
	assert.equal(withFont.state.ui.userFonts.length, 1);
	assert.equal(withFont.state.ui.userFonts[0].family, "dshte-user-u1234abcd");

	const badPreview = v1.sanitizeState({ ...V2_STATE, ui: { previewLive: "yes" } });
	assert.equal(badPreview.ok, false);
	assert.match(badPreview.error, /previewLive/);
	const badCss = v1.sanitizeState({ ...V2_STATE, ui: { userCss: { savedAt: null } } });
	assert.equal(badCss.ok, false);
	assert.match(badCss.error, /userCss/);
	const badFont = v1.sanitizeState({ ...V2_STATE, ui: { userFonts: [{ id: "x", bytes: 1, dataUrl: "nope" }] } });
	assert.equal(badFont.ok, false);
	assert.match(badFont.error, /dataUrl/);
	const badVersion = v1.sanitizeState({ ...V1_STATE, version: 3 });
	assert.equal(badVersion.ok, false);
	assert.match(badVersion.error, /1 或 2/);
});

test("first v2 connection migrates dshte:ui/userCss/userFonts into state.ui with includeUi:true", async () => {
	const localStorage = makeLocalStorage();
	localStorage.setItem("dshte:ui:v1", JSON.stringify({ previewLive: false }));
	localStorage.setItem("dshte:userCss:v1", JSON.stringify({ text: "body { color: #abc; }", savedAt: "2026-11-03T00:00:00.000Z" }));
	localStorage.setItem("dshte:userFonts:v1", JSON.stringify([FONT_ENTRY]));
	const { store, calls } = makeStore({
		localStorage,
		handler: (request) => {
			if (request.method === "state.get") return { value: V2_STATE };
			if (request.method === "packs.list") return { value: PACKS_LIST };
			if (request.method === "trash.list") return { value: { entries: [], count: 0 } };
			return { value: {} };
		}
	});
	await store.hydrate();
	await store.flush();
	const writes = calls.filter((call) => call.method === "state.set");
	assert.equal(writes.length, 1, "migration must trigger exactly one state write");
	assert.equal(writes[0].args.includeUi, true, "migration write must carry includeUi:true");
	assert.equal(writes[0].args.state.version, 2);
	assert.equal(writes[0].args.state.ui.previewLive, false);
	assert.equal(writes[0].args.state.ui.userCss.text, "body { color: #abc; }");
	assert.equal(writes[0].args.state.ui.userFonts.length, 1);
	assert.equal(writes[0].args.state.ui.userFonts[0].fileName, "a.woff2");

	// Big payload keys are gone; the small previewLive seed stays.
	assert.equal(localStorage.getItem("dshte:userCss:v1"), null);
	assert.equal(localStorage.getItem("dshte:userFonts:v1"), null);
	assert.equal(JSON.parse(localStorage.getItem("dshte:ui:v1")).previewLive, false);
	assert.equal(store.snapshot().uiMigrated, true);
	assert.equal(store.snapshot().host.schemaVersion, 2);
	assert.equal(store.hostStatus().uiMigrated, true);

	// A second hydrate must not migrate again (no extra includeUi write).
	const before = calls.length;
	await store.hydrate();
	await store.flush();
	const secondWrites = calls.slice(before).filter((call) => call.method === "state.set" && call.args.includeUi === true);
	assert.equal(secondWrites.length, 0, "migration happens exactly once");
});

test("ordinary overrides writes stay small (no includeUi); ui writes carry includeUi:true", async () => {
	const calls = [];
	const { store } = makeStore({
		calls,
		handler: (request) => {
			if (request.method === "state.get") return { value: V2_STATE };
			if (request.method === "packs.list") return { value: PACKS_LIST };
			if (request.method === "trash.list") return { value: { entries: [], count: 0 } };
			return { value: {} };
		}
	});
	await store.hydrate();
	await store.flush();
	calls.length = 0;

	store.set({ overrides: { light: { "--dsw-alias-bg-base": "#112233" }, dark: {} } }, { reason: "overrides" });
	await store.flush();
	let writes = calls.filter((call) => call.method === "state.set");
	assert.equal(writes.length, 1);
	assert.equal(writes[0].args.includeUi, undefined, "普通 overrides 写入不得带 includeUi");
	calls.length = 0;

	store.setCustomCss("body { color: red; }");
	assert.match(store.getCustomCss().savedAt, /^\d{4}-\d{2}-\d{2}T/);
	await store.flush();
	writes = calls.filter((call) => call.method === "state.set");
	assert.equal(writes.length, 1);
	assert.equal(writes[writes.length - 1].args.includeUi, true, "userCss 变更必须 includeUi:true");
	assert.equal(writes[writes.length - 1].args.state.ui.userCss.text, "body { color: red; }");
	calls.length = 0;

	store.setUi({ previewLive: false });
	assert.equal(store.getUi().previewLive, false);
	await store.flush();
	writes = calls.filter((call) => call.method === "state.set");
	assert.equal(writes[writes.length - 1].args.includeUi, true);
	assert.equal(writes[writes.length - 1].args.state.ui.previewLive, false);
	calls.length = 0;

	store.setCustomCss("");
	await store.flush();
	writes = calls.filter((call) => call.method === "state.set");
	assert.equal(writes[writes.length - 1].args.state.ui.userCss.text, "");
});

test("userFonts writes then persists through state.ui on a v2 host", async () => {
	const calls = [];
	const documentStubFonts = {
		fonts: { add() {}, delete() { return true; }, load: async () => [], check: () => true },
		body: null
	};
	const localStorage = makeLocalStorage();
	const fetchImpl = async (url, init) => {
		const request = JSON.parse(init.body);
		calls.push(request);
		if (request.method === "state.get") return { ok: true, status: 200, json: async () => ({ ok: true, value: V2_STATE }) };
		if (request.method === "packs.list") return { ok: true, status: 200, json: async () => ({ ok: true, value: PACKS_LIST }) };
		if (request.method === "trash.list") return { ok: true, status: 200, json: async () => ({ ok: true, value: { entries: [], count: 0 } }) };
		return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) };
	};
	const factory = new Function("TAG", "log", "window", "document", "fetch", `${STORE_SOURCE}\nreturn createStateStore;`);
	const store = factory("[test]", () => {}, { localStorage, FontFace: undefined }, documentStubFonts, fetchImpl)();
	await store.hydrate();
	await store.flush();
	calls.length = 0;

	// No FontFace in the stub → the add is rejected; the remove path is exercised
	// through a state that already carries a font.
	const hydrated = makeStore({
		localStorage,
		handler: (request) => {
			if (request.method === "state.get") return { value: { ...V2_STATE, ui: { ...V2_STATE.ui, userFonts: [FONT_ENTRY] } } };
			if (request.method === "packs.list") return { value: PACKS_LIST };
			if (request.method === "trash.list") return { value: { entries: [], count: 0 } };
			return { value: {} };
		}
	});
	await hydrated.store.hydrate();
	await hydrated.store.flush();
	assert.equal(hydrated.store.userFonts.list().length, 1);
	hydrated.calls.length = 0;
	const removed = hydrated.store.userFonts.remove(FONT_ENTRY.id);
	assert.equal(removed, true);
	assert.equal(hydrated.store.userFonts.list().length, 0);
	await hydrated.store.flush();
	const writes = hydrated.calls.filter((call) => call.method === "state.set");
	assert.equal(writes[writes.length - 1].args.includeUi, true);
	assert.equal(writes[writes.length - 1].args.state.ui.userFonts.length, 0);
});

test("v1 host keeps the Step 5 big local payload and does NOT declare uiMigrated", async () => {
	const localStorage = makeLocalStorage();
	const { store, calls } = makeStore({
		localStorage,
		handler: (request) => {
			if (request.method === "state.get") return { value: V1_STATE };
			if (request.method === "packs.list") return { value: PACKS_LIST };
			if (request.method === "trash.list") return { value: { entries: [], count: 0 } };
			return { value: {} };
		}
	});
	await store.hydrate();
	assert.equal(store.hostStatus().schemaVersion, 1);
	assert.equal(store.snapshot().uiMigrated, false);
	store.setCustomCss("body { color: #999; }");
	assert.notEqual(localStorage.getItem("dshte:userCss:v1"), null);
	assert.equal(JSON.parse(localStorage.getItem("dshte:userCss:v1")).text, "body { color: #999; }");
	await store.flush();
	assert.equal(calls.filter((call) => call.method === "state.set" && call.args.includeUi === true).length, 0);
});

/* ── 3. rows-packio.js 纯函数（预检 / 参数构造） ──────────────────────── */

const PURE_MARKER = "/* ── browser file helpers";
const PURE_SLICE = PACKIO_SOURCE.slice(0, PACKIO_SOURCE.indexOf(PURE_MARKER));
const packio = new Function(
	"precheckThemeCss",
	"uiBytesToBase64",
	`${PURE_SLICE}\nreturn { ioLimitsFromCaps, ioTextBytes, ioIsSafePackPath, ioDetectJsonKind, ioPrecheckBundle, ioPrecheckDreamskin, ioPrecheckFolder, ioBuildImportArgs, ioCollisionText, ioTextToBase64 };`
)(precheckThemeCss, undefined);

const MINIMAL_PACK = {
	format: "dshte.theme",
	formatVersion: 1,
	id: "cocreate-paper",
	name: "CoCreate Paper",
	nameZh: "共创纸",
	release: "1.0.0",
	colorScheme: "light",
	tokens: { light: {}, dark: {} }
};

test("ioLimitsFromCaps falls back to the contract constants and honours diag.caps", () => {
	const fallback = packio.ioLimitsFromCaps(null);
	assert.equal(fallback.packMaxBytes, 16 * 1024 * 1024);
	assert.equal(fallback.fileMaxBytes, 8 * 1024 * 1024);
	assert.equal(fallback.fileCountMax, 200);
	assert.equal(fallback.bundleMaxBytes, 24 * 1024 * 1024);
	const capped = packio.ioLimitsFromCaps({ packMaxBytes: 123, fileMaxBytes: 456, importMaxBundleBytes: 789, packCountMax: 3 });
	assert.equal(capped.packMaxBytes, 123);
	assert.equal(capped.fileMaxBytes, 456);
	assert.equal(capped.bundleMaxBytes, 789);
	assert.equal(capped.fileCountMax, 200);
});

test("ioDetectJsonKind recognises the three supported sources and rejects garbage", () => {
	assert.equal(packio.ioDetectJsonKind(JSON.stringify({ format: "dshte.bundle", formatVersion: 1, pack: MINIMAL_PACK, files: {} }), "x.dshte.json").kind, "bundle");
	assert.equal(packio.ioDetectJsonKind(JSON.stringify({ format: "dsh-dream-skin/pack", version: 1, manifest: {} }), "x.json").kind, "dreamskin");
	assert.equal(packio.ioDetectJsonKind(JSON.stringify(MINIMAL_PACK), "theme.json").kind, "theme");
	const truncated = packio.ioDetectJsonKind('{"format":"dshte.bundle"', "broken.dshte.json");
	assert.equal(truncated.ok, false);
	assert.match(truncated.errors[0].message, /JSON 解析失败/);
	const unknown = packio.ioDetectJsonKind(JSON.stringify({ format: "something-else" }), "x.json");
	assert.equal(unknown.ok, false);
	assert.match(unknown.errors[0].message, /无法识别的文件格式/);
});

test("ioPrecheckBundle accepts a valid bundle and reports CSS presence", () => {
	const bundle = {
		format: "dshte.bundle",
		formatVersion: 1,
		pack: MINIMAL_PACK,
		files: {
			"theme.css": ".dshte-card { color: var(--dsw-alias-label-primary); }",
			"assets/images/x.png": "data:image/png;base64,AAAA"
		}
	};
	const result = packio.ioPrecheckBundle(bundle);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.cssPresent, true);
	assert.equal(result.info.id, "cocreate-paper");
	assert.equal(result.info.fileCount, 2);
	assert.equal(result.info.assetCount, 1);
});

test("ioPrecheckBundle rejects the Step 6 bad samples without touching disk", () => {
	const badVersion = packio.ioPrecheckBundle({ format: "dshte.bundle", formatVersion: 2, pack: MINIMAL_PACK, files: {} });
	assert.equal(badVersion.ok, false);
	assert.ok(badVersion.errors.some((issue) => issue.path === "formatVersion"));

	const traversal = packio.ioPrecheckBundle({
		format: "dshte.bundle",
		formatVersion: 1,
		pack: MINIMAL_PACK,
		files: { "../evil.png": "data:image/png;base64,AAAA" }
	});
	assert.equal(traversal.ok, false);
	assert.ok(traversal.errors.some((issue) => /路径不安全/.test(issue.message)));

	const absolute = packio.ioPrecheckBundle({
		format: "dshte.bundle",
		formatVersion: 1,
		pack: MINIMAL_PACK,
		files: { "/etc/passwd": "data:text/plain;base64,AAAA" }
	});
	assert.equal(absolute.ok, false);
	assert.ok(absolute.errors.some((issue) => /路径不安全/.test(issue.message)));

	const badCss = packio.ioPrecheckBundle({
		format: "dshte.bundle",
		formatVersion: 1,
		pack: MINIMAL_PACK,
		files: { "theme.css": ".x { grid-template-columns: 1fr 1fr; }" }
	});
	assert.equal(badCss.ok, false);
	assert.ok(badCss.errors.some((issue) => /布局属性/.test(issue.message)));

	const missingPack = packio.ioPrecheckBundle({ format: "dshte.bundle", formatVersion: 1, files: {} });
	assert.equal(missingPack.ok, false);
	assert.ok(missingPack.errors.some((issue) => issue.path === "pack"));

	const tooManyFiles = { format: "dshte.bundle", formatVersion: 1, pack: MINIMAL_PACK, files: {} };
	for (let index = 0; index < 201; index += 1) tooManyFiles.files[`assets/a${index}.png`] = "data:image/png;base64,AAAA";
	const many = packio.ioPrecheckBundle(tooManyFiles);
	assert.equal(many.ok, false);
	assert.ok(many.errors.some((issue) => /超过上限 200/.test(issue.message)));
});

test("ioPrecheckBundle enforces the 16 MB / 8 MB decoded size limits", () => {
	const huge = { format: "dshte.bundle", formatVersion: 1, pack: MINIMAL_PACK, files: { "assets/big.png": "data:image/png;base64," + "A".repeat(11 * 1024 * 1024) } };
	const result = packio.ioPrecheckBundle(huge);
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((issue) => /8 MB/.test(issue.message) || /16 MB/.test(issue.message)));
});

test("ioPrecheckDreamskin accepts the minimal pack and rejects missing manifest fields", () => {
	const good = {
		format: "dsh-dream-skin/pack",
		version: 1,
		manifest: { id: "demo-min", name: "Demo Minimal", colorScheme: "dark", tokens: { "--dsw-alias-bg-base": "#101010" } }
	};
	const ok = packio.ioPrecheckDreamskin(good);
	assert.equal(ok.ok, true, JSON.stringify(ok.errors));
	assert.equal(ok.info.id, "demo-min");
	assert.equal(ok.info.tokenCount, 1);
	assert.equal(ok.cssPresent, false);

	const missingTokens = packio.ioPrecheckDreamskin({ format: "dsh-dream-skin/pack", version: 1, manifest: { id: "x", name: "X", colorScheme: "dark" } });
	assert.equal(missingTokens.ok, false);
	assert.ok(missingTokens.errors.some((issue) => issue.path === "manifest.tokens"));
	const badVersion = packio.ioPrecheckDreamskin({ format: "dsh-dream-skin/pack", version: 2, manifest: good.manifest });
	assert.equal(badVersion.ok, false);
	assert.ok(badVersion.errors.some((issue) => issue.path === "version"));
});

test("ioPrecheckFolder needs theme.json, runs CSS precheck and rejects traversal", () => {
	const missing = packio.ioPrecheckFolder([{ path: "theme.css", size: 10, text: "a { color: red; }" }]);
	assert.equal(missing.ok, false);
	assert.ok(missing.errors.some((issue) => /theme\.json/.test(issue.message)));

	const good = packio.ioPrecheckFolder([
		{ path: "theme.json", size: 100, text: JSON.stringify(MINIMAL_PACK) },
		{ path: "theme.css", size: 40, text: ".a { color: red; }" },
		{ path: "assets/images/x.png", size: 4 }
	]);
	assert.equal(good.ok, true, JSON.stringify(good.errors));
	assert.equal(good.cssPresent, true);
	assert.equal(good.info.id, "cocreate-paper");
	assert.equal(good.info.fileCount, 3);
	assert.equal(good.info.assetCount, 1);

	const traversal = packio.ioPrecheckFolder([{ path: "theme.json", size: 100, text: JSON.stringify(MINIMAL_PACK) }, { path: "../x", size: 1 }]);
	assert.equal(traversal.ok, false);
	assert.ok(traversal.errors.some((issue) => /路径不安全/.test(issue.message)));

	const brokenJson = packio.ioPrecheckFolder([{ path: "theme.json", size: 5, text: "{oops" }]);
	assert.equal(brokenJson.ok, false);
	assert.ok(brokenJson.errors.some((issue) => /JSON 解析失败/.test(issue.message)));

	const tooBig = packio.ioPrecheckFolder([{ path: "theme.json", size: 100, text: JSON.stringify(MINIMAL_PACK) }, { path: "assets/big.bin", size: 9 * 1024 * 1024 }]);
	assert.equal(tooBig.ok, false);
	assert.ok(tooBig.errors.some((issue) => /8 MB/.test(issue.message)));
});

test("ioBuildImportArgs maps the three contract sources exactly", () => {
	const parsed = { format: "dshte.bundle", formatVersion: 1, pack: MINIMAL_PACK, files: {} };
	assert.deepEqual(packio.ioBuildImportArgs({ source: "bundle", parsed }, "rename", false), { source: "bundle", collision: "rename", bundle: parsed });
	assert.deepEqual(packio.ioBuildImportArgs({ source: "folder", filesB64: { "theme.json": "e30=" } }, "overwrite", true), {
		source: "folder",
		collision: "overwrite",
		confirmCustomCss: true,
		files: { "theme.json": "e30=" }
	});
	assert.deepEqual(packio.ioBuildImportArgs({ source: "dreamskin", parsed: { format: "dsh-dream-skin/pack" } }, "reject"), {
		source: "dreamskin",
		collision: "reject",
		json: { format: "dsh-dream-skin/pack" }
	});
	assert.throws(() => packio.ioBuildImportArgs({ source: "nope" }, "rename"), /未知导入来源/);
	assert.equal(packio.ioBuildImportArgs({ source: "bundle", parsed }, "bogus").collision, "rename");
});

test("ioIsSafePackPath / ioTextToBase64 / ioCollisionText behave", () => {
	assert.equal(packio.ioIsSafePackPath("theme.json"), true);
	assert.equal(packio.ioIsSafePackPath("assets/images/x.png"), true);
	assert.equal(packio.ioIsSafePackPath("../x"), false);
	assert.equal(packio.ioIsSafePackPath("/etc/passwd"), false);
	assert.equal(packio.ioIsSafePackPath("a\\b"), false);
	assert.equal(packio.ioIsSafePackPath("a//b"), false);
	assert.equal(packio.ioIsSafePackPath(""), false);
	assert.equal(packio.ioTextToBase64("{}"), "e30=");
	assert.equal(packio.ioCollisionText("renamed"), "同名已存在，已自动改名");
	assert.equal(packio.ioCollisionText("overwritten"), "已覆盖同名用户包（旧包在回收站，可恢复）");
	assert.equal(packio.ioCollisionText("none"), "无冲突");
});

/* ── 4. 结构守卫：§4.2 data 属性 / main.js / include 顺序 ─────────────── */

test("rows-packio.js stays a classic-script fragment (no import/export/require)", () => {
	for (const [name, source] of [["store.js", STORE_SOURCE], ["rows-packio.js", PACKIO_SOURCE], ["rows-pack.js", ROWSPACK_SOURCE], ["settings.js", SETTINGS_SOURCE]]) {
		assert.equal(/^\s*(import|export)\s/m.test(source), false, `${name} must not use import/export`);
		assert.equal(/\brequire\s*\(/.test(source), false, `${name} must not require()`);
	}
});

test("contract §4.2 import/export/manage data attributes all exist", () => {
	const combined = [PACKIO_SOURCE, ROWSPACK_SOURCE, SETTINGS_SOURCE, read("src/client/parts/ui-kit.js")].join("\n");
	const literals = [
		'"data-dshte-drop": "import"',
		'"data-dshte-file": "import"',
		'"data-dshte-dir": "import"',
		'"data-dshte-import-progress": ""',
		'"data-dshte-import-confirm": ""',
		'"data-dshte-action": "import-confirm"',
		'"data-dshte-action": "import-cancel"',
		'"data-dshte-import-result": ""',
		'"data-imported-id"',
		'"data-import-collision"',
		'"data-import-source"',
		'"data-dshte-import-report": ""',
		'"data-dshte-action": "export"',
		'"data-dshte-export-info": ""',
		'"data-dshte-action": "delete-pack"',
		'"data-dshte-trash": ""',
		'"data-dshte-trash-entry"',
		'"data-dshte-action": "trash-restore"',
		'"data-dshte-action": "trash-purge"',
		'"data-dshte-action": "packs-refresh"'
	];
	for (const literal of literals) assert.ok(combined.includes(literal), `missing ${literal}`);
	assert.ok(combined.includes('"data-dshte-pack": id'), "builtin pack card must carry data-dshte-pack");
	assert.ok(combined.includes('"data-dshte-pack-source": "builtin"'), "builtin pack card must carry data-dshte-pack-source=builtin");
	assert.ok(combined.includes('"data-dshte-pack-source": "user"'), "user pack card must carry data-dshte-pack-source=user");
	assert.ok(combined.includes('"data-dshte-row": props.rowId'), "UICard must render data-dshte-row from rowId");
	for (const rowId of ['rowId: "import"', 'rowId: "export"', 'rowId: "manage"']) assert.ok(PACKIO_SOURCE.includes(rowId), `missing ${rowId}`);
	assert.ok(PACKIO_SOURCE.includes('role: "progressbar"'));
	assert.ok(PACKIO_SOURCE.includes('"aria-valuenow"'));
	assert.ok(PACKIO_SOURCE.includes('"aria-valuetext"'));
	assert.ok(PACKIO_SOURCE.includes("读取 "));
	assert.ok(PACKIO_SOURCE.includes("上传 "));
	assert.ok(PACKIO_SOURCE.includes("校验"));
});

test("rows-pack.js row 1 renders builtin + user packs through the store registry", () => {
	assert.ok(ROWSPACK_SOURCE.includes("packs.user"));
	assert.ok(ROWSPACK_SOURCE.includes('"data-dshte-pack-source": "builtin"'));
	assert.ok(ROWSPACK_SOURCE.includes('"data-dshte-pack-source": "user"'));
	assert.ok(ROWSPACK_SOURCE.includes("ctx.actions.activatePack(meta.id)"));
	assert.ok(ROWSPACK_SOURCE.includes('"data-dshte-action": "packs-refresh"'));
	assert.ok(ROWSPACK_SOURCE.includes("aria-pressed"));
});

test("main.js includes rows-packio before settings and exposes window.__dshteStep6", () => {
	const factory = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('const React = require("react")'));
	const includePackio = factory.indexOf("// @include ./parts/rows-packio.js");
	const includeSettings = factory.indexOf("// @include ./parts/settings.js");
	assert.ok(includePackio > 0, "rows-packio.js include missing");
	assert.ok(includeSettings > includePackio, "rows-packio.js must be included before settings.js");
	assert.ok(MAIN_SOURCE.includes("window.__dshteStep6"));
	assert.ok(MAIN_SOURCE.includes("packs: () => store.packs()"));
	assert.ok(MAIN_SOURCE.includes("refreshPacks: async () => {"));
	assert.ok(MAIN_SOURCE.includes("step: 6"));
	assert.ok(MAIN_SOURCE.includes("window.__dshteStep5"), "the Step 5 surface must stay for older acceptance");
});

test("settings.js wires packs/trash into the shared ctx and marks the page as step 7", () => {
	assert.ok(SETTINGS_SOURCE.includes('"data-dshte-page": "step7"'));
	assert.ok(SETTINGS_SOURCE.includes('"data-dshte-step": "7"'));
	assert.ok(SETTINGS_SOURCE.includes("packs,"));
	assert.ok(SETTINGS_SOURCE.includes("trash,"));
	assert.ok(SETTINGS_SOURCE.includes("refreshPacks: async () => {"));
	assert.ok(SETTINGS_SOURCE.includes("refreshTrash: async () => {"));
	assert.ok(SETTINGS_SOURCE.includes('h(RowImport, { ctx })'));
	assert.ok(SETTINGS_SOURCE.includes('h(RowExport, { ctx })'));
	assert.ok(SETTINGS_SOURCE.includes('h(RowManage, { ctx })'));
});

test("store.js exposes the Step 6 surface and no longer writes big payloads to the state seed", () => {
	for (const needle of ["apiRaw", "refreshPacks", "packMeta", "isBuiltin", "refreshTrash", "setPendingImport", "migrateLocalUi", "includeUi", "uiMigrated", "stateSeed", "hostV2"]) {
		assert.ok(STORE_SOURCE.includes(needle), `store.js missing ${needle}`);
	}
	assert.ok(STORE_SOURCE.includes("includeUi: true"), "ui writes must request includeUi:true");
	// The seed keeps only small fields (overrides + active pack), never state.ui.
	const seedStart = STORE_SOURCE.indexOf("function stateSeed()");
	assert.ok(seedStart > 0, "stateSeed missing");
	const seedEnd = STORE_SOURCE.indexOf("function persistState()", seedStart);
	const seedBody = STORE_SOURCE.slice(seedStart, seedEnd);
	assert.equal(/\bui\b|userFonts|userCss|dataUrl/.test(seedBody), false, "stateSeed must not persist ui/userFonts/userCss");
});

/* ── 5. 无 DOM 的渲染冒烟：用极小 React/UI 桩渲染 rows 4/5/6 ──────────── */

function renderSmoke() {
	const reactStub = `
		function __flatten(list) {
			const out = [];
			for (const item of list) {
				if (Array.isArray(item)) out.push(...__flatten(item));
				else if (item !== null && item !== undefined && item !== false && item !== true) out.push(item);
			}
			return out;
		}
		function __el(type, props, children) {
			const rest = {};
			if (props && typeof props === "object") {
				for (const key of Object.keys(props)) {
					if (key === "children") continue;
					rest[key] = props[key];
				}
			}
			return { type, props: rest, children: __flatten(children) };
		}
		const React = {
			createElement: (type, props, ...children) => __el(type, props, children),
			useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
			useRef: (initial) => ({ current: initial }),
			useEffect: () => {},
			useMemo: (factory) => factory(),
			useCallback: (factory) => factory
		};
		const UI_COLOR = { text: "", textSecondary: "", textTertiary: "", border: "", borderStrong: "", brand: "", brandText: "", danger: "", dangerBg: "", ok: "", okBg: "", warn: "", warnBg: "", surface: "", surface2: "", layer3: "", mono: "" };
		const UI_STYLE = { card: {}, titleRow: {}, title: {}, titleActions: {}, note: {}, hint: {}, row: {}, rowStack: {}, subcard: {}, subtitle: {}, confirm: {}, confirmText: {}, drop: {}, dropActive: {}, badge: {}, badgeOk: {}, badgeWarn: {}, select: {}, packCard: {}, packCardActive: {}, warnText: {}, error: {}, okText: {}, label: {}, controls: {} };
		function uiStyle() { const out = {}; for (const part of arguments) { if (part && typeof part === "object") Object.assign(out, part); } return out; }
		function uiFormatBytes(bytes) { const value = Number(bytes); return Number.isFinite(value) ? value + " B" : "?"; }
		function __stub(tag, extra) {
			return function Stub(props) {
				const rest = {};
				for (const key of Object.keys(props || {})) { if (key !== "children") rest[key] = props[key]; }
				return React.createElement(tag, { ...rest, ...(extra || {}), "data-stub": tag }, props && props.children);
			};
		}
		const UIBadge = __stub("span", { "data-dshte-badge": "" });
		const UIMono = __stub("code");
		const UINote = __stub("div", { "data-dshte-note": "" });
		const UIGrid = __stub("div");
		const UIError = __stub("span", { "data-dshte-error": "" });
		const UIStatus = __stub("span", { role: "status" });
		function UIButton(props) {
			const rest = {};
			for (const key of Object.keys(props || {})) { if (key !== "children") rest[key] = props[key]; }
			return React.createElement("button", rest, props && props.children);
		}
		function UICard(props) {
			const rest = {};
			for (const key of Object.keys(props || {})) { if (key !== "children" && key !== "rowId" && key !== "actions") rest[key] = props[key]; }
			return React.createElement("section", { ...rest, "data-dshte-row": props && props.rowId }, [props && props.actions, props && props.children]);
		}
		const BUILTIN_PACKS = { "cocreate-paper": { pack: { name: "CoCreate Paper", nameZh: "共创纸", release: "1.0.0", colorScheme: "light" }, css: ".x { color: red; }" } };
	`;
	const factory = new Function("precheckThemeCss", `${reactStub}\n${PACKIO_SOURCE}\nreturn { RowImport, RowExport, RowManage };`);
	return factory(precheckThemeCss);
}

function walkRender(node, out = []) {
	if (node === null || node === undefined) return out;
	if (Array.isArray(node)) {
		for (const child of node) walkRender(child, out);
		return out;
	}
	if (typeof node === "object") {
		if (node.props && typeof node.props === "object") {
			out.push(node);
			// `actions` is an array of elements carried in props (UICard API).
			if (Array.isArray(node.props.actions)) walkRender(node.props.actions, out);
		}
		for (const child of node.children || []) walkRender(child, out);
	}
	return out;
}

function attrsOf(nodes) {
	return nodes.map((node) => node.props || {});
}

test("row 4/5/6 render without DOM and emit every required §4.2 hook", () => {
	const { RowImport, RowExport, RowManage } = renderSmoke();
	const noop = () => {};
	const actions = { setStatus: noop, refreshPacks: async () => null, refreshTrash: async () => null, resetDefault: () => ({ ok: true }) };
	const storeStub = {
		apiRaw: async () => ({ ok: false, status: 0, value: null, error: { code: "network", message: "stub", details: [] } }),
		api: async () => ({}),
		packs: () => ({ builtin: [], user: [] }),
		trash: () => ({ entries: [], count: 0, at: null }),
		packMeta: () => null,
		isBuiltin: () => true
	};

	const importTree = walkRender(RowImport({ ctx: { store: storeStub, actions, state: {}, packs: { builtin: [], user: [] }, trash: { entries: [], count: 0 } } }));
	const importAttrs = attrsOf(importTree);
	assert.ok(importAttrs.some((props) => props["data-dshte-drop"] === "import"), "missing drop zone");
	assert.ok(importAttrs.some((props) => props["data-dshte-file"] === "import"), "missing single-file input");
	assert.ok(importAttrs.some((props) => props["data-dshte-dir"] === "import"), "missing directory input");
	const progress = importAttrs.find((props) => props["data-dshte-import-progress"] !== undefined);
	assert.ok(progress, "missing import progress");
	assert.equal(progress.role, "progressbar");
	assert.equal(typeof progress["aria-valuenow"], "number");
	assert.ok(progress["aria-valuenow"] >= 0 && progress["aria-valuenow"] <= 100);
	assert.match(String(progress["aria-valuetext"] || ""), /等待|读取|上传|校验|完成/);
	const importResult = importAttrs.find((props) => props["data-dshte-import-result"] !== undefined);
	assert.ok(importResult, "missing import result container");
	assert.equal(importResult["data-imported-id"], undefined, "no id before an import");

	const exportTree = walkRender(RowExport({ ctx: { store: storeStub, actions, state: { activePackId: "cocreate-paper" } } }));
	const exportAttrs = attrsOf(exportTree);
	assert.ok(exportAttrs.some((props) => props["data-dshte-action"] === "export"), "missing export button");
	assert.ok(exportAttrs.some((props) => props["data-dshte-export-info"] !== undefined), "missing export info");

	const manageTree = walkRender(RowManage({
		ctx: {
			store: {
				...storeStub,
				trash: () => ({ entries: [{ trashId: "my-pack-20261103-071500-000", id: "my-pack", name: "My", deletedAt: "2026-11-03T07:15:00.000Z", bytes: 10, fileCount: 2 }], count: 1, at: "x" }),
				packs: () => ({ builtin: [], user: [{ id: "my-pack", name: "My Pack", source: "user" }] })
			},
			actions,
			state: { activePackId: "cocreate-paper" },
			packs: { builtin: [], user: [{ id: "my-pack", name: "My Pack", source: "user" }] },
			trash: { entries: [{ trashId: "my-pack-20261103-071500-000", id: "my-pack", name: "My", deletedAt: "2026-11-03T07:15:00.000Z", bytes: 10, fileCount: 2 }], count: 1 }
		}
	}));
	const manageAttrs = attrsOf(manageTree);
	assert.ok(manageAttrs.some((props) => props["data-dshte-trash"] !== undefined), "missing trash container");
	assert.ok(manageAttrs.some((props) => props["data-dshte-trash-entry"] === "my-pack-20261103-071500-000"), "missing trash entry");
	assert.ok(manageAttrs.some((props) => props["data-dshte-action"] === "trash-restore"), "missing restore button");
	assert.ok(manageAttrs.some((props) => props["data-dshte-action"] === "trash-purge"), "missing purge button");
	const deleteButtons = manageAttrs.filter((props) => props["data-dshte-action"] === "delete-pack");
	assert.ok(deleteButtons.length >= 1, "missing delete buttons");
	const builtinDelete = deleteButtons.find((props) => props["data-dshte-pack-id"] === "cocreate-paper");
	assert.ok(builtinDelete, "builtin delete button missing");
	assert.equal(builtinDelete.disabled, true, "builtin delete must be disabled");
	const userDelete = deleteButtons.find((props) => props["data-dshte-pack-id"] === "my-pack");
	assert.ok(userDelete, "user delete button missing");
	assert.equal(userDelete.disabled, false, "user delete must be enabled");
	assert.ok(manageAttrs.some((props) => props["data-dshte-action"] === "packs-refresh"), "missing packs-refresh");
});

/* ── 6. 回归守卫：隐藏 input 是活 FileList，必须先快照再清空 value ─────── */

test("import inputs snapshot event.target.files BEFORE clearing value (live FileList bug)", () => {
	// Regression for the acceptance-found bug: `input.files` is a LIVE FileList.
	// `const files = event.target.files; event.target.value = ""` reads back empty.
	assert.equal(PACKIO_SOURCE.includes("const files = event.target.files;"), false, "stored live FileList reference");
	const snapshots = PACKIO_SOURCE.match(/const files = Array\.from\(event\.target\.files \|\| \[\]\);/g) || [];
	assert.equal(snapshots.length, 2, "both hidden inputs must snapshot files before value=''");
	const handlers = PACKIO_SOURCE.split("onChange: (event) => {").slice(1).filter((block) => block.includes('event.target.value = ""'));
	assert.equal(handlers.length, 2, "expected exactly two file-input onChange handlers");
	for (const block of handlers) {
		const snapshotAt = block.indexOf("Array.from(event.target.files");
		const clearAt = block.indexOf('event.target.value = ""');
		assert.ok(snapshotAt >= 0, "missing Array.from snapshot");
		assert.ok(clearAt > snapshotAt, "snapshot must happen before value=''");
	}
});

test("single-file input change still imports after value='' clears a live FileList", async () => {
	const { RowImport } = renderSmoke();
	const importCalls = [];
	const store = {
		apiRaw: async (method, args) => {
			if (method === "packs.import") {
				importCalls.push(args);
				return { ok: true, status: 200, value: { id: "cocreate-paper", collision: "none", source: "bundle", pack: {}, stats: { bytes: 120, fileCount: 1 }, warnings: [], report: null } };
			}
			return { ok: false, status: 0, value: null, error: { code: "network", message: "stub", details: [] } };
		},
		refreshPacks: async () => ({}),
		refreshTrash: async () => ({}),
		setPendingImport: () => null,
		packs: () => ({ builtin: [], user: [] }),
		trash: () => ({ entries: [], count: 0, at: null }),
		packMeta: () => null,
		isBuiltin: () => true
	};
	const ctx = {
		store,
		actions: { setStatus: () => {}, refreshPacks: async () => null, refreshTrash: async () => null },
		state: {},
		packs: { builtin: [], user: [] },
		trash: { entries: [], count: 0 }
	};
	const tree = walkRender(RowImport({ ctx }));
	const input = attrsOf(tree).find((props) => props["data-dshte-file"] === "import");
	assert.ok(input && typeof input.onChange === "function", "single-file input onChange missing");

	const bundle = { format: "dshte.bundle", formatVersion: 1, pack: MINIMAL_PACK, files: {} };
	const fakeFile = { name: "cocreate-paper.dshte.json", size: 120, text: async () => JSON.stringify(bundle) };
	// Simulate a LIVE FileList: clearing input.value empties the very same array.
	const liveList = [fakeFile];
	const target = {
		get files() { return liveList; },
		get value() { return liveList.length > 0 ? "C:\\fakepath\\cocreate-paper.dshte.json" : ""; },
		set value(next) { if (next === "") liveList.length = 0; }
	};
	input.onChange({ target });
	assert.equal(liveList.length, 0, "value='' must clear the live list");
	await new Promise((resolve) => setTimeout(resolve, 300));

	assert.equal(importCalls.length, 1, "the import request must still be sent after the list is cleared");
	assert.equal(importCalls[0].source, "bundle");
	assert.equal(importCalls[0].bundle.pack.id, MINIMAL_PACK.id);
	assert.equal(importCalls[0].collision, "rename");
});
