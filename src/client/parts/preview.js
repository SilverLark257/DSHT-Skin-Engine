/**
 * Step 5 mini three-column preview sample (classic-script fragment, no exports).
 *
 * Contract §6.1 row 2:比例示意 281px / 1fr / 右栏，含头部、正文卡、引用块、按钮、
 * 输入坞；全部用「当前草稿 + 包 token」以内联 CSS 变量渲染（wrapper 上挂
 * `--*` 自定义属性，子元素用 `var()`），不读真实 DOM、不加载 iframe，也不改变
 * 真实列宽。行内预览永远随 draft 即时重渲染（与实时预览开关无关）。
 */

/** Merge pack tokens + compiled recipe vars + draft overrides into one var map. */
function previewCssVars(pack, overrides, scheme) {
	const vars = {};
	const target = scheme === "dark" ? "dark" : "light";
	const tokens = pack && pack.tokens && typeof pack.tokens === "object"
		? (pack.tokens[target] || pack.tokens.light || pack.tokens.dark || {})
		: {};
	for (const key of Object.keys(tokens)) {
		if (key.indexOf("--") === 0) vars[key] = String(tokens[key]);
	}
	try {
		if (pack) {
			const base = compilePackBaseVars(pack);
			for (const key of Object.keys(base)) vars[key] = String(base[key]);
			const recipe = compileRecipes(pack);
			const recipeVars = recipe && recipe.vars ? recipe.vars.light || {} : {};
			for (const key of Object.keys(recipeVars)) vars[key] = String(recipeVars[key]);
		}
	} catch (error) { /* pack may be mid-edit; the sample still renders */ }
	const draftOverrides = overrides && typeof overrides === "object" ? overrides : {};
	const isHost = (name) => (typeof isHostToken === "function" ? isHostToken(name) : /^--(dsw|dsh-tavern)-/.test(name));
	const other = target === "dark" ? "light" : "dark";
	// Scheme-independent overrides (typography/shape/regions/components write both).
	for (const block of [draftOverrides[target], draftOverrides[other]]) {
		if (!block || typeof block !== "object") continue;
		for (const key of Object.keys(block)) {
			if (key.indexOf("--") !== 0 || isHost(key)) continue;
			vars[key] = String(block[key]);
		}
	}
	// Host tokens are scheme specific: only the sample's scheme applies.
	const hostBlock = draftOverrides[target];
	if (hostBlock && typeof hostBlock === "object") {
		for (const key of Object.keys(hostBlock)) {
			if (key.indexOf("--") === 0 && isHost(key)) vars[key] = String(hostBlock[key]);
		}
	}
	return vars;
}

function PreviewSample(props) {
	const h = React.createElement;
	const scheme = props.scheme === "dark" ? "dark" : "light";
	const vars = previewCssVars(props.pack, props.overrides, scheme);
	const frame = uiStyle(vars, {
		display: "grid",
		gridTemplateColumns: "281px minmax(0, 1fr) 230px",
		minHeight: "214px",
		borderRadius: "12px",
		overflow: "hidden",
		border: "1px solid var(--dshte-border-hairline, rgba(0, 0, 0, 0.14))",
		background: "var(--dsw-alias-bg-base, var(--dshte-bg-base, #f3efe9))",
		color: "var(--dsw-alias-label-primary, var(--dshte-fg-body, #333333))",
		fontFamily: "var(--dshte-font-sans, sans-serif)",
		fontSize: "11px",
		lineHeight: 1.5
	});
	return h("div", { "data-dshte-preview": "sample", "data-dshte-sample-scheme": scheme, style: frame },
		h(PreviewSidebar, null),
		h(PreviewCenter, null),
		h(PreviewRightbar, null)
	);
}

function PreviewSidebar() {
	const h = React.createElement;
	const nav = ["会话", "角色", "世界书", "设置"];
	return h("div", {
		"data-dshte-cell": "sidebar",
		style: {
			display: "grid",
			gap: "7px",
			alignContent: "start",
			padding: "10px 10px",
			minWidth: 0,
			background: "var(--dsw-specific-sidebar-fill, var(--dshte-bg-sidebar, #efe7e4))",
			borderRight: "1px solid var(--dsw-alias-border-l1, var(--dshte-border-sidebar, rgba(0, 0, 0, 0.08)))"
		}
	},
		h("div", { style: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 } },
			h("span", { style: { width: "18px", height: "18px", borderRadius: "6px", background: "var(--dshte-accent, #7557a8)", flex: "0 0 auto" } }),
			h("span", {
				style: {
					fontFamily: "var(--dshte-font-display, inherit)",
					fontWeight: "var(--dshte-weight-semibold, 600)",
					fontSize: "var(--dshte-text-brand, 12px)",
					letterSpacing: "var(--dshte-tracking-eyebrow, 0.08em)",
					color: "var(--dsw-alias-label-primary, var(--dshte-fg-primary, #222222))",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				}
			}, "COCREATE")
		),
		h("div", {
			style: {
				fontSize: "var(--dshte-text-eyebrow, 9px)",
				letterSpacing: "var(--dshte-tracking-eyebrow, 0.12em)",
				color: "var(--dshte-fg-eyebrow, #6d6278)",
				textTransform: "uppercase"
			}
		}, "WORKBENCH"),
		h("div", {
			style: {
				display: "grid",
				gap: "3px",
				padding: "5px 6px",
				borderRadius: "var(--dshte-radius-sm, 6px)",
				background: "var(--dshte-bg-accent-faint, rgba(117, 87, 168, 0.10))",
				borderLeft: "2px solid var(--dshte-accent, #7557a8)"
			}
		},
			h("span", { style: { color: "var(--dshte-accent-ink, #5e4876)", fontSize: "10.5px", fontWeight: "var(--dshte-weight-medium, 500)" } }, "新会话"),
			h("span", { style: { color: "var(--dshte-fg-muted, #948f89)", fontSize: "10px" } }, "刚刚")
		),
		...nav.map((label) => h("div", {
			key: label,
			style: { fontSize: "10.5px", color: "var(--dsw-alias-label-secondary, var(--dshte-fg-secondary, #5f5a52))", padding: "1px 2px" }
		}, label)),
		h("div", { style: { marginTop: "2px" } },
			h("span", {
				style: {
					display: "inline-block",
					padding: "1px 8px",
					borderRadius: "var(--dshte-radius-pill, 999px)",
					background: "var(--dshte-accent-pill, #e1d7e5)",
					color: "var(--dshte-accent-ink, #5e4876)",
					fontSize: "9.5px"
				}
			}, "药丸标签")
		)
	);
}

function PreviewCenter() {
	const h = React.createElement;
	return h("div", {
		"data-dshte-cell": "center",
		style: {
			display: "grid",
			gap: "7px",
			alignContent: "start",
			padding: "10px 12px",
			minWidth: 0,
			background: "var(--dsw-alias-bg-base, var(--dshte-bg-base, #f3efe9))",
			backgroundImage: "var(--dshte-region-center-bg-image, none)"
		}
	},
		h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingBottom: "5px", borderBottom: "1px solid var(--dsw-alias-border-l1, var(--dshte-border-rule, rgba(0,0,0,.10)))" } },
			h("span", { style: { fontFamily: "var(--dshte-font-display, inherit)", fontWeight: "var(--dshte-weight-semibold, 600)", fontSize: "var(--dshte-text-h2, 13px)", color: "var(--dsw-alias-label-primary, var(--dshte-fg-primary, #222222))" } }, "星穹之纹"),
			h("span", { style: { display: "flex", gap: "4px" } },
				h("span", { style: { width: "5px", height: "5px", borderRadius: "999px", background: "var(--dshte-fg-muted, #948f89)" } }),
				h("span", { style: { width: "5px", height: "5px", borderRadius: "999px", background: "var(--dshte-fg-muted, #948f89)" } }),
				h("span", { style: { width: "5px", height: "5px", borderRadius: "999px", background: "var(--dshte-accent, #7557a8)" } })
			)
		),
		h("div", {
			"data-dshte-sample": "card",
			style: {
				padding: "var(--dshte-card-padding-y, 8px) var(--dshte-card-padding-x, 10px)",
				borderRadius: "var(--dshte-radius-card, 10px)",
				border: "var(--dshte-card-border-width, 1px) solid var(--dshte-card-border-color, rgba(0, 0, 0, 0.12))",
				background: "var(--dshte-card-bg, var(--dshte-bg-surface, #fefaf7))",
				boxShadow: "var(--dshte-card-shadow, var(--dshte-shadow-card, none))",
				color: "var(--dshte-card-color, var(--dshte-fg-body, #35322c))"
			}
		},
			h("div", {
				style: {
					fontSize: "var(--dshte-text-eyebrow, 9px)",
					letterSpacing: "var(--dshte-tracking-eyebrow, 0.12em)",
					textTransform: "uppercase",
					color: "var(--dshte-fg-eyebrow, #6d6278)",
					marginBottom: "4px"
				}
			}, "ASSISTANT"),
			h("div", {
				style: {
					fontSize: "var(--dshte-text-body, 11.5px)",
					lineHeight: "var(--dshte-leading-body, 1.6)",
					color: "var(--dshte-fg-body, #35322c)"
				}
			}, "纸面上的暖光，把对话收进一页手帐。"),
			h("div", {
				"data-dshte-sample": "quote",
				style: {
					marginTop: "6px",
					padding: "5px 7px",
					borderLeft: "3px solid var(--dshte-accent-weak, #c8bdeb)",
					borderRadius: "var(--dshte-radius-quote, 4px)",
					background: "var(--dshte-bg-muted, #eae2df)",
					color: "var(--dshte-fg-secondary, #5f5a52)",
					fontSize: "10px",
					lineHeight: "var(--dshte-leading-tight, 1.35)"
				}
			}, "「引用块：一句从旧会话里摘下的旁白。」"),
			h("div", { style: { display: "flex", alignItems: "center", gap: "5px", marginTop: "7px", flexWrap: "wrap" } },
				h("span", {
					"data-dshte-sample": "button",
					style: {
						display: "inline-block",
						padding: "var(--dshte-button-primary-padding-y, 3px) var(--dshte-button-primary-padding-x, 12px)",
						height: "var(--dshte-button-primary-height, auto)",
						borderRadius: "var(--dshte-button-primary-radius, 999px)",
						background: "var(--dsw-alias-brand-primary, var(--dshte-button-primary-bg, var(--dshte-accent, #7557a8)))",
						color: "var(--dsw-alias-brand-text, var(--dshte-button-primary-color, var(--dshte-fg-inverse, #ffffff)))",
						fontSize: "var(--dshte-button-primary-font-size, 10px)",
						fontWeight: "var(--dshte-button-primary-font-weight, 600)",
						border: "var(--dshte-button-primary-border-width, 0px) solid var(--dshte-button-primary-border-color, transparent)",
						boxShadow: "var(--dshte-button-primary-shadow, none)"
					}
				}, "继续"),
				h("span", {
					style: {
						display: "inline-block",
						padding: "3px 10px",
						borderRadius: "999px",
						background: "var(--dshte-button-ghost-bg, transparent)",
						color: "var(--dshte-button-ghost-color, var(--dshte-fg-secondary, #5f5a52))",
						fontSize: "10px",
						border: "1px solid var(--dshte-border-hairline, rgba(0, 0, 0, 0.14))"
					}
				}, "重试")
			)
		),
		h("div", {
			"data-dshte-sample": "composer",
			style: {
				padding: "6px 8px",
				borderRadius: "var(--dshte-radius-input, 12px)",
				border: "1px solid var(--dshte-border-hairline, rgba(0, 0, 0, 0.14))",
				background: "var(--dshte-bg-elevated, #ffffff)",
				boxShadow: "var(--dshte-shadow-card, none)"
			}
		},
			h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
				h("span", { style: { flex: 1, minWidth: 0, color: "var(--dshte-fg-placeholder, #797979)", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "输入消息…"),
				h("span", {
					style: {
						width: "16px",
						height: "16px",
						borderRadius: "999px",
						background: "var(--dshte-accent, #7557a8)",
						color: "var(--dshte-fg-inverse, #ffffff)",
						fontSize: "9px",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center"
					}
				}, "↑")
			)
		)
	);
}

function PreviewRightbar() {
	const h = React.createElement;
	return h("div", {
		"data-dshte-cell": "rightbar",
		style: {
			display: "grid",
			gap: "7px",
			alignContent: "start",
			padding: "10px 10px",
			minWidth: 0,
			background: "var(--dshte-bg-gutter, #f6f1eb)",
			borderLeft: "1px solid var(--dshte-border-hairline, rgba(0, 0, 0, 0.08))"
		}
	},
		h("div", { style: { fontSize: "10px", fontWeight: "var(--dshte-weight-semibold, 600)", color: "var(--dshte-fg-primary, #222222)" } }, "本轮面板"),
		h("div", { style: { display: "grid", gap: "4px" } },
			h("div", {
				style: {
					padding: "5px 6px",
					borderRadius: "var(--dshte-radius-card, 10px)",
					border: "1px solid var(--dshte-border-hairline, rgba(0, 0, 0, 0.12))",
					background: "var(--dshte-bg-surface, #fefaf7)",
					color: "var(--dshte-fg-secondary, #5f5a52)",
					fontSize: "9.5px"
				}
			}, "状态 · 进行中"),
			h("div", {
				style: {
					padding: "5px 6px",
					borderRadius: "var(--dshte-radius-card, 10px)",
					border: "1px solid var(--dshte-border-hairline, rgba(0, 0, 0, 0.12))",
					background: "var(--dshte-bg-surface, #fefaf7)",
					color: "var(--dshte-fg-secondary, #5f5a52)",
					fontSize: "9.5px"
				}
			}, "变量 · 12 项")
		),
		h("span", {
			style: {
				justifySelf: "start",
				padding: "1px 7px",
				borderRadius: "var(--dshte-radius-sm, 6px)",
				background: "var(--dshte-bg-accent-soft, #eae4ee)",
				color: "var(--dshte-accent-ink, #5e4876)",
				fontSize: "9px"
			}
		}, "右栏（示意）")
	);
}
