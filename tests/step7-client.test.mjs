/**
 * Step 7 — client hardening checks (纯 Node，无 DOM 库).
 *
 * Layers (same style as tests/step5-engine.test.mjs):
 *   1. 结构：engine.js 的 §3.1 全量诊断字段 / body 作用域 lateStyles /
 *      控制台一次汇总 / 自动安全模式 4 个守卫；rows-misc.js 的 §3.8 冻结
 *      data 属性 + 2 秒只读复检；main.js 的 step7 标记且保留 Step 5/6；
 *      settings.js 页面根已是 step7。
 *   2. 行为（能桩就桩）：uiSafeDiagnostics() 兜底对象含全部新字段；
 *      reassert() 返回值形状与 runtime.reassert 记录；UICard 把 data-* 转发到行根。
 *   3. 防回归：verify 路径仍不出现 overrideTokens；dispose() 仍移除全部 6 类
 *      style 节点；不读 window.dshDreamSkin 的内容/不调用它的桥。
 *
 * 不 require 真实 DOM；不执行构建（Lead 做最终构建与验收）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, ROOT), "utf8");
const ENGINE_SOURCE = read("src/client/engine.js");
const ROWS_MISC_SOURCE = read("src/client/parts/rows-misc.js");
const UIKIT_SOURCE = read("src/client/parts/ui-kit.js");
const SETTINGS_SOURCE = read("src/client/parts/settings.js");
const MAIN_SOURCE = read("src/client/main.js");

function functionBody(source, signature) {
	const match = new RegExp(`function ${signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\t\\}`).exec(source);
	return match ? match[1] : null;
}

/* ── 1. engine.js 结构 ────────────────────────────────────────────────── */

test("engine.js diagnostics carries every §3.1 field (old fields preserved)", () => {
	for (const needle of [
		"applied", "enabled", "activePackId", "scheme", "policy", "layerCount", "layerSource",
		"mismatch", "mismatchCount", "missing", "fallbackNames", "lastError", "lastReason",
		"hostApi", "hooks", "frameGrid", "handlePresent", "layoutUntouched", "styleOrder",
		"lateStyles", "host:", "bodyStyles:", "orderHealth", "dreamSkin:", "detected",
		"cssSkin", "materialStyle", "bridge", "suspected", "layout:", "alert:", "consoleDiag:",
		"autoSafeMode:", "reassert:", "mismatchBefore", "mismatchAfter", "stillOverridden",
		"step: 7"
	]) {
		assert.ok(ENGINE_SOURCE.includes(needle), `engine.js missing ${needle}`);
	}
	// §4.5 says body-scope only for the late-style scan; the full-document order stays.
	assert.ok(/document\.body\.querySelectorAll\("style"\)/.test(ENGINE_SOURCE), "lateStyles must scan document.body only");
	assert.ok(ENGINE_SOURCE.includes("index > packIndex"), "lateStyles must be limited to nodes after #dshte-pack-css");
	assert.ok(ENGINE_SOURCE.includes("function listStyleOrder()"), "the full-document styleOrder must stay");
});

test("engine.js console summary is one info line with counts only (no token values)", () => {
	assert.ok(ENGINE_SOURCE.includes("console.info("), "console.info call missing");
	assert.ok(ENGINE_SOURCE.includes('TAG + " diag"'), 'console.info(TAG + " diag", …) missing');
	const body = functionBody(ENGINE_SOURCE, "consoleSummary");
	assert.ok(body, "consoleSummary() not found");
	for (const field of ["at", "reason", "applied", "pack", "scheme", "layer", "safeMode", "mismatch", "fallback", "orderHealth", "lateStyles", "dreamSkin", "host", "hookHitRate"]) {
		assert.ok(body.includes(field), `console summary missing ${field}`);
	}
	assert.equal(/\.actual|\.expected/.test(body), false, "console summary must not carry token values");
	assert.ok(ENGINE_SOURCE.includes('emitConsoleDiag("startup")'), "startup summary missing");
	assert.ok(ENGINE_SOURCE.includes('scheduleConsoleDiag("theme-change")'), "theme/change summary missing");
	assert.ok(ENGINE_SOURCE.includes('emitConsoleDiag("reassert")'), "reassert summary missing");
	assert.ok(ENGINE_SOURCE.includes("}, 1000);"), "theme/change summary must be throttled to 1 s");
	assert.ok(ENGINE_SOURCE.includes("consoleDiag: { count:"), "consoleDiag must be capped/recorded");
});

test("engine.js auto safe mode is guarded by the four §3.6 conditions", () => {
	const body = functionBody(ENGINE_SOURCE, "maybeAutoSafeMode");
	assert.ok(body, "maybeAutoSafeMode() not found");
	assert.ok(body.includes("runtime.autoSafeMode.triggered"), "session-once guard missing");
	assert.ok(body.includes("if (!runtime.active)"), "active guard missing");
	assert.ok(body.includes("runtime.preview && runtime.preview.active"), "preview guard missing");
	assert.ok(body.includes("pageAgeMs()"), "page-age guard missing");
	assert.ok(body.includes("AUTO_SAFE_MODE_MIN_AGE_MS"), ">15 s threshold missing");
	assert.ok(body.includes('data-side="sidebar"'), "handlePresent check missing");
	assert.ok(body.includes("gridLooksHost(grid)"), "host 3-track check missing");
	assert.ok(body.includes("if (handle !== false) return false;"), "handle guard missing");
	assert.ok(body.includes("if (gridHost !== false) return false;"), "grid guard missing");
	assert.ok(body.includes("setSafeMode(true)"), "trigger must persist safe mode");
	assert.ok(body.includes("console.warn("), "trigger must emit one console.warn");
	assert.ok(body.includes('reason: "layout-violation"'), "autoSafeMode.reason missing");
	// Wiring: the check lives on the existing verifyNow() throttle path.
	assert.ok(ENGINE_SOURCE.includes("maybeAutoSafeMode();"), "verifyNow must call maybeAutoSafeMode()");
	const verify = functionBody(ENGINE_SOURCE, "verifyNow");
	assert.ok(verify && verify.includes("maybeAutoSafeMode();"), "auto safe mode must be checked in verifyNow()");
});

test("engine.js safe-mode terminal state is withdraw + inert static CSS", () => {
	const body = functionBody(ENGINE_SOURCE, "setSafeMode");
	assert.ok(body, "setSafeMode() not found");
	assert.ok(body.includes('withdraw("safe-mode")'), "safe mode must withdraw the layer");
	assert.ok(body.includes('store.setSafeMode(want)'), "safe mode flag must persist (localStorage dshte:safe:v1)");
	assert.ok(body.includes("removePreviewStyle()"));
	assert.ok(body.includes("removeUserCssStyle()"));
	// Re-enable order stays: loadPack → apply → custom CSS → local fonts.
	assert.ok(/await reloadPack\(\);\s*\n\s*restoreSavedUserCss\(\);\s*\n\s*await store\.userFonts\.restore\(\);/.test(ENGINE_SOURCE), "safe-mode-off restore order changed");
});

test("engine.js dream-skin probe is existence-only (never reads content / never calls the bridge)", () => {
	const body = functionBody(ENGINE_SOURCE, "dreamSkinDiagnostics");
	assert.ok(body, "dreamSkinDiagnostics() not found");
	assert.ok(body.includes('style[data-plugin-css="dsh-dream-skin/interface-skin"]'));
	assert.ok(body.includes('typeof window.dshDreamSkin === "object"'));
	assert.equal(/window\.dshDreamSkin\s*[.(]/.test(ENGINE_SOURCE), false, "must not call window.dshDreamSkin");
	assert.equal(/dshDreamSkin.*textContent/.test(ENGINE_SOURCE), false, "must not read dream-skin style content");
});

/* ── 2. rows-misc.js §3.8 诊断行 ───────────────────────────────────────── */

test("rows-misc.js exposes every frozen §3.8 data hook", () => {
	for (const needle of [
		'"data-dshte-diag": "summary"',
		'"data-dshte-diag": "host"',
		'"data-host-available"',
		'"data-dshte-diag": "order-health"',
		'"data-order-health"',
		'"data-dshte-diag": "late-styles"',
		'"data-late-style": ""',
		'"data-dshte-diag": "mismatch"',
		'"data-mismatch-count"',
		'"data-mismatch-token": ""',
		'"data-suspected"',
		'"data-dshte-diag": "layout"',
		'"data-layout-untouched"',
		'"data-dshte-diag": "dreamskin"',
		'"data-dreamskin"',
		'"data-dshte-diag": "safe-mode"',
		'"data-safe-mode"',
		'"data-reassert-state"',
		'"data-reassert-result"',
		'"data-dshte-action": "reassert"',
		'"data-dshte-action": "copy-diag"',
		'"data-dshte-action": "probe"'
	]) {
		assert.ok(ROWS_MISC_SOURCE.includes(needle), `rows-misc.js missing ${needle}`);
	}
	// The row still renders through UICard(rowId: "diagnostics") → data-dshte-row.
	assert.ok(ROWS_MISC_SOURCE.includes('rowId: "diagnostics"'));
});

test("rows-misc.js reassert does the 2 s read-only re-check state machine", () => {
	for (const needle of ['"idle"', '"checking"', '"ok"', '"still-overridden"', '"error"', "}, 2000);", "差异已归零", "疑似 dsh-dream-skin 外观层后叠", "uiSafeDiagnostics(ctx.engine)"]) {
		assert.ok(ROWS_MISC_SOURCE.includes(needle), `rows-misc.js missing ${needle}`);
	}
	// The 2 s re-check must be read-only: only diagnostics()/refresh(), no restack.
	const reassertBody = functionBody(ROWS_MISC_SOURCE, "RowDiagnostics");
	assert.ok(reassertBody, "RowDiagnostics() not found");
	const tail = reassertBody.slice(reassertBody.indexOf("setTimeout("));
	assert.equal(tail.includes("engine.reassert("), false, "the 2 s re-check must never restack");
	assert.equal(tail.includes("engine.apply("), false, "the 2 s re-check must never restack");
	assert.ok(ROWS_MISC_SOURCE.includes('"data-safe-mode-note"'), "advanced row must explain the safe-mode terminal state");
});

/* ── 3. 标记与兜底（step7） ───────────────────────────────────────────── */

test("main.js marks Step 7 and keeps the Step 5/6 surfaces", () => {
	assert.ok(MAIN_SOURCE.includes("window.__dshteStep7"));
	const step7 = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf("window.__dshteStep7"));
	const block = step7.slice(0, step7.indexOf("};"));
	for (const field of ["marker", "version", "step: 7", "at", "diagnostics", "reassert", "hostInfo"]) {
		assert.ok(block.includes(field), `__dshteStep7 missing ${field}`);
	}
	assert.ok(MAIN_SOURCE.includes("step: 7,"), "__dshte.step must be 7");
	assert.ok(MAIN_SOURCE.includes('"client apply", VERSION, MARKER, "step7"'), "apply log must say step7");
	assert.ok(MAIN_SOURCE.includes("window.__dshteStep5"), "Step 5 surface must stay");
	assert.ok(MAIN_SOURCE.includes("window.__dshteStep6"), "Step 6 surface must stay");
});

test("settings.js page root is step7 (page/step/engine)", () => {
	assert.ok(SETTINGS_SOURCE.includes('"data-dshte-page": "step7"'));
	assert.ok(SETTINGS_SOURCE.includes('"data-dshte-step": "7"'));
	assert.ok(SETTINGS_SOURCE.includes('"data-dshte-engine": "step7"'));
});

/* ── 4. 行为：uiSafeDiagnostics 兜底 + UICard data-* 转发 + reassert 形状 ─ */

function loadUiKit() {
	const ReactStub = {
		createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
		createContext: () => null
	};
	const factory = new Function("React", `${UIKIT_SOURCE}\nreturn { uiSafeDiagnostics, UICard };`);
	return factory(ReactStub);
}

test("uiSafeDiagnostics fallback contains every Step 7 field and step 7", () => {
	const kit = loadUiKit();
	const fallback = kit.uiSafeDiagnostics(null);
	assert.equal(fallback.step, 7);
	for (const key of ["host", "bodyStyles", "dreamSkin", "mismatchCount", "layout", "consoleDiag", "autoSafeMode", "reassert"]) {
		assert.ok(Object.prototype.hasOwnProperty.call(fallback, key), `fallback missing ${key}`);
	}
	assert.equal(fallback.mismatchCount, 0);
	assert.equal(fallback.bodyStyles.orderHealth, "unknown");
	assert.deepEqual(fallback.bodyStyles.present, { vars: false, engine: false, pack: false, fonts: false });
	assert.equal(fallback.layout.untouched, null);
	assert.equal(fallback.reassert.stillOverridden, null);
	assert.equal(fallback.autoSafeMode.triggered, false);
	// A real engine result wins over the fallback (defensive accessor contract).
	const live = kit.uiSafeDiagnostics({ diagnostics: () => ({ step: 7, marker: "engine" }) });
	assert.equal(live.marker, "engine");
});

test("UICard forwards data-* hooks to the row root (data-reassert-state/result)", () => {
	const kit = loadUiKit();
	const node = kit.UICard({
		rowId: "diagnostics",
		"data-reassert-state": "idle",
		"data-reassert-result": "null",
		children: null
	});
	assert.equal(node.props["data-dshte-row"], "diagnostics");
	assert.equal(node.props["data-reassert-state"], "idle");
	assert.equal(node.props["data-reassert-result"], "null");
});

test("reassert() returns {ok, mismatchBefore, mismatched, layerCount} and records runtime.reassert", () => {
	const match = /\n\tfunction reassert\(\) \{([\s\S]*?)\n\t\}/.exec(ENGINE_SOURCE);
	assert.ok(match, "reassert() not found");
	const factory = new Function("apply", "runtime", "emitConsoleDiag", `function reassert() {${match[1]}\n\t}\n\treturn reassert;`);
	const runtime = {
		mismatch: [{ name: "a" }, { name: "b" }],
		active: true,
		layer: {},
		reassertInfo: { lastAt: null, mismatchBefore: null, mismatchAfter: null, stillOverridden: null }
	};
	let calls = 0;
	let consoleReason = null;
	const reassert = factory(
		() => { calls += 1; runtime.mismatch = []; },
		runtime,
		(reason) => { consoleReason = reason; }
	);
	const result = reassert();
	assert.equal(calls, 1, "reassert must call apply once");
	assert.deepEqual(result, { ok: true, mismatchBefore: 2, mismatched: 0, layerCount: 1 });
	assert.match(String(runtime.reassertInfo.lastAt), /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(runtime.reassertInfo.mismatchBefore, 2);
	assert.equal(consoleReason, "reassert", "reassert must emit the unthrottled console summary");
});

/* ── 5. 防回归（Step 5 既有断言思路） ─────────────────────────────────── */

test("verify path still never stacks a token layer; dispose still removes all 6 style nodes", () => {
	const verify = functionBody(ENGINE_SOURCE, "verifyNow");
	assert.ok(verify, "verifyNow() not found");
	assert.equal(verify.includes("overrideTokens"), false, "verifyNow must never call overrideTokens");
	assert.equal(/store\.(set|setCustomCss|setUi)\s*\(/.test(verify), false, "verifyNow must not write store state");

	const dispose = functionBody(ENGINE_SOURCE, "dispose");
	assert.ok(dispose, "dispose() not found");
	for (const remover of ["removeVarsStyle", "removeFontsStyle", "removePackStyle", "removePreviewStyle", "removeUserCssStyle", "removeEngineStyle"]) {
		assert.ok(dispose.includes(remover), `dispose must call ${remover}()`);
	}
});
