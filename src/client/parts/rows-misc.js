/**
 * Step 5 status/action bars + rows 13–15:
 * 自定义 CSS · 诊断/共存 · 高级.
 * Step 6 rows 1/4/5/6 live in parts/rows-packio.js (import/export/manage/trash).
 * All clickable things are <button type="button">, destructive actions confirm
 * inline, and errors stay visible inline (role="alert" / [data-dshte-error]).
 */

const MISC_MONO = "ui-monospace, \"Cascadia Code\", Consolas, monospace";

function miscClock() {
	try { return new Date().toLocaleTimeString(); } catch { return "?"; }
}

/* ── status bar / action bar ────────────────────────────────────────────── */

function StatusBar(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const diag = ctx.diag || {};
	const state = ctx.state || {};
	const safe = ctx.safeMode === true;
	const enabled = state.enabled !== false;
	const packEntry = state.activePackId && BUILTIN_PACKS ? BUILTIN_PACKS[state.activePackId] : null;
	const pack = packEntry && packEntry.pack ? packEntry.pack : null;
	const meta = state.activePackId && ctx.store && typeof ctx.store.packMeta === "function" ? ctx.store.packMeta(state.activePackId) : null;
	const packLabel = pack
		? (pack.nameZh || pack.name || state.activePackId)
		: meta ? (meta.nameZh || meta.name || state.activePackId) + "（" + (meta.source === "user" ? "用户包" : "内置") + "）"
			: (state.activePackId ? String(state.activePackId) + "（未知）" : "无");
	const host = diag.hostApi || { available: null, lastError: null };
	const statusText = ctx.status && ctx.status.text ? ctx.status.text : (diag.applied ? "运行中（已注入）" : "就绪");
	const statusKind = ctx.status && ctx.status.kind ? ctx.status.kind : "ok";
	const injection = diag.applied ? "已注入" : (!enabled ? "已停用" : "未注入");
	const behavior = diag.dreamSkinCssDetected ? "dream-skin CSS 共存" : "未检测到 dream-skin";
	const summaryStyle = { fontSize: "11px", color: UI_COLOR.textTertiary, lineHeight: 1.6 };
	const warnings = [];
	if (safe) {
		warnings.push(h("div", { key: "safe", style: { marginTop: "6px", padding: "6px 9px", borderRadius: "7px", border: "1px solid " + UI_COLOR.danger, background: UI_COLOR.dangerBg, color: UI_COLOR.danger, fontSize: "11.5px", lineHeight: 1.6 } },
			"安全模式已开启：本引擎已撤掉全部层（vars / preview / 自定义 CSS），页面显示宿主原生外观。关闭安全模式后会重新加载主题包。"));
	}
	const knownPack = !state.activePackId
		|| (BUILTIN_PACKS && BUILTIN_PACKS[state.activePackId])
		|| (meta !== null)
		|| (ctx.packs && Array.isArray(ctx.packs.user) && ctx.packs.user.some((item) => item && item.id === state.activePackId));
	if (state.activePackId && !knownPack) {
		warnings.push(h("div", { key: "missing", style: { marginTop: "6px", fontSize: "11px", color: UI_COLOR.danger, lineHeight: 1.6 } },
			"当前包「" + state.activePackId + "」在内置包与用户包里都不存在，已回退原生外观；请重新选包或恢复默认。"));
	}
	if (host.available === false) {
		warnings.push(h("div", { key: "host", style: { marginTop: "6px", fontSize: "11px", color: UI_COLOR.warn, lineHeight: 1.6 } },
			"宿主 API 不可用：" + String(host.lastError || "未知错误") + "（编辑仍可预览；应用会先写 localStorage 种子，宿主恢复后自动补写）"));
	}
	return h("section", {
		"data-dshte-row": "status",
		style: {
			display: "grid",
			gap: "2px",
			padding: "9px 12px",
			margin: "0 0 10px",
			borderRadius: "10px",
			border: "1px solid " + (safe ? UI_COLOR.danger : UI_COLOR.border),
			background: safe ? UI_COLOR.dangerBg : UI_COLOR.surface,
			color: UI_COLOR.text,
			boxSizing: "border-box"
		}
	},
		h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
			h("span", { style: { fontSize: "13px", fontWeight: 600 } }, "皮肤引擎"),
			h(UIBadge, { ok: enabled && !safe, warn: safe || !enabled }, safe ? "安全模式" : enabled ? "已启用" : "已停用"),
			h(UIButton, {
				"data-dshte-action": "safe-mode",
				pressed: safe,
				danger: safe,
				onClick: () => ctx.actions.toggleSafeMode(),
				title: "保命开关：立即撤掉本引擎的全部样式（仅内联样式，不依赖包 CSS）",
				style: { padding: "3px 10px" }
			}, safe ? "关闭安全模式" : "开启安全模式"),
			h("span", {
				"data-dshte-status": "",
				role: "status",
				"aria-live": "polite",
				style: {
					fontSize: "11.5px",
					lineHeight: 1.6,
					color: statusKind === "bad" ? UI_COLOR.danger : statusKind === "ok" ? UI_COLOR.ok : UI_COLOR.textSecondary
				}
			}, statusText)
		),
		h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "baseline" } },
			h("span", { "data-dshte-summary": "pack", style: summaryStyle }, "当前包：" + packLabel),
			h("span", { "data-dshte-summary": "scheme", style: summaryStyle }, "方案：" + String(diag.scheme || "light") + " / 策略 " + String(diag.policy || "?")),
			h("span", { "data-dshte-summary": "inject", style: summaryStyle }, "注入：" + injection + (diag.layerCount ? " · 层 " + diag.layerCount : " · 无层")),
			h("span", { "data-dshte-summary": "coexist", style: summaryStyle }, "共存：" + behavior),
			h("span", { style: summaryStyle }, "宿主 API：" + (host.available === true ? "可用" : host.available === false ? "不可用" : "未探测"))
		),
		...warnings
	);
}

function ActionBar(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const dirty = ctx.dirty === true;
	const previewLive = ctx.previewLive === true;
	return h("section", {
		"data-dshte-row": "actions",
		style: {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap",
			padding: "8px 10px",
			margin: "0 0 10px",
			borderRadius: "10px",
			border: "1px solid " + UI_COLOR.border,
			background: UI_COLOR.surface2,
			boxSizing: "border-box"
		}
	},
		h(UIButton, { "data-dshte-action": "apply", primary: true, onClick: () => ctx.actions.applyDraft() }, "应用（写入 state.overrides）"),
		h(UIButton, { "data-dshte-action": "cancel", onClick: () => ctx.actions.cancelDraft() }, "取消（回滚草稿）"),
		h(UIToggle, {
			pressed: previewLive,
			"data-dshte-action": "preview-live",
			onClick: () => ctx.actions.togglePreviewLive()
		}, previewLive ? "实时预览：开" : "实时预览：关"),
		h("span", {
			"data-dshte-dirty": dirty ? "true" : "false",
			style: { fontSize: "11.5px", color: dirty ? UI_COLOR.warn : UI_COLOR.textTertiary, lineHeight: 1.6 }
		}, dirty ? "● 有未应用改动（仅预览，未写 state）" : "● 无未应用改动"),
		h("span", { style: uiStyle(UI_STYLE.hint, { flex: "1 1 240px" }) },
			"应用 = 清预览 → store.set({overrides}, reason=overrides) → dirty=false；取消 = 清预览 + 草稿回滚；关闭设置页 = 清预览 + 自定义 CSS 未保存改动回滚。")
	);
}

/* ── row 13: custom CSS ─────────────────────────────────────────────────── */

function RowCustomCss(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const saved = uiSafeGetCustomCss(ctx.store);
	const [text, setText] = React.useState(saved.text || "");
	const [baseline, setBaseline] = React.useState(saved.text || "");
	const [error, setError] = React.useState(null);
	const [result, setResult] = React.useState(null);
	const [info, setInfo] = React.useState(null);
	const dirty = text !== baseline;

	const inspect = (value) => {
		let outcome = null;
		try {
			if (ctx.engine && typeof ctx.engine.setUserCss === "function") outcome = ctx.engine.setUserCss(value);
		} catch (injectError) {
			return { ok: false, errors: [{ message: "engine.setUserCss 异常：" + String((injectError && injectError.message) || injectError) }], warnings: [], bytes: value.length, rewrittenCount: 0 };
		}
		if (outcome && typeof outcome === "object" && Array.isArray(outcome.errors)) {
			return {
				ok: outcome.ok === true,
				injected: outcome.injected === true,
				errors: outcome.errors,
				warnings: Array.isArray(outcome.warnings) ? outcome.warnings : [],
				bytes: outcome.bytes,
				lineCount: outcome.lineCount,
				rewrittenCount: outcome.rewrittenCount
			};
		}
		// engine-core may not expose setUserCss yet: use the shared precheck only.
		let check = null;
		try { check = precheckThemeCss(value, { filename: "custom.css" }); } catch (checkError) {
			return { ok: false, errors: [{ message: "CSS 预检异常：" + String((checkError && checkError.message) || checkError) }], warnings: [], bytes: value.length, rewrittenCount: 0 };
		}
		return {
			ok: check.ok,
			injected: false,
			errors: check.errors,
			warnings: check.warnings,
			bytes: check.stats.bytes,
			lineCount: value.split("\n").length,
			rewrittenCount: typeof listAssetUrls === "function" ? listAssetUrls(value).length : 0
		};
	};

	const runCheck = () => {
		const outcome = inspect(text);
		setResult(outcome);
		setError(outcome.ok ? null : "CSS 预检未通过（见下方行号）");
		if (outcome.ok) {
			setInfo("语法预检通过 · " + String(outcome.bytes) + " B · " + String(outcome.lineCount === undefined ? text.split("\n").length : outcome.lineCount) + " 行 · url() 改写 " + String(outcome.rewrittenCount || 0) + " 处" + (outcome.injected ? " · 已注入预览" : ""));
			ctx.actions.setStatus("自定义 CSS 预检通过", "ok");
		} else {
			setInfo(null);
			ctx.actions.setStatus("自定义 CSS 预检未通过（行内显示行号）", "bad");
		}
	};

	const save = () => {
		const outcome = inspect(text);
		setResult(outcome);
		if (!outcome.ok) {
			setError("CSS 预检未通过，未保存（见下方行号）");
			setInfo(null);
			ctx.actions.setStatus("自定义 CSS 未保存：预检未通过", "bad");
			return;
		}
		const ok = uiSafeSetCustomCss(ctx.store, text);
		if (!ok) {
			setError("store.setCustomCss 尚未就绪（engine-core 正在实现），本次未保存");
			return;
		}
		setError(null);
		setBaseline(text);
		setInfo("已保存 · " + String(outcome.bytes) + " B · " + (outcome.errors.length === 0 ? "预检通过" : ""));
		ctx.actions.setStatus("已保存自定义 CSS（" + String(outcome.bytes) + " B）", "ok");
	};

	const clear = () => {
		try { if (ctx.engine && typeof ctx.engine.setUserCss === "function") ctx.engine.setUserCss(""); } catch (error) { /* ignore */ }
		uiSafeSetCustomCss(ctx.store, "");
		setText("");
		setBaseline("");
		setResult(null);
		setError(null);
		setInfo("已清空自定义 CSS（节点已删、localStorage 键已清）");
		ctx.actions.setStatus("已清空自定义 CSS", "ok");
	};

	const errorList = result && Array.isArray(result.errors) ? result.errors : [];
	const warningList = result && Array.isArray(result.warnings) ? result.warnings : [];
	return h(UICard, {
		rowId: "custom-css",
		title: "13 · 自定义 CSS",
		note: "⚠ 自定义 CSS 走 unsafe 通道：注入前会做语法 / 布局属性 / 外部资源预检，失败不覆盖现有内容。「检查语法」会顺带注入预览；「保存」预检通过后才写 localStorage；「清空」删节点并清键。关闭设置页时未保存的修改会回滚到已保存文本。"
	},
		h("textarea", {
			"data-dshte-css-editor": "",
			value: text,
			onChange: (event) => setText(event.target.value),
			placeholder: "/* 例：\n[data-slot=\"sidebar.brand.name\"] { letter-spacing: 0.2em; }\n*/",
			spellCheck: false,
			style: UI_STYLE.textarea
		}),
		h("div", { style: uiStyle(UI_STYLE.row, { marginTop: "6px" }) },
			h(UIButton, { "data-dshte-action": "css-check", onClick: runCheck, primary: true }, "检查语法"),
			h(UIButton, { "data-dshte-action": "css-save", onClick: save, disabled: !dirty }, "保存"),
			h(UIButton, { "data-dshte-action": "css-clear", onClick: clear, danger: true }, "清空"),
			h("span", { style: UI_STYLE.hint },
				"未保存修改：" + (dirty ? "有" : "无") +
				" · " + text.length + " 字符 / " + text.split("\n").length + " 行"),
			dirty ? h(UIBadge, { warn: true, name: "css-dirty" }, "未保存") : h(UIBadge, { ok: true }, "已同步")
		),
		h("div", { "data-dshte-css-error": "", role: errorList.length > 0 ? "alert" : "status", style: { marginTop: "4px", fontSize: "11px", lineHeight: 1.65, color: errorList.length > 0 ? UI_COLOR.danger : UI_COLOR.textTertiary } },
			error && errorList.length === 0 ? error : null,
			...errorList.map((issue, index) => h("div", { key: "ce" + index, "data-dshte-error": "" },
				"· " + String(issue.message || issue))),
			warningList.length > 0 ? h("div", { style: { color: UI_COLOR.warn } }, "⚠ " + warningList.map((issue) => String(issue.message || issue)).join("；")) : null,
			errorList.length === 0 && !error ? h("span", null, result && result.ok ? "✓ 语法检查通过" : "尚未检查") : null
		),
		info ? h(UIStatus, { kind: "ok", style: { display: "block", marginTop: "4px" } }, info) : null,
		h(UINote, null, "url(assets/…) 会被改写成 /dsh-tavern-skin/assets/builtin/<id>/…；@import / 外部 http(s) 资源会被拒绝。自定义 CSS 存在 localStorage（dshte:userCss:v1），Step 6 改由包草稿承载。")
	);
}

/* ── row 14: diagnostics / coexistence ──────────────────────────────────── */

function RowDiagnostics(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const diag = ctx.diag || {};
	const [copyState, setCopyState] = React.useState(null);
	const [error, setError] = React.useState(null);
	/* Step 7 §3.2: "以本主题为准" + 2 s read-only re-check state machine. */
	const [reassertState, setReassertState] = React.useState("idle");
	const [reassertText, setReassertText] = React.useState(null);
	const [reassertResult, setReassertResult] = React.useState(null);
	const recheckTimer = React.useRef(null);
	React.useEffect(() => () => { if (recheckTimer.current) clearTimeout(recheckTimer.current); }, []);
	const host = diag.host || diag.hostApi || { available: null, lastError: null };
	const bodyStyles = diag.bodyStyles || {};
	const dreamSkin = diag.dreamSkin || {};
	const layout = diag.layout || {};
	const mismatch = Array.isArray(diag.mismatch) ? diag.mismatch : [];
	const mismatchCount = typeof diag.mismatchCount === "number" ? diag.mismatchCount : mismatch.length;
	const lateStyles = Array.isArray(diag.lateStyles)
		? diag.lateStyles
		: (Array.isArray(bodyStyles.lateStyles) ? bodyStyles.lateStyles : []);
	const orderHealth = typeof bodyStyles.orderHealth === "string" ? bodyStyles.orderHealth : "unknown";
	const orderNote = String(bodyStyles.note || "");
	const layoutUntouched = layout.untouched === undefined ? diag.layoutUntouched : layout.untouched;
	const hostAvailable = host.available === true || host.available === false ? host.available : null;
	const autoAlertActive = !!(layout.alert && layout.alert.active === true);
	const pairs = [
		["生效 / 停用", (diag.applied ? "已注入" : "未注入") + " · enabled=" + String(diag.enabled)],
		["当前包", String(diag.activePackId) + "（包内 " + String(diag.packColorScheme) + "）"],
		["宿主方案 / 策略", String(diag.scheme) + " / " + String(diag.policy)],
		["override 层", "数量 " + String(diag.layerCount) + " · source " + String(diag.layerSource || "—")],
		["token", "宿主 " + String(diag.hostTokenCount) + " · 引擎 " + String(diag.engineTokenCount)],
		["被覆盖 token", String(mismatchCount) + "（推测见下）"],
		["!important 兜底", (diag.fallbackNames || []).length ? (diag.fallbackNames || []).join(", ") : "无"],
		["theme.css", !diag.packCss ? "未处理" : diag.packCss.present ? "已注入（" + diag.packCss.bytes + " B · 改写 " + diag.packCss.rewrittenCount + " 处）" : diag.packCss.ok === false ? "已拦截：" + String((diag.packCss.firstError && diag.packCss.firstError.message) || "未知错误") : "无"],
		["@font-face", !diag.fonts || diag.fonts.length === 0 ? "无" : diag.fonts.map((font) => font.family + "/" + font.weight + (font.check ? " ✓" : " ✗")).join(" · ")],
		["分区/组件编译", !diag.recipes ? "未编译" : "分区 " + diag.recipes.regions + " · 组件 " + diag.recipes.components + " · 声明 " + diag.recipes.declarations],
		["钩子命中率", !diag.hooks ? "未探测" : String(diag.hooks.hit) + "/" + String(diag.hooks.total) + "（" + String(diag.hooks.hitRate) + "%）"],
		["data-slot 命中率", !diag.hooks ? "未探测" : String(diag.hooks.slots.hit) + "/" + String(diag.hooks.slots.total) + "（" + String(diag.hooks.slotHitRate) + "%）"],
		["未命中组件", !diag.componentsMissed || diag.componentsMissed.length === 0 ? "无" : diag.componentsMissed.map((entry) => entry.key).join(", ")],
		["资源基址", String(diag.assetBase || "—")],
		["宿主 API", host.available === true ? "可用" : host.available === false ? "不可用（" + String(host.lastError || "未知") + "）" : "未探测"],
		["dream-skin CSS", diag.dreamSkinCssDetected ? "检测到（共存）" : "未检测到"],
		["布局未动", diag.layoutUntouched === true ? "是（frame 内联 grid 未变）" : diag.layoutUntouched === false ? "否/未知" : "未知"],
		["样式节点", "engine " + (diag.engineStylePresent ? "✓" : "✗") + " · vars " + (diag.varsStylePresent ? "✓" : "✗") + " · pack " + (diag.packStylePresent ? "✓" : "✗") + " · fonts " + (diag.fontsStylePresent ? "✓" : "✗")],
		["预览状态", diag.preview ? "active=" + String(diag.preview.active === true) + " · hostDiff=" + String(diag.preview.hostDiffCount) : "无"],
		["自定义 CSS", diag.userCss ? "present=" + String(diag.userCss.present === true) + " · ok=" + String(diag.userCss.ok) + " · " + String(diag.userCss.bytes || 0) + " B" : "无"],
		["安全模式", diag.safeMode === true ? "开" : "关"],
		["样式节点顺序", Array.isArray(diag.styleOrder) ? diag.styleOrder.join(" → ") : "—"],
		["最近一次", String(diag.lastReason || "—") + " @ " + String(diag.lastApplyAt || "—")],
		["最后错误", String(diag.lastError || "无")]
	];

	const snapshot = (() => {
		try {
			if (ctx.store && typeof ctx.store.snapshot === "function") return ctx.store.snapshot();
		} catch (error) { return { error: String((error && error.message) || error) }; }
		return null;
	})();
	const payload = () => {
		try {
			return JSON.stringify({
				at: new Date().toISOString(),
				step: 7,
				version: typeof VERSION === "string" ? VERSION : null,
				diagnostics: diag,
				store: snapshot,
				editor: { scheme: ctx.editScheme, dirtyCount: countOverrides(ctx.draft ? ctx.draft.overrides : null) }
			}, null, 2);
		} catch (error) {
			return JSON.stringify({ error: String((error && error.message) || error) });
		}
	};

	const reassert = () => {
		setError(null);
		setReassertState("checking");
		setReassertText("已重新叠层，2 秒后复检…");
		let result = null;
		try {
			if (ctx.engine && typeof ctx.engine.reassert === "function") result = ctx.engine.reassert();
			else if (ctx.engine && typeof ctx.engine.apply === "function") {
				ctx.engine.apply("manual", { restack: true });
				result = { ok: true, mismatchBefore: mismatchCount, mismatched: null, layerCount: null };
			} else {
				setReassertState("error");
				setReassertText("以本主题为准失败：engine.reassert 接口尚未就绪");
				setError("engine.reassert 接口尚未就绪");
				return;
			}
		} catch (thrown) {
			const message = "以本主题为准失败：" + String((thrown && thrown.message) || thrown);
			setReassertState("error");
			setReassertText(message);
			setError(message);
			return;
		}
		const before = result && typeof result.mismatchBefore === "number" ? result.mismatchBefore : mismatchCount;
		setReassertResult({ ok: !result || result.ok !== false, mismatchBefore: before, mismatchAfter: null, tokens: [] });
		ctx.actions.setStatus("已以本主题为准重新叠层（reassert）", "ok");
		if (recheckTimer.current) clearTimeout(recheckTimer.current);
		// §3.2 step 2: read-only re-check after 2 s — never stacks the layer again.
		recheckTimer.current = setTimeout(() => {
			recheckTimer.current = null;
			try {
				const after = uiSafeDiagnostics(ctx.engine);
				const list = Array.isArray(after.mismatch) ? after.mismatch : [];
				const afterCount = typeof after.mismatchCount === "number" ? after.mismatchCount : list.length;
				const tokens = list.slice(0, 3).map((entry) => String(entry && entry.name ? entry.name : entry));
				setReassertResult({ ok: afterCount === 0, mismatchBefore: before, mismatchAfter: afterCount, tokens });
				if (afterCount === 0) {
					const verified = typeof after.hostTokenCount === "number" && after.hostTokenCount > 0
						? after.hostTokenCount
						: (Array.isArray(after.requiredTokens) ? after.requiredTokens.length : 0);
					setReassertState("ok");
					setReassertText("差异已归零（" + String(verified) + " 项 token 已按本主题生效）");
				} else {
					setReassertState("still-overridden");
					setReassertText("仍有 " + String(afterCount) + " 项被覆盖：" + tokens.join(", ") + "；疑似 dsh-dream-skin 外观层后叠，建议关闭它的壁纸/玻璃，或把深色策略改为 inherit（若为深色包）");
				}
				ctx.actions.refresh();
			} catch (thrown) {
				const message = "复检失败：" + String((thrown && thrown.message) || thrown);
				setReassertState("error");
				setReassertText(message);
				setError(message);
			}
		}, 2000);
	};

	const copy = async () => {
		const ok = await uiCopyText(payload());
		setCopyState(ok ? "已复制诊断 JSON 到剪贴板" : "复制失败：浏览器拒绝剪贴板，请手动选中导出文本");
		ctx.actions.setStatus(ok ? "已复制诊断 JSON" : "复制诊断 JSON 失败", ok ? "ok" : "bad");
	};

	const monoLine = { fontFamily: MISC_MONO, fontSize: "10.5px", color: UI_COLOR.textSecondary, wordBreak: "break-all" };
	const hintLine = { fontSize: "10.5px", lineHeight: 1.55, color: UI_COLOR.textTertiary };
	const blockStyle = uiStyle(UI_STYLE.subcard, { marginTop: "8px" });
	const reassertTextKind = reassertState === "ok" ? "ok" : (reassertState === "error" ? "bad" : "warn");
	return h(UICard, {
		rowId: "diagnostics",
		title: "14 · 诊断 / 共存",
		note: "§4.5 顺序/冲突自检：宿主版本、body 样式顺序、晚于本引擎的样式表、dream-skin 存在性、三栏布局、token 差异与「被谁覆盖」推测。「以本主题为准」= engine.reassert()（允许叠层的第四时机），点击后 2 秒只读复检（不再次叠层）。",
		"data-reassert-state": reassertState,
		"data-reassert-result": JSON.stringify(reassertResult),
		actions: [
			h(UIButton, { key: "reassert", "data-dshte-action": "reassert", onClick: reassert, primary: true }, "以本主题为准"),
			h(UIButton, { key: "copy", "data-dshte-action": "copy-diag", onClick: () => { void copy(); } }, "复制诊断 JSON"),
			h(UIButton, { key: "probe", "data-dshte-action": "probe", onClick: () => { try { if (ctx.engine && typeof ctx.engine.probe === "function") ctx.engine.probe(); ctx.actions.refresh(); } catch (error) { setError(String((error && error.message) || error)); } } }, "重新探测")
		]
	},
		h("div", { "data-dshte-diag": "summary", style: { display: "grid", gap: "1px" } },
			...pairs.map((pair) => h("div", { key: pair[0], style: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "11px", lineHeight: 1.7 } },
				h("span", { style: { minWidth: "118px", color: UI_COLOR.textTertiary, flex: "0 0 auto" } }, pair[0]),
				h("span", { style: { fontFamily: MISC_MONO, fontSize: "10.5px", color: UI_COLOR.textSecondary, wordBreak: "break-all", minWidth: 0 } }, pair[1])))),
		h("div", { "data-dshte-diag": "host", "data-host-available": hostAvailable === true ? "true" : hostAvailable === false ? "false" : "null", style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "宿主 / ping"),
			h("div", { style: monoLine }, hostAvailable === true
				? "可用 · v" + String(host.version || "?") + " · pid " + String(host.pid === null || host.pid === undefined ? "?" : host.pid)
				: hostAvailable === false
					? "不可用（" + String(host.lastError || "未知错误") + "）"
					: "未探测 / 未就绪")),
		h("div", { "data-dshte-diag": "order-health", "data-order-health": orderHealth, style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "样式顺序自检：" + orderHealth),
			h("div", { style: hintLine }, orderNote || "无法判断")),
		h("div", { "data-dshte-diag": "late-styles", style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "更晚的样式表（" + String(lateStyles.length) + "）"),
			lateStyles.length === 0
				? h("div", { style: hintLine }, "无（body 内没有晚于 #dshte-pack-css 的非本引擎样式）")
				: h("div", { style: { display: "grid", gap: "2px" } }, ...lateStyles.slice(0, 8).map((entry, index) => h("div", {
					key: "late" + index,
					"data-late-style": "",
					style: monoLine
				}, String(entry.source || entry.pluginCss || entry.id || "(anon)") + " · " + String(entry.bytes || 0) + " B")))),
		h("div", { "data-dshte-diag": "mismatch", "data-mismatch-count": String(mismatchCount), style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "被外部覆盖的 token（" + String(mismatchCount) + "）"),
			mismatchCount === 0
				? h("div", { style: hintLine }, "无差异：本主题 token 已全部生效")
				: h("div", { style: { display: "grid", gap: "2px" } }, ...mismatch.slice(0, 12).map((entry) => h("div", {
					key: entry.name,
					"data-mismatch-token": "",
					"data-suspected": String(entry.suspected || ""),
					style: { fontFamily: MISC_MONO, fontSize: "10.5px", color: UI_COLOR.warn, wordBreak: "break-all" }
				}, String(entry.name) + "  期望 " + String(entry.expected) + "  实际 " + String(entry.actual) + " · 推测：" + String(entry.suspected || "未知"))))),
		h("div", { "data-dshte-diag": "layout", "data-layout-untouched": layoutUntouched === true ? "true" : layoutUntouched === false ? "false" : "null", style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "三栏布局自检"),
			h("div", { style: hintLine },
				"拖动把手：" + (layout.handlePresent === true ? "在" : layout.handlePresent === false ? "缺失" : "未知")
				+ " · frame grid：" + (layoutUntouched === true ? "宿主 3 轨形状（未被改写）" : layoutUntouched === false ? "已不是宿主 3 轨形状" : "未知")
				+ " · 引擎只读不写布局"),
			autoAlertActive
				? h("div", { role: "alert", style: { marginTop: "4px", fontSize: "11px", lineHeight: 1.6, color: UI_COLOR.danger } },
					"检测到三栏布局被外部改写，已自动进入安全模式" + (layout.alert && layout.alert.at ? "（" + String(layout.alert.at) + "）" : "") + "；请先关闭会改布局的插件或外观层，再到「高级」行关闭安全模式。")
				: null),
		h("div", { "data-dshte-diag": "dreamskin", "data-dreamskin": dreamSkin.detected === true ? "detected" : "absent", style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "dream-skin 共存"),
			h("div", { style: hintLine },
				(dreamSkin.detected === true ? "检测到（共存）" : "未检测到")
				+ " · CSS 皮肤：" + (dreamSkin.cssSkin === true ? "有" : "无")
				+ " · 桥：" + (dreamSkin.bridge === true ? "有" : "无")
				+ " · 材质：" + (dreamSkin.materialStyle === true ? "有" : "无（无可靠判据）")
				+ "。只做存在性判断，不读其样式内容、不调用它的桥。")),
		h("div", { "data-dshte-diag": "safe-mode", "data-safe-mode": diag.safeMode === true ? "on" : "off", style: blockStyle },
			h("div", { style: UI_STYLE.subtitle }, "安全模式终态"),
			h("div", { style: hintLine }, diag.safeMode === true
				? "开 · override 层已撤销（layerCount=" + String(diag.layerCount) + "）、dshte-vars/pack-css/fonts/preview/user-css 全部移除；static engine CSS 保留但规则全部 opt-in → 页面 = 宿主原生外观；localStorage[\"dshte:safe:v1\"] 持久化，刷新后仍保持。"
				: "关 · 本引擎正常工作；需要保命时点「高级」行的「开启安全模式」。")),
		reassertText ? h(UIStatus, { kind: reassertTextKind, style: { display: "block", marginTop: "6px" } }, reassertText) : null,
		copyState ? h(UIStatus, { kind: copyState.indexOf("已") === 0 ? "ok" : "bad", style: { display: "block", marginTop: "6px" } }, copyState) : null,
		error ? h(UIError, { style: { display: "block", marginTop: "6px" } }, error) : null,
		ctx.store && typeof ctx.store.snapshot === "function"
			? h("details", { style: { marginTop: "8px" } },
				h("summary", { style: { fontSize: "11px", color: UI_COLOR.textTertiary, cursor: "pointer" } }, "store.snapshot()（不含 token 值）"),
				h("pre", { style: { margin: "4px 0 0", padding: "7px 9px", borderRadius: "7px", background: UI_COLOR.surface2, fontFamily: MISC_MONO, fontSize: "10px", lineHeight: 1.55, overflow: "auto", maxHeight: "180px" } },
					JSON.stringify(snapshot, null, 2)))
			: null
	);
}

/* ── row 15: advanced (safe mode / clear cache / reload / paths) ────────── */

function RowAdvanced(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const [confirm, setConfirm] = React.useState(null);
	const [busy, setBusy] = React.useState(false);
	const [info, setInfo] = React.useState(null);
	const [error, setError] = React.useState(null);
	const [ping, setPing] = React.useState(null);
	const [copyState, setCopyState] = React.useState(null);

	React.useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				const response = await fetch("/dsh-tavern-skin/ping", { credentials: "same-origin" });
				const data = await response.json();
				if (alive) setPing(data && typeof data === "object" ? data : { error: "ping 返回格式异常" });
			} catch (error) {
				if (alive) setPing({ error: String((error && error.message) || error) });
			}
		})();
		return () => { alive = false; };
	}, []);

	const version = typeof VERSION === "string" && /^\d+\.\d+\.\d+/.test(VERSION) ? VERSION : "0.1.0";
	const origin = (() => { try { return String(window.location.origin); } catch (error) { return "?"; } })();
	const dataDir = ping && typeof ping.state === "string" ? ping.state : (ping && ping.error ? "不可用：" + String(ping.error) : "读取中…");
	const pathsText = "dsh-tavern-skin-engine v" + version + "\ndata dir: " + dataDir + "\norigin: " + origin + "\nping: " + (ping && ping.version ? "v" + ping.version + " · pid " + ping.pid : "不可用");

	const clearCache = async () => {
		setConfirm(null);
		setBusy(true);
		setError(null);
		setInfo(null);
		const removed = [];
		const kept = [];
		try {
			if (ctx.store && typeof ctx.store.clearLocalCache === "function") {
				const result = await ctx.store.clearLocalCache();
				if (result && Array.isArray(result.removed)) removed.push(...result.removed);
				if (result && Array.isArray(result.kept)) kept.push(...result.kept);
				if (result && result.error) setError("清缓存部分失败：" + String(result.error));
			} else {
				setError("store.clearLocalCache 尚未就绪（engine-core 正在实现）");
			}
			try { if (ctx.engine && typeof ctx.engine.setUserCss === "function") ctx.engine.setUserCss(""); } catch (error) { /* ignore */ }
			try { if (ctx.engine && typeof ctx.engine.reloadPack === "function") await ctx.engine.reloadPack(); } catch (error) {
				setError("重新加载主题包失败：" + String((error && error.message) || error));
			}
			setInfo("已清本地缓存：删除 [" + (removed.join(", ") || "无") + "]；保留 [" + (kept.join(", ") || "—") + "]；随后从宿主 state.json 恢复。安全模式开关（dshte:safe:v1）保留。");
			ctx.actions.setStatus("已清本地缓存并从宿主恢复", "ok");
		} catch (error) {
			setError("清缓存异常：" + String((error && error.message) || error));
		} finally {
			setBusy(false);
		}
	};

	const reload = async () => {
		setBusy(true);
		setError(null);
		try {
			if (ctx.engine && typeof ctx.engine.reloadPack === "function") {
				await ctx.engine.reloadPack();
				setInfo("已重新加载主题包");
				ctx.actions.setStatus("已重新加载主题包", "ok");
			} else {
				setError("engine.reloadPack 尚未就绪（engine-core 正在实现）");
			}
		} catch (error) {
			setError("重新加载失败：" + String((error && error.message) || error));
		} finally {
			setBusy(false);
		}
	};

	const copyPaths = async () => {
		const ok = await uiCopyText(pathsText);
		setCopyState(ok ? "已复制版本与路径" : "复制失败（浏览器拒绝剪贴板）");
	};

	return h(UICard, {
		rowId: "advanced",
		title: "15 · 高级",
		note: "保命与维护操作：安全模式 = 立即撤层（localStorage[\"dshte:safe:v1\"]=\"1\"，是保命开关）；清本地缓存与恢复默认一样需要行内二次确认。"
	},
		h("div", { style: uiStyle(UI_STYLE.row) },
			h(UIToggle, {
				"data-dshte-action": "safe-mode",
				pressed: ctx.safeMode === true,
				onClick: () => ctx.actions.toggleSafeMode()
			}, ctx.safeMode === true ? "关闭安全模式" : "开启安全模式"),
			h(UIButton, { "data-dshte-action": "clear-cache", danger: true, onClick: () => setConfirm("clear-cache"), disabled: busy }, "清本地缓存…"),
			h(UIButton, { "data-dshte-action": "reload-pack", onClick: () => { void reload(); }, disabled: busy }, busy ? "处理中…" : "重新加载主题包"),
			ctx.safeMode === true ? h(UIBadge, { bad: true }, "安全模式生效中") : h(UIBadge, { ok: true }, "正常模式")
		),
		ctx.safeMode === true
			? h("div", { "data-safe-mode-note": "", role: "status", style: { marginTop: "6px", fontSize: "11px", lineHeight: 1.6, color: UI_COLOR.danger } },
				"安全模式生效中：override 层已撤销（layerCount=0），dshte-vars / dshte-pack-css / dshte-fonts / dshte-preview / dshte-user-css 全部移除，页面 = 宿主原生外观；开关持久化在 localStorage[\"dshte:safe:v1\"]，刷新后仍保持。关闭后按 loadPack → apply → 自定义 CSS → 本机字体 的顺序恢复。")
			: null,
		confirm === "clear-cache" ? h(UIInlineConfirm, {
			id: "clear-cache",
			message: "确认清本地缓存？会删除 dshte:state:v1 / dshte:ui:v1 / dshte:userCss:v1 / dshte:userFonts:v1（保留 dshte:safe:v1），随后从宿主 state.json 恢复；自定义 CSS 与本机字体将丢失。",
			confirmLabel: busy ? "清理中…" : "确认清缓存",
			busy,
			onConfirm: () => { void clearCache(); },
			onCancel: () => setConfirm(null)
		}) : null,
		h("div", { "data-dshte-paths": "", style: uiStyle(UI_STYLE.subcard, { marginTop: "8px" }) },
			h("div", { style: UI_STYLE.titleRow },
				h("span", { style: UI_STYLE.subtitle }, "版本与路径"),
				h("span", { style: UI_STYLE.titleActions },
					h(UIButton, { onClick: () => { void copyPaths(); } }, "复制路径"),
					h(UIBadge, { ok: true }, "v" + version))),
			h("pre", { style: { margin: "4px 0 0", padding: "7px 9px", borderRadius: "7px", background: UI_COLOR.layer3, border: "1px solid " + UI_COLOR.border, fontFamily: MISC_MONO, fontSize: "10px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" } },
				pathsText),
			copyState ? h("div", { style: uiStyle(UI_STYLE.hint, { marginTop: "4px" }) }, copyState) : null,
			h("div", { style: uiStyle(UI_STYLE.hint, { marginTop: "4px" }) },
				"宿主 ping：" + (ping ? (ping.ok === true ? "ok · " + String(ping.plugin || "") + " v" + String(ping.version || "?") : "不可用：" + String(ping.error || "未知")) : "读取中…"))
		),
		error ? h(UIError, { style: { display: "block", marginTop: "6px" } }, error) : null,
		info ? h(UIStatus, { kind: "ok", style: { display: "block", marginTop: "6px" } }, info) : null
	);
}
