/**
 * Step 5 rows 11–12: 分区 / 组件.
 * Contract §6.1 rows 11–12 (+ the `data-dshte-missed` / `data-dshte-note` hooks).
 *
 * Both rows are selection-free: they edit --dshte-* base/recipe variables that are
 * opt-in through html[data-dshte-set~=…]; the values are scheme independent so the
 * draft writes them into light AND dark (契约 §2.1).
 */

function RowRegions(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const model = ctx.model;
	if (!model) {
		return h(UICard, { rowId: "regions", title: "11 · 分区" },
			h("div", { style: UI_STYLE.warnText }, "没有可用的主题包模型：请先在第 1 行选择内置包。"));
	}
	return h(UICard, {
		rowId: "regions",
		title: "11 · 分区",
		note: "只改视觉，不改变列宽与拖动：白名单属性 = 背景色 / 背景图 / 边线宽 / 阴影 / 透明度 / 背景模糊。布局属性（width、height、grid-template、display、position、transform…）不在白名单里，本行不提供；输入非法值会行内报错、不写草稿。"
	},
		...model.regions.map((region) => h("div", { key: region.key, style: uiStyle(UI_STYLE.subcard, { marginTop: "8px" }) },
			h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" } },
				h("span", { style: UI_STYLE.subtitle }, region.label + " · " + region.key),
				h("span", { style: UI_STYLE.titleActions },
					h(UIBadge, null, region.props.length + " 项"),
					h(UIButton, {
						onClick: () => themeResetTokens(ctx, region.props),
						style: { padding: "2px 7px", fontSize: "10.5px" },
						title: "删除本分区全部覆盖，恢复包默认"
					}, "本区复位")
				)
			),
			h("div", { style: uiStyle(UI_STYLE.hint, { marginBottom: "2px" }) },
				region.key === "center"
					? "背景图用 url(assets/images/…)，宿主会改写为 /dsh-tavern-skin/assets/builtin/<id>/…；CSS 变量（var(--dshte-…)）也可以直接填。"
					: "属性值可填颜色 / var(--dshte-…) / 长度 / 表达式；空 = 用包默认。"),
			...region.props.map((prop) => h(KnobField, {
				key: prop.token,
				ctx,
				entry: prop,
				withRange: prop.kind === "length" || prop.kind === "opacity",
				wide: prop.kind === "text",
				labelWidth: "150px"
			}))
		))
	);
}

function RowComponents(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const model = ctx.model;
	const diag = ctx.diag || {};
	const missed = Array.isArray(diag.componentsMissed) ? diag.componentsMissed : [];
	if (!model) {
		return h(UICard, { rowId: "components", title: "12 · 组件" },
			h("div", { style: UI_STYLE.warnText }, "没有可用的主题包模型：请先在第 1 行选择内置包。"));
	}
	const missedNodes = missed.length === 0
		? [h("span", { key: "none", style: uiStyle(UI_STYLE.okText, { fontSize: "10.5px" }) }, "未命中组件：无（全部组件钩子都命中）")]
		: missed.map((entry) => h("div", { key: entry.key + (entry.kind || ""), style: uiStyle(UI_STYLE.warnText, { fontSize: "10.5px" }) },
			"未命中（宿主哈希类漂移）：" + String(entry.key || "") + "（" + String(entry.label || "") + "） → " + (Array.isArray(entry.selectors) ? entry.selectors.join(" | ") : "")));
	return h(UICard, {
		rowId: "components",
		title: "12 · 组件",
		note: "11 个组件的白名单 knob（颜色 / 长度 / 数字 / 枚举）写 --dshte-<component>-<knob>。未命中组件是「漂移探针」，不等于报错：空会话/宿主升级时个别组件不存在属预期。"
	},
		h("div", { "data-dshte-note": "important", style: { padding: "7px 10px", marginBottom: "8px", borderRadius: "8px", border: "1px solid " + UI_COLOR.border, background: UI_COLOR.surface2, fontSize: "11px", lineHeight: 1.6, color: UI_COLOR.textSecondary } },
			"取舍说明：组件规则用更高特异性 + !important 压过 Tavern 自带 !important；代价是 hover/disabled 等状态色也跟随包（Step 4 取舍，验证记录 §9.4 第 1 条）。"),
		h("div", { "data-dshte-missed": "component", style: { display: "grid", gap: "1px", marginBottom: "8px" } }, ...missedNodes),
		...model.components.map((component) => h("div", { key: component.key, style: uiStyle(UI_STYLE.subcard, { marginTop: "8px" }) },
			h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" } },
				h("span", { style: UI_STYLE.subtitle }, component.label + " · " + component.key),
				h("span", { style: UI_STYLE.titleActions },
					h(UIBadge, null, component.knobs.length + " 项"),
					h(UIButton, {
						onClick: () => themeResetTokens(ctx, component.knobs),
						style: { padding: "2px 7px", fontSize: "10.5px" },
						title: "删除本组件全部覆盖，恢复包默认"
					}, "本组件复位")
				)
			),
			h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "0 16px" } },
				...component.knobs.map((knob) => h(KnobField, {
					key: knob.token,
					ctx,
					entry: knob,
					withRange: knob.kind === "length" || knob.kind === "lineHeight",
					wide: knob.kind === "text",
					labelWidth: "118px"
				})))
		))
	);
}
