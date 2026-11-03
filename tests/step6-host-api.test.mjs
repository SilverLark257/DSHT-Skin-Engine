/**
 * Step 6 宿主侧：POST /dsh-tavern-skin/api 的路由/传输层（lib/host/api.js）。
 *
 * 覆盖：方法分发、扁平 state.get/set（includeUi 语义）、传输上限 413 可读 JSON、
 * 鉴权围栏（loopback / trustedHosts / session）、请求体错误。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	MAX_BODY_BYTES,
	createApiHandler,
	dispatch
} from "../lib/host/api.js";
import { diagCaps, importPack } from "../lib/host/packs-io.js";
import { readState } from "../lib/host/store.js";
import {
	TRUSTED_HEADERS,
	callHandler,
	folderFiles,
	makeApiContext,
	makeTempHome
} from "./fixtures/step6/helpers.mjs";

const trustedContext = (options = {}) => makeApiContext({ trustedHosts: ["127.0.0.1:56963"], ...options });

const uiPayload = () => ({
	previewLive: false,
	userCss: { text: "body { --dshte-test: 1; }", savedAt: null },
	userFonts: []
});

const statePayload = (overrides = {}) => ({
	format: "dshte.state",
	version: 2,
	activePackId: "cocreate-paper",
	enabled: true,
	schemePolicy: null,
	overrides: { light: {}, dark: {} },
	ui: uiPayload(),
	...overrides
});

test("dispatch：diag.caps 键与值严格按契约", async () => {
	const result = await dispatch(null, { method: "diag.caps" });
	assert.equal(result.status, 200);
	assert.equal(result.value.ok, true);
	assert.deepEqual(result.value.value, diagCaps());
	assert.deepEqual(Object.keys(result.value.value).sort(), [
		"apiMaxBodyBytes",
		"fileMaxBytes",
		"importMaxBundleBytes",
		"packCountMax",
		"packMaxBytes",
		"trashCountMax"
	]);
});

test("dispatch：packs.list / packs.get / trash.list 走通", async (t) => {
	makeTempHome(t);
	importPack({ source: "folder", files: folderFiles("valid-no-css") });

	const listed = await dispatch(null, { method: "packs.list" });
	assert.equal(listed.status, 200);
	assert.equal(listed.value.value.counts.user, 1);
	assert.equal(listed.value.value.counts.builtin, 1);

	const fetched = await dispatch(null, { method: "packs.get", args: { id: "fixture-no-css" } });
	assert.equal(fetched.status, 200);
	assert.equal(fetched.value.value.source, "user");
	assert.equal(fetched.value.value.pack.id, "fixture-no-css");

	const missing = await dispatch(null, { method: "packs.get", args: { id: "no-such-pack" } });
	assert.equal(missing.status, 404);
	assert.equal(missing.value.ok, false);
	assert.equal(missing.value.error.code, "pack-not-found");

	const trash = await dispatch(null, { method: "trash.list" });
	assert.equal(trash.status, 200);
	assert.deepEqual(trash.value.value, { entries: [], count: 0 });

	const caps = await dispatch(null, { method: "packs.delete", args: { id: "cocreate-paper" } });
	assert.equal(caps.status, 400);
	assert.equal(caps.value.error.code, "builtin-protected");
});

test("dispatch：未知方法 / 非对象请求体 / 无效 JSON 语义 → 400", async () => {
	const unknown = await dispatch(null, { method: "nope" });
	assert.equal(unknown.status, 400);
	assert.equal(unknown.value.error.code, "unknown-method");
	const arrayBody = await dispatch(null, []);
	assert.equal(arrayBody.status, 400);
	assert.equal(arrayBody.value.error.code, "bad-request");
	const noMethod = await dispatch(null, {});
	assert.equal(noMethod.status, 400);
	assert.equal(noMethod.value.error.code, "unknown-method");
});

test("dispatch：state.get / state.set 保持扁平形状，includeUi 控制磁盘 ui 保留", async (t) => {
	makeTempHome(t);
	const fresh = await dispatch(null, { method: "state.get" });
	assert.equal(fresh.status, 200);
	assert.equal(fresh.value.ok, true);
	assert.equal(fresh.value.value.fresh, true);
	assert.equal(fresh.value.value.format, "dshte.state");
	assert.equal(fresh.value.value.version, 2);
	assert.equal(typeof fresh.value.value.ui, "object");

	const written = await dispatch(null, { method: "state.set", args: { state: statePayload(), includeUi: true } });
	assert.equal(written.status, 200, JSON.stringify(written.value));
	assert.equal(written.value.value.activePackId, "cocreate-paper");
	assert.equal(written.value.value.fresh, false);
	assert.equal(written.value.value.ui.userCss.text, "body { --dshte-test: 1; }");
	assert.equal(Object.hasOwn(written.value.value, "state"), false, "state.set 返回扁平形状，不能再嵌套 state");

	// 普通 overrides 写入不携带大 payload：includeUi !== true 时磁盘上的 ui 必须保留。
	const overrides = { light: { "--dsw-alias-brand-primary": "#123456" }, dark: {} };
	const second = await dispatch(null, {
		method: "state.set",
		args: { state: statePayload({ activePackId: "fixture-pack", overrides, ui: { ...uiPayload(), userCss: { text: "SHOULD-NOT-WIN", savedAt: null } } }) }
	});
	assert.equal(second.status, 200, JSON.stringify(second.value));
	const disk = readState();
	assert.equal(disk.ok, true);
	assert.equal(disk.state.activePackId, "fixture-pack");
	assert.equal(disk.state.overrides.light["--dsw-alias-brand-primary"], "#123456");
	assert.equal(disk.state.ui.userCss.text, "body { --dshte-test: 1; }");

	const invalid = await dispatch(null, { method: "state.set", args: { state: { format: "dshte.state", version: 9 } } });
	assert.equal(invalid.status, 400);
	assert.equal(invalid.value.error.code, "invalid-state");
});

test("handler：POST 正常请求 → 200 JSON（同源 + loopback + session 通过）", async (t) => {
	makeTempHome(t);
	const handler = createApiHandler(trustedContext());
	const { res } = await callHandler(handler, { headers: TRUSTED_HEADERS, body: { method: "diag.caps" } });
	assert.equal(res.status, 200);
	assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
	assert.equal(res.json.ok, true);
	assert.deepEqual(res.json.value, diagCaps());
});

test("handler：传输上限 48 MB —— content-length 超限直接 413 可读 JSON（不裸断连）", async (t) => {
	makeTempHome(t);
	const handler = createApiHandler(trustedContext());
	const { res } = await callHandler(handler, {
		headers: { ...TRUSTED_HEADERS, "content-length": String(MAX_BODY_BYTES + 1) }
	});
	assert.equal(res.status, 413);
	assert.equal(res.headers.connection, "close");
	assert.equal(res.json.ok, false);
	assert.equal(res.json.error.code, "payload-too-large");
	assert.match(res.json.error.message, /48 MB/);
	assert.equal(res.json.error.message.length > 0, true);
});

test("handler：鉴权围栏 —— 非 POST 405 / 非可信 host 403 / session 拒绝 503", async (t) => {
	makeTempHome(t);
	const handler = createApiHandler(trustedContext());

	const get = await callHandler(handler, { method: "GET", headers: TRUSTED_HEADERS });
	assert.equal(get.res.status, 405);
	assert.equal(get.res.headers.allow, "POST");

	const untrusted = await callHandler(handler, { headers: { host: "evil.example:8080", "sec-fetch-site": "same-origin" }, body: { method: "diag.caps" } });
	assert.equal(untrusted.res.status, 403);
	assert.equal(untrusted.res.json.error.code, "forbidden");

	const rejected = createApiHandler(trustedContext({ requestRejection: 401 }));
	const session = await callHandler(rejected, { headers: TRUSTED_HEADERS, body: { method: "diag.caps" } });
	assert.equal(session.res.status, 401);
	assert.equal(session.res.json.error.code, "unauthorized");
});

test("handler：请求体不是合法 JSON → 400；JSON 数组 → 400", async (t) => {
	makeTempHome(t);
	const handler = createApiHandler(trustedContext());
	const broken = await callHandler(handler, { headers: TRUSTED_HEADERS, body: "{not json" });
	assert.equal(broken.res.status, 400);
	assert.equal(broken.res.json.error.code, "bad-request");
	const array = await callHandler(handler, { headers: TRUSTED_HEADERS, body: "[]" });
	assert.equal(array.res.status, 400);
	assert.equal(array.res.json.error.code, "bad-request");
	assert.match(array.res.json.error.message, /JSON 对象/);
});
