/**
 * Step 5 rows 7–10: 方案与深色 / 颜色 / 字体 / 形状.
 * Contract §6.1 rows 7–10 + the §6 data-attribute table.
 *
 * Every editable row here works on the shared draft (`ctx.draft`) and never
 * writes the store directly — only 「应用」 commits (契约 §6 lifecycle).
 */

/* ── generic knob field (rows 9–12 share it) ─────────────────────────────── */

/** Effective value: draft override (either scheme) → compiled pack default. */
function themeEntryCurrent(ctx, entry) {
	const override = uiDraftGet(ctx.draft, ["light", "dark"], entry.token);
	if (override !== undefined) return override;
	if (entry.defaultValue !== undefined && entry.defaultValue !== null) return String(entry.defaultValue);
	return "";
}

function themeResetTokens(ctx, entries) {
	ctx.actions.updateOverrides((overrides) => {
		let next = overrides;
		for (const entry of entries) next = withTokenOverride(next, ["light", "dark"], entry.token, null);
		return next;
	});
}

function themeWeightOptions() {
	const options = [];
	for (let weight = 100; weight <= 900; weight += 100) options.push([String(weight), String(weight)]);
	return options;
}

function themeNumericText(value, kind) {
	if (kind === "length") {
		const number = uiLengthNumber(value);
		return number === null ? String(value === undefined || value === null ? "" : value) : String(number);
	}
	return String(value === undefined || value === null ? "" : value);
}

/**
 * One knob control bound to the shared draft (written to light+dark because the
 * values are scheme-independent, 契约 §2.1).
 */
function KnobField(props) {
	const ctx = props.ctx;
	const entry = props.entry;
	const h = React.createElement;
	const [error, setError] = React.useState(null);
	const kind = entry.kind || "text";
	const override = uiDraftGet(ctx.draft, ["light", "dark"], entry.token);
	const current = themeEntryCurrent(ctx, entry);
	const defaultText = entry.defaultValue === undefined || entry.defaultValue === null ? "" : String(entry.defaultValue);
	const commit = (raw) => {
		const result = normalizeKnobValue(kind, raw);
		if (!result || !result.ok) { setError((result && result.error) || "值不合法"); return; }
		setError(null);
		ctx.actions.updateOverrides((overrides) => withTokenOverride(overrides, ["light", "dark"], entry.token, result.value));
	};
	const reset = () => {
		setError(null);
		ctx.actions.updateOverrides((overrides) => withTokenOverride(overrides, ["light", "dark"], entry.token, null));
	};
	const numericKind = kind === "length" || kind === "number" || kind === "lineHeight" || kind === "opacity";
	const rangeAllowed = props.withRange === true && entry.min !== undefined && entry.max !== undefined && numericKind;
	const controls = [];
	const knobAttributes = { "data-dshte-knob": entry.token, "aria-label": entry.label + "（" + entry.token + "）" };

	if (kind === "color") {
		const hex = uiHexColor(current) || uiHexColor(entry.defaultValue) || "#000000";
		controls.push(h("input", {
			key: "color",
			type: "color",
			"data-dshte-color": entry.token,
			"aria-label": entry.label + " 颜色选择",
			value: hex,
			onChange: (event) => commit(event.target.value),
			style: { width: "26px", height: "22px", padding: 0, border: "1px solid " + UI_COLOR.border, borderRadius: "5px", background: "transparent", cursor: "pointer" }
		}));
		controls.push(h(UIInput, {
			key: "text",
			value: current,
			onInput: commit,
			placeholder: defaultText ? "默认 " + defaultText : "未设置",
			style: { width: "132px" },
			...knobAttributes
		}));
	} else if (kind === "weight") {
		controls.push(h(UISelect, {
			key: "select",
			value: String(current || ""),
			onChange: commit,
			options: themeWeightOptions(),
			style: { width: "82px" },
			...knobAttributes
		}));
	} else if (kind === "enum") {
		const options = Array.isArray(entry.options) && entry.options.length > 0 ? entry.options : [["", "（默认）"]];
		controls.push(h(UISelect, {
			key: "select",
			value: String(current || options[0][0]),
			onChange: commit,
			options,
			style: { width: "112px" },
			...knobAttributes
		}));
	} else if (numericKind) {
		controls.push(h(UIInput, {
			key: "number",
			value: themeNumericText(current, kind),
			onInput: commit,
			inputMode: "decimal",
			placeholder: defaultText ? "默认 " + defaultText : "未设置",
			style: { width: "76px" },
			...knobAttributes
		}));
		if (rangeAllowed) {
			controls.push(h(UIRange, {
				key: "range",
				value: uiLengthNumber(current) === null ? entry.min : uiLengthNumber(current),
				min: entry.min,
				max: entry.max,
				step: entry.step === undefined ? 1 : entry.step,
				onInput: commit,
				"data-dshte-range": entry.token,
				"aria-label": entry.label + " 滑杆"
			}));
		}
	} else {
		controls.push(h(UIInput, {
			key: "text",
			value: current,
			onInput: commit,
			placeholder: defaultText ? "默认 " + defaultText : "未设置",
			style: { width: props.wide ? "100%" : "210px" },
			...knobAttributes
		}));
	}

	return h("div", { style: { display: "grid", gap: "2px", padding: "3px 0", borderBottom: "1px dashed var(--dsw-alias-border-l1, rgba(90,86,80,.14))" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
			h("span", { style: { display: "grid", gap: 0, minWidth: props.labelWidth || "132px", maxWidth: "190px" } },
				h("span", { style: UI_STYLE.labelSmall }, entry.label),
				h("span", { style: UI_STYLE.tokenName }, entry.token)
			),
			...controls,
			h(UIButton, {
				onClick: reset,
				disabled: override === undefined,
				title: "删除覆盖，恢复包默认值",
				"data-dshte-knob-reset": entry.token,
				style: { padding: "2px 7px", fontSize: "10.5px" }
			}, "默认")
		),
		error ? h(UIError, null, error) : null,
		override === undefined && defaultText && kind !== "color" && kind !== "weight" && kind !== "enum" && !numericKind
			? h("span", { style: uiStyle(UI_STYLE.tokenName, { paddingLeft: "140px" }) }, "包默认：" + defaultText) : null
	);
}

/* ── row 7: scheme & dark mode ──────────────────────────────────────────── */

function RowScheme(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const diag = ctx.diag || {};
	const pack = ctx.pack || {};
	const state = ctx.state || {};
	const packScheme = pack.colorScheme === "dark" ? "dark" : "light";
	const effective = state.schemePolicy === "mirror" || state.schemePolicy === "inherit"
		? state.schemePolicy
		: (pack.missingScheme === "inherit" ? "inherit" : "mirror");
	return h(UICard, {
		rowId: "scheme",
		title: "7 · 方案与深色",
		note: "mirror：宿主切到深色时沿用同一套 token（包内 dark 缺省则镜像 light）；inherit：宿主方案与包方案不一致时自动撤掉本引擎的层，交回宿主原生外观。策略是即时提交项（不进草稿）。"
	},
		h(UIRow, { label: "包内方案" },
			h(UIMono, null, "colorScheme: " + packScheme),
			h(UIBadge, { ok: packScheme === "light" }, packScheme === "dark" ? "深色设计" : "浅色设计")),
		h(UIRow, { label: "宿主当前方案" },
			h("span", { "data-dshte-scheme-now": "" }, String(diag.scheme || "light")),
			h(UIBadge, null, "只读，来自 theme.getTheme()")),
		h(UIRow, { label: "深色策略" },
			h(UIToggle, {
				pressed: effective === "mirror",
				"data-dshte-policy": "mirror",
				onClick: () => ctx.actions.setSchemePolicy("mirror")
			}, "mirror · 深色镜像"),
			h(UIToggle, {
				pressed: effective === "inherit",
				"data-dshte-policy": "inherit",
				onClick: () => ctx.actions.setSchemePolicy("inherit")
			}, "inherit · 自动撤层"),
			h(UIBadge, { warn: effective === "inherit" }, "生效：" + effective)),
		h(UIRow, { label: "引擎内部策略" }, h(UIMono, null, String(diag.policy || "?"))),
		state.schemePolicy === null || state.schemePolicy === undefined
			? h(UINote, null, "当前 state.schemePolicy = null（跟随包内 missingScheme 的默认值）。点击上面的按钮会写入显式策略。")
			: null
	);
}

/* ── row 8: colors ──────────────────────────────────────────────────────── */

function themeHexLuminance(hex) {
	const value = uiHexColor(hex);
	if (!value) return null;
	const channels = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255).map((channel) => (channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)));
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function themeContrastRatio(hexA, hexB) {
	const first = themeHexLuminance(hexA);
	const second = themeHexLuminance(hexB);
	if (first === null || second === null) return null;
	const high = Math.max(first, second);
	const low = Math.min(first, second);
	return (high + 0.05) / (low + 0.05);
}

function themeContrastWarning(ctx, scheme) {
	const model = ctx.model;
	if (!model || !model.colors || !Array.isArray(model.colors[scheme])) return null;
	const groups = model.colors[scheme];
	const find = (name) => {
		for (const group of groups) {
			for (const token of group.tokens) if (token.name === name) return token;
		}
		return null;
	};
	const foreground = find("--dsw-alias-label-primary");
	const background = find("--dsw-alias-bg-base");
	if (!foreground || !background) return null;
	const effective = (token) => {
		const override = uiDraftGet(ctx.draft, [scheme], token.name);
		return override !== undefined ? override : token.value;
	};
	const ratio = themeContrastRatio(effective(foreground), effective(background));
	if (ratio === null) return null;
	return { ratio, ok: ratio >= 4.5 };
}

function ColorTokenRow(props) {
	const ctx = props.ctx;
	const scheme = props.scheme;
	const token = props.token;
	const h = React.createElement;
	const [error, setError] = React.useState(null);
	const override = overrideValue(ctx.draft ? ctx.draft.overrides : null, scheme, token.name);
	const current = override !== undefined ? override : (token.value === undefined || token.value === null ? "" : String(token.value));
	const kind = token.kind === "color" ? "color" : "text";
	const hex = uiHexColor(current) || uiHexColor(token.value) || "#000000";
	const commit = (raw) => {
		const result = normalizeKnobValue(kind, raw);
		if (!result || !result.ok) { setError((result && result.error) || "值不合法"); return; }
		setError(null);
		ctx.actions.updateOverrides((overrides) => withTokenOverride(overrides, [scheme], token.name, result.value));
	};
	const reset = () => {
		setError(null);
		ctx.actions.updateOverrides((overrides) => withTokenOverride(overrides, [scheme], token.name, null));
	};
	return h("div", { "data-dshte-token": token.name, style: { display: "grid", gap: "1px", padding: "2px 0", minWidth: 0 } },
		h("div", { style: { display: "flex", alignItems: "baseline", gap: "5px", minWidth: 0 } },
			h("span", { style: uiStyle(UI_STYLE.labelSmall, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }) }, token.label || token.name),
			h("span", { style: uiStyle(UI_STYLE.tokenName, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }) }, token.name)
		),
		h("div", { style: UI_STYLE.controls },
			kind === "color" ? h("input", {
				key: "color",
				type: "color",
				"data-dshte-color": token.name,
				"aria-label": token.name + " 颜色选择",
				value: hex,
				onChange: (event) => commit(event.target.value),
				style: { width: "26px", height: "22px", padding: 0, border: "1px solid " + UI_COLOR.border, borderRadius: "5px", background: "transparent", cursor: "pointer" }
			}) : null,
			h(UIInput, {
				key: "value",
				value: current,
				onInput: commit,
				placeholder: "未覆盖（包默认）",
				"aria-label": token.name,
				"data-dshte-value": "",
				style: { width: "140px" }
			}),
			h(UIButton, {
				key: "reset",
				onClick: reset,
				disabled: override === undefined,
				"data-dshte-reset": "",
				title: "删除当前 scheme 的这个覆盖（恢复包默认）",
				style: { padding: "2px 7px", fontSize: "10.5px" }
			}, "复位"),
			override !== undefined ? h("span", { key: "badge", style: uiStyle(UI_STYLE.badge, { padding: "0 5px" }) }, "覆盖") : null,
			error ? h(UIError, { key: "error" }, error) : null
		)
	);
}

function RowColors(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const model = ctx.model;
	const scheme = ctx.editScheme === "dark" ? "dark" : "light";
	const diag = ctx.diag || {};
	const groups = model && model.colors && Array.isArray(model.colors[scheme]) ? model.colors[scheme] : [];
	const contrast = themeContrastWarning(ctx, scheme);
	const tokenCount = groups.reduce((total, group) => total + group.tokens.length, 0);
	const actions = [
		h(UIToggle, { key: "light", pressed: scheme === "light", "data-dshte-scheme": "light", onClick: () => ctx.actions.setEditScheme("light") }, "浅色 light"),
		h(UIToggle, { key: "dark", pressed: scheme === "dark", "data-dshte-scheme": "dark", onClick: () => ctx.actions.setEditScheme("dark") }, "深色 dark"),
		h(UIBadge, { key: "count", warn: true }, "编辑目标：" + scheme + " · " + tokenCount + " 个 token")
	];
	const body = [];
	if (!model) {
		body.push(h("div", { key: "none", style: UI_STYLE.warnText }, "没有可用的主题包模型：请先在第 1 行选择一个内置包（或恢复默认）。"));
	} else {
		for (const group of groups) {
			body.push(h("div", { key: group.key, style: uiStyle(UI_STYLE.subcard, { marginTop: "8px" }) },
				h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" } },
					h("span", { style: UI_STYLE.subtitle }, group.label + "（" + group.tokens.length + "）"),
					h(UIButton, {
						onClick: () => themeResetTokens(ctx, group.tokens),
						style: { padding: "2px 7px", fontSize: "10.5px" },
						title: "删除本组在当前 scheme 的全部覆盖"
					}, "本组复位")
				),
				h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "2px 14px" } },
					...group.tokens.map((token) => h(ColorTokenRow, { key: token.name, ctx, scheme, token })))
			));
		}
	}
	const contrastNode = contrast
		? h("div", { style: uiStyle(UI_STYLE.warnText, contrast.ok ? UI_STYLE.okText : null) },
			"文本对比度粗检（--dsw-alias-label-primary / --dsw-alias-bg-base，编辑目标 " + scheme + "）：" +
			contrast.ratio.toFixed(2) + ":1" + (contrast.ok ? "（≥ AA 4.5）" : "（低于 AA 4.5，仅提示不阻止）"))
		: null;
	return h(UICard, {
		rowId: "colors",
		title: "8 · 颜色",
		actions,
		note: "按当前编辑方案写入 overrides[" + scheme + "][token]（颜色是分方案值）；非颜色值（长度/var()/color-mix）只给文本框。复位 = 从该 scheme 删除覆盖，恢复包默认。改草稿只影响预览，点「应用」才落盘。"
	},
		...body,
		contrastNode,
		diag.scheme && diag.scheme !== scheme
			? h("div", { style: uiStyle(UI_STYLE.hint, { marginTop: "4px" }) },
				"提示：宿主当前是 " + String(diag.scheme) + "，你正在编辑 " + scheme + " 方案；两份方案互不影响。")
			: null
	);
}

/* ── row 9: typography ──────────────────────────────────────────────────── */

function themeListUserFonts(store) {
	const api = uiStoreUserFonts(store);
	if (!api || typeof api.list !== "function") return [];
	try {
		const list = api.list();
		return Array.isArray(list) ? list : [];
	} catch (error) { return []; }
}

function TypographyFontPanel(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const [error, setError] = React.useState(null);
	const [info, setInfo] = React.useState(null);
	const [busy, setBusy] = React.useState(false);
	const [fonts, setFonts] = React.useState(() => themeListUserFonts(ctx.store));
	const fileRef = React.useRef(null);
	const refresh = () => setFonts(themeListUserFonts(ctx.store));
	React.useEffect(() => { refresh(); }, []);

	const upload = async (file) => {
		setError(null);
		setInfo(null);
		if (!file) return;
		const name = String(file.name || "font");
		const extension = (name.split(".").pop() || "").toLowerCase();
		if (["woff2", "woff", "ttf", "otf"].indexOf(extension) < 0) {
			setError("只支持 woff2 / woff / ttf / otf（收到 " + (extension || "无扩展名") + "）");
			return;
		}
		if (file.size > 1.5 * 1024 * 1024) {
			setError("单文件上限 1.5 MB，当前 " + uiFormatBytes(file.size));
			return;
		}
		const api = uiStoreUserFonts(ctx.store);
		if (!api || typeof api.add !== "function") {
			setError("store.userFonts 尚未就绪（engine-core 正在实现），暂时不能上传本机字体");
			return;
		}
		setBusy(true);
		try {
			const before = typeof api.list === "function" ? api.list().map((item) => item.id) : [];
			const result = await api.add(file);
			if (result && result.ok === false) {
				setError("字体上传失败：" + (result.error || "未知错误"));
				return;
			}
			const after = typeof api.list === "function" ? api.list() : [];
			let added = null;
			for (const item of after) if (before.indexOf(item.id) < 0) { added = item; break; }
			if (!added && after.length > 0) added = after[after.length - 1];
			const family = result && typeof result.family === "string" && result.family
				? result.family
				: (added && added.family ? added.family : "dshte-user");
			const displayEntry = ctx.model && ctx.model.typography
				? ctx.model.typography.fonts.filter((entry) => entry.token === "--dshte-font-display")[0]
				: null;
			const base = displayEntry ? themeEntryCurrent(ctx, displayEntry) : "";
			const stack = "\"" + family + "\", " + (base || "sans-serif");
			const normalized = normalizeKnobValue("font", stack);
			if (normalized.ok) {
				ctx.actions.updateOverrides((overrides) => withTokenOverride(overrides, ["light", "dark"], "--dshte-font-display", normalized.value));
				setInfo("已加入本机字体 " + family + "（" + uiFormatBytes(added && added.bytes ? added.bytes : file.size) + "），并写入草稿 --dshte-font-display；点「应用」后生效。");
			} else {
				setError("字体已上传，但组合字体栈失败：" + normalized.error);
			}
			refresh();
		} catch (error) {
			setError("字体上传异常：" + String((error && error.message) || error));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (font) => {
		setError(null);
		const api = uiStoreUserFonts(ctx.store);
		if (!api || typeof api.remove !== "function") { setError("store.userFonts.remove 尚未就绪"); return; }
		try {
			const ok = api.remove(font.id);
			if (ok === false) setError("删除本机字体失败：" + (font.fileName || font.id));
			refresh();
		} catch (error) {
			setError("删除本机字体异常：" + String((error && error.message) || error));
		}
	};

	return h("div", { style: uiStyle(UI_STYLE.subcard, { marginTop: "10px" }) },
		h("div", { style: UI_STYLE.titleRow },
			h("span", { style: UI_STYLE.subtitle }, "本机字体（浏览器 FontFace）"),
			h("span", { style: UI_STYLE.titleActions },
				h(UIButton, { onClick: () => { if (fileRef.current) fileRef.current.click(); }, disabled: busy, "data-dshte-font-upload": "" }, busy ? "上传中…" : "导入字体文件"),
				h("input", {
					ref: fileRef,
					type: "file",
					"data-dshte-file": "font",
					accept: ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf",
					style: { display: "none" },
					onChange: (event) => {
						const file = event.target.files && event.target.files[0];
						event.target.value = "";
						void upload(file);
					}
				})
			)
		),
		h("div", { "data-dshte-fonts": "" },
			fonts.length === 0
				? h("span", { style: UI_STYLE.hint }, "还没有本机字体。支持 woff2/woff/ttf/otf，单文件 ≤1.5 MB（总上限 4 MB）。")
				: fonts.map((font) => h("div", { key: font.id, style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "2px 0" } },
					h(UIMono, null, String(font.fileName || font.family || font.id)),
					h("span", { style: UI_STYLE.hint }, String(font.family || font.id) + " · " + uiFormatBytes(font.bytes)),
					h(UIButton, { onClick: () => { void remove(font); }, style: { padding: "1px 6px", fontSize: "10px" } }, "删除")
				))
		),
		error ? h(UIError, null, error) : null,
		info ? h(UIStatus, { kind: "ok", style: { display: "block", marginTop: "4px" } }, info) : null,
		h(UINote, null, "本机字体只存在浏览器（http://127.0.0.1 这个 origin 的 localStorage/FontFace）；Step 6 改存包内，换机器需重新导入。上传后把 --dshte-font-display 设成「新字体族 + 原字体栈」，两处 scheme 同时写入。")
	);
}

function RowTypography(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const model = ctx.model;
	if (!model) {
		return h(UICard, { rowId: "typography", title: "9 · 字体" },
			h("div", { style: UI_STYLE.warnText }, "没有可用的主题包模型：请先在第 1 行选择内置包。"));
	}
	const typography = model.typography;
	const group = (key, title, entries, withRange) => h("div", { key, style: uiStyle(UI_STYLE.subcard, { marginTop: "8px" }) },
		h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" } },
			h("span", { style: UI_STYLE.subtitle }, title + "（" + entries.length + "）"),
			h(UIButton, {
				onClick: () => themeResetTokens(ctx, entries),
				style: { padding: "2px 7px", fontSize: "10.5px" },
				title: "删除本组全部覆盖，恢复包默认"
			}, "本组复位")
		),
		...entries.map((entry) => h(KnobField, { key: entry.token, ctx, entry, withRange: withRange === true }))
	);
	return h(UICard, {
		rowId: "typography",
		title: "9 · 字体",
		note: "字体栈 / 字号 / 字重 / 行高 / 字距写入 --dshte-font-* / text-* / weight-* / leading-* / tracking-*。这些值与方案无关，草稿里同时写 light 和 dark。未覆盖任何值时显示包默认（来自编译后的 --dshte-* 实值）。注意：当前静态规则消费的是 font.sans / font.mono / text.body / leading.body / tracking.eyebrow；其余字号、字重、display、tight 目前只写入 vars + set token，需要主题包 / 自定义 CSS 消费才看得到全页变化（Step 6 扩展）——这不代表控件坏了。"
	},
		group("fonts", "字体栈", typography.fonts),
		group("sizes", "字号", typography.sizes, true),
		group("weights", "字重", typography.weights),
		group("leading", "行高", typography.leading, true),
		group("tracking", "字距", typography.tracking),
		h(TypographyFontPanel, { ctx })
	);
}

/* ── row 10: shape ──────────────────────────────────────────────────────── */

function RowShape(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const model = ctx.model;
	if (!model) {
		return h(UICard, { rowId: "shape", title: "10 · 形状" },
			h("div", { style: UI_STYLE.warnText }, "没有可用的主题包模型：请先在第 1 行选择内置包。"));
	}
	const shape = model.shape;
	const group = (key, title, entries, withRange, note) => h("div", { key, style: uiStyle(UI_STYLE.subcard, { marginTop: "8px" }) },
		h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" } },
			h("span", { style: UI_STYLE.titleActions },
				h("span", { style: UI_STYLE.subtitle }, title + "（" + entries.length + "）"),
				note ? h("span", { style: UI_STYLE.hint }, note) : null),
			h(UIButton, {
				onClick: () => themeResetTokens(ctx, entries),
				style: { padding: "2px 7px", fontSize: "10.5px" },
				title: "删除本组全部覆盖，恢复包默认"
			}, "本组复位")
		),
		...entries.map((entry) => h(KnobField, { key: entry.token, ctx, entry, withRange: withRange === true, wide: entry.kind === "text" }))
	);
	return h(UICard, {
		rowId: "shape",
		title: "10 · 形状",
		note: "圆角 / 间距 / 阴影写 --dshte-radius-* / space-* / shadow-*（baseVars，与方案无关，草稿同时写 light+dark）。数字控件与滑杆联动；「默认」删覆盖回包值。"
	},
		group("radii", "圆角", shape.radii, true, "radius"),
		group("spacing", "间距", shape.spacing, true, "space"),
		group("shadows", "阴影", shape.shadows, false, "shadow")
	);
}
