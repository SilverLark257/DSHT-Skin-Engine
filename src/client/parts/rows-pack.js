/**
 * Step 5 row 1–3 + Step 6 row 1 (内置包 + 用户包卡片): 主题包 / 预览小样 / 实时预览开关.
 * Contract §6.1 rows 1–3 + docs/step6-plan.md §4.2/§4.4.
 *
 * Row 1 renders BOTH built-in packs (embedded BUILTIN_PACKS) and user packs
 * (`packs.list` / store.packs(), the host-imported `packs/<id>/` directories).
 * Each card carries [data-dshte-pack="<id>"][data-dshte-pack-source="builtin|user"];
 * clicking a user card goes through the same store.set(activePackId) path and the
 * engine's existing remote `loadPack()` (store.api("packs.get")) applies it.
 */

function RowPack(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const state = ctx.state || {};
	const enabled = state.enabled !== false;
	const packs = ctx.packs && typeof ctx.packs === "object" ? ctx.packs : { builtin: [], user: [] };
	const builtinIds = Object.keys(BUILTIN_PACKS || {});
	const userMetas = (Array.isArray(packs.user) ? packs.user : []).filter((meta) => meta && typeof meta.id === "string");
	const known = new Set(builtinIds);
	for (const meta of userMetas) known.add(meta.id);
	const missingPack = !!state.activePackId && !known.has(state.activePackId);

	const builtinCards = builtinIds.map((id) => {
		const entry = BUILTIN_PACKS[id] || {};
		const pack = entry.pack || {};
		const preview = pack.preview || {};
		const active = enabled && state.activePackId === id;
		const authorName = pack.author && typeof pack.author === "object" ? pack.author.name : pack.author;
		return h("button", {
			key: "builtin:" + id,
			type: "button",
			"data-dshte-pack": id,
			"data-dshte-pack-source": "builtin",
			"aria-pressed": active,
			title: "应用内置主题包 " + id,
			onClick: () => ctx.actions.activatePack(id),
			style: uiStyle(
				UI_STYLE.packCard,
				active ? UI_STYLE.packCardActive : null
			)
		},
			h("span", {
				style: {
					width: "34px",
					height: "34px",
					flex: "0 0 auto",
					borderRadius: "9px",
					background: preview.bg || "var(--dsw-alias-bg-layer-2, #eee)",
					border: "2px solid " + (preview.accent || "var(--dsw-alias-border-l2, #bbb)"),
					boxShadow: "inset 0 -10px 0 -6px " + (preview.fg || "#333")
				}
			}),
			h("span", { style: { display: "grid", gap: "1px", minWidth: 0, textAlign: "left" } },
				h("span", { style: { fontSize: "12px", fontWeight: 600, color: UI_COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					pack.nameZh || pack.name || id),
				h("span", { style: { fontSize: "10px", color: UI_COLOR.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					id + " · " + String(pack.colorScheme || "?") + (pack.release ? " · v" + pack.release : "")),
				h("span", { style: { fontSize: "10px", color: UI_COLOR.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					(active ? "当前使用中" : "点击应用") + (authorName ? " · " + authorName : "") + " · 内置")
			),
			active ? h("span", { style: uiStyle(UI_STYLE.badge, UI_STYLE.badgeOk, { marginLeft: "auto" }) }, "使用中") : null
		);
	});

	const userCards = userMetas.map((meta) => {
		const preview = meta.preview && typeof meta.preview === "object" ? meta.preview : {};
		const active = enabled && state.activePackId === meta.id;
		const authorName = meta.author && typeof meta.author === "object" ? meta.author.name : meta.author;
		return h("button", {
			key: "user:" + meta.id,
			type: "button",
			"data-dshte-pack": meta.id,
			"data-dshte-pack-source": "user",
			"aria-pressed": active,
			title: "应用用户主题包 " + meta.id,
			onClick: () => ctx.actions.activatePack(meta.id),
			style: uiStyle(
				UI_STYLE.packCard,
				active ? UI_STYLE.packCardActive : null,
				{ borderStyle: "dashed" }
			)
		},
			h("span", {
				style: {
					width: "34px",
					height: "34px",
					flex: "0 0 auto",
					borderRadius: "9px",
					background: preview.bg || "var(--dsw-alias-bg-layer-2, #eee)",
					border: "2px dashed " + (preview.accent || "var(--dsw-alias-border-l2, #bbb)"),
					boxShadow: "inset 0 -10px 0 -6px " + (preview.fg || "#333")
				}
			}),
			h("span", { style: { display: "grid", gap: "1px", minWidth: 0, textAlign: "left" } },
				h("span", { style: { fontSize: "12px", fontWeight: 600, color: UI_COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					meta.nameZh || meta.name || meta.id),
				h("span", { style: { fontSize: "10px", color: UI_COLOR.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					meta.id + " · " + String(meta.colorScheme || "?") + (meta.release ? " · v" + meta.release : "")),
				h("span", { style: { fontSize: "10px", color: UI_COLOR.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					(active ? "当前使用中" : "点击应用") + (authorName ? " · " + authorName : "") +
					(meta.bytes ? " · " + uiFormatBytes(Number(meta.bytes) || 0) : ""))
			),
			h("span", { style: uiStyle(UI_STYLE.badge, UI_STYLE.badgeWarn, { marginLeft: "auto" }) }, "用户包"),
			active ? h("span", { style: uiStyle(UI_STYLE.badge, UI_STYLE.badgeOk) }, "使用中") : null
		);
	});

	const cards = builtinCards.concat(userCards);

	const refreshPacks = () => {
		if (!ctx.actions || typeof ctx.actions.refreshPacks !== "function") return;
		void ctx.actions.refreshPacks();
	};

	const titleActions = [
		h(UIButton, {
			key: "refresh",
			"data-dshte-action": "packs-refresh",
			onClick: refreshPacks,
			title: "重新读取 packs.list / trash.list（导入或删除后自动刷新）"
		}, "刷新包列表"),
		h(UIButton, {
			key: "toggle",
			"data-dshte-action": "disable",
			onClick: () => ctx.actions.toggleEnabled(),
			title: enabled ? "停用皮肤，恢复 Tavern 原生外观" : "重新启用皮肤"
		}, enabled ? "停用皮肤" : "启用皮肤"),
		h(UIBadge, { key: "badge", ok: enabled, warn: !enabled }, enabled ? "已启用" : "已停用（原生外观）")
	];

	const warnings = [];
	if (missingPack) {
		warnings.push(h("div", { key: "missing", style: uiStyle(UI_STYLE.warnText, { marginTop: "6px" }) },
			"当前 activePackId「" + state.activePackId + "」在内置包与用户包里都不存在（可能是旧版本残留 / 包已被删除），已按「回退原生外观」处理；重新选一个包或恢复默认即可。"));
	}
	if (cards.length === 0) {
		warnings.push(h("div", { key: "none", style: UI_STYLE.warnText }, "客户端没有任何内置包。"));
	}

	return h(UICard, {
		rowId: "pack",
		title: "1 · 主题包",
		actions: titleActions,
		note: "卡片 = 完全的 button（键盘 Tab + Enter 切换），aria-pressed 标出当前包。内置 " + builtinIds.length + " 个 · 用户导入 " + userMetas.length + " 个；用户包点击后经引擎已有的远程 loadPack（packs.get）应用。"
	},
		h(UIGrid, null, cards),
		...warnings
	);
}

function RowPreview(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	return h(UICard, {
		rowId: "preview",
		title: "2 · 预览小样",
		note: "三栏比例示意（281px / 中栏 / 右栏），只读当前草稿 + 包 token 渲染：不加载 iframe、不读真实 DOM、不改变真实列宽与拖动。迷你预览始终随草稿即时变化，与下方「实时预览」开关无关。"
	},
		h(PreviewSample, {
			pack: ctx.pack,
			overrides: ctx.draft ? ctx.draft.overrides : null,
			scheme: (ctx.diag && ctx.diag.scheme) || "light"
		})
	);
}

function RowPreviewLive(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const diag = ctx.diag || {};
	const preview = diag.preview && typeof diag.preview === "object" ? diag.preview : null;
	const live = ctx.previewLive === true;
	const info = ctx.previewInfo && typeof ctx.previewInfo === "object" ? ctx.previewInfo : null;
	let infoText = null;
	let infoKind = "ok";
	if (info) {
		if (info.ok === true) {
			infoText = "预览已生效：与已提交值不同的 host token " + String(info.hostDiffCount === undefined ? "?" : info.hostDiffCount) + " 个 · set token " + String(info.setTokens === undefined ? "?" : info.setTokens) + " 项";
		} else if (info.reason === "off") {
			infoText = "实时预览关闭中：草稿只反映在迷你小样里，全页保持已提交值。";
			infoKind = "muted";
		} else if (info.reason === "safe-mode") {
			infoText = "预览未生效：安全模式开启中（引擎已撤层），关闭安全模式后再试。";
			infoKind = "bad";
		} else if (info.reason === "inactive") {
			infoText = "预览未生效：引擎尚未完成初始化（boot 未完成 / 没有主题服务），迷你小样仍然跟随草稿。";
			infoKind = "warn";
		} else if (info.reason) {
			infoText = "预览未生效：" + String(info.reason);
			infoKind = "bad";
		}
	}
	return h(UICard, {
		rowId: "preview-live",
		title: "3 · 实时预览",
		actions: [
			h(UIToggle, {
				key: "toggle",
				pressed: live,
				"data-dshte-action": "preview-live",
				onClick: () => ctx.actions.togglePreviewLive(),
				title: live ? "关闭后只在迷你小样里预览" : "开启后草稿会在 100ms 内作用到整个页面"
			}, live ? "实时预览：开" : "实时预览：关"),
			h(UIBadge, { key: "state", ok: live, warn: !live }, live ? "全页跟随" : "只改小样")
		],
		note: "开启时，草稿改动经 16ms 去抖后调用 engine.preview()：只重写 #dshte-vars / #dshte-preview 的内容，绝不调用 overrideTokens、不叠新层、不写 state。关闭时只更新迷你小样。点「应用」才会真正落到 state.overrides。"
	},
		infoText ? h("div", {
			"data-dshte-preview-info": info.ok === true ? "ok" : String(info.reason || "error"),
			style: uiStyle(
				UI_STYLE.hint,
				{ marginTop: "4px" },
				infoKind === "bad" ? { color: UI_COLOR.danger } : infoKind === "warn" ? { color: UI_COLOR.warn } : infoKind === "ok" ? { color: UI_COLOR.ok } : null
			)
		}, infoText) : null,
		preview ? h("div", { style: uiStyle(UI_STYLE.hint, { marginTop: "4px" }) },
			"engine 侧预览：" + (preview.active ? "进行中" : "无") +
			" · 与已提交值不同的 host token " + String(preview.hostDiffCount === undefined ? "?" : preview.hostDiffCount) +
			(preview.at ? " · " + String(preview.at) : "")) : null
	);
}
