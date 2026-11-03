/**
 * Step 5 settings page — the single `SkinEngineSection` component.
 *
 * Why one component instead of slots: all 15 rows share ONE draft + one
 * apply/cancel lifecycle; splitting them would multiply the boot risk and force
 * cross-slot state plumbing for zero benefit (契约 §6 rationale / §7.1 R1).
 *
 * Lifecycle (契约 §6):
 *   control change → validate (normalizeKnobValue) → draft + dirty →
 *   16ms debounce → engine.preview(draft.overrides) when previewLive.
 *   应用 → engine.clearPreview() → store.set({overrides}, reason="overrides")
 *        → dirty=false. 取消 → clearPreview + draft = committed copy.
 *   unmount → clearPreview + restore the SAVED custom CSS text.
 */

function cloneOverrideDraft(overrides) {
	const source = overrides && typeof overrides === "object" ? overrides : {};
	return {
		light: { ...(source.light && typeof source.light === "object" ? source.light : {}) },
		dark: { ...(source.dark && typeof source.dark === "object" ? source.dark : {}) }
	};
}

function buildSettingsModel(pack) {
	if (!pack || typeof pack !== "object") return null;
	try {
		const recipe = compileRecipes(pack);
		return buildKnobModel(pack, {
			baseVars: compilePackBaseVars(pack),
			recipeVars: recipe && recipe.vars ? recipe.vars.light || {} : {}
		});
	} catch (error) {
		console.warn(TAG, "buildKnobModel failed", error);
		return null;
	}
}

function SkinEngineSection(props) {
	const { store, engine } = props;
	const h = React.createElement;

	const [tick, setTick] = React.useState(0);
	const [status, setStatus] = React.useState(null);
	const [previewInfo, setPreviewInfo] = React.useState(null);

	const initialDiag = React.useMemo(() => uiSafeDiagnostics(engine), [engine]);
	const [editScheme, setEditSchemeState] = React.useState(() => (initialDiag.scheme === "dark" ? "dark" : "light"));

	const initialOverrides = cloneOverrideDraft(store.get() ? store.get().overrides : null);
	const [draft, setDraft] = React.useState({ overrides: initialOverrides });
	const draftRef = React.useRef({ overrides: initialOverrides });
	const [dirty, setDirty] = React.useState(false);
	const dirtyRef = React.useRef(false);
	const [previewLive, setPreviewLive] = React.useState(() => uiSafeGetUi(store).previewLive !== false);
	const previewLiveRef = React.useRef(previewLive);
	const [safeMode, setSafeMode] = React.useState(() => initialDiag.safeMode === true || uiSafeIsSafeMode(store));
	const safeModeRef = React.useRef(safeMode);
	const previewTimer = React.useRef(null);

	// Diagnostics are memoised per engine notification so typing in a control
	// does not re-measure every computed token on the real DOM.
	const diag = React.useMemo(() => {
		void tick;
		return uiSafeDiagnostics(engine);
	}, [engine, tick]);
	const state = store.get() || {};
	const packId = state.activePackId ? String(state.activePackId) : null;
	const packs = store && typeof store.packs === "function" ? store.packs() : { builtin: [], user: [], at: null };
	const trash = store && typeof store.trash === "function" ? store.trash() : { entries: [], count: 0, at: null };
	const packEntry = packId && typeof BUILTIN_PACKS === "object" && BUILTIN_PACKS ? BUILTIN_PACKS[packId] : null;
	const [remotePack, setRemotePack] = React.useState(null);
	React.useEffect(() => {
		let alive = true;
		if (!packId || (typeof BUILTIN_PACKS === "object" && BUILTIN_PACKS && BUILTIN_PACKS[packId])) {
			setRemotePack(null);
			return undefined;
		}
		void (async () => {
			try {
				const remote = await store.api("packs.get", { id: packId });
				if (alive && remote && remote.pack) setRemotePack({ pack: remote.pack, css: remote.css || null, builtin: false });
			} catch (error) {
				if (alive) setRemotePack(null);
			}
		})();
		return () => { alive = false; };
	}, [packId, store]);
	const pack = packEntry && packEntry.pack ? packEntry.pack : remotePack && remotePack.pack ? remotePack.pack : null;
	const model = React.useMemo(() => buildSettingsModel(pack), [pack]);
	const safeModeActive = safeMode || diag.safeMode === true;

	/* ── store / engine subscriptions ───────────────────────────────────── */

	React.useEffect(() => {
		if (!store || typeof store.subscribe !== "function") return undefined;
		const offStore = store.subscribe(() => {
			// External state changes never clobber an unapplied draft.
			if (!dirtyRef.current) {
				const fresh = cloneOverrideDraft(store.get().overrides);
				draftRef.current = { overrides: fresh };
				setDraft({ overrides: fresh });
			}
			setSafeMode(uiSafeIsSafeMode(store));
			setTick((count) => count + 1);
		});
		let offEngine = null;
		if (engine && typeof engine.subscribe === "function") {
			offEngine = engine.subscribe(() => setTick((count) => count + 1));
		}
		return () => {
			try { if (offStore) offStore(); } catch (error) { /* ignore */ }
			try { if (offEngine) offEngine(); } catch (error) { /* ignore */ }
		};
	}, [store, engine]);

	/* ── preview / draft plumbing ───────────────────────────────────────── */

	const flushPreview = (overrides) => {
		if (!previewLiveRef.current) {
			setPreviewInfo({ ok: false, reason: "off" });
			return;
		}
		let result = null;
		try {
			result = engine && typeof engine.preview === "function"
				? engine.preview(overrides)
				: { ok: false, reason: "engine.preview 未就绪" };
		} catch (error) {
			result = { ok: false, reason: String((error && error.message) || error) };
		}
		setPreviewInfo(result && typeof result === "object" ? result : { ok: false, reason: "未知预览结果" });
	};

	const schedulePreview = (overrides) => {
		if (previewTimer.current) clearTimeout(previewTimer.current);
		if (!previewLiveRef.current) return;
		previewTimer.current = setTimeout(() => {
			previewTimer.current = null;
			flushPreview(overrides);
		}, 16);
	};

	const changeOverrides = (updater) => {
		const nextOverrides = typeof updater === "function"
			? updater(cloneOverrideDraft(draftRef.current.overrides))
			: cloneOverrideDraft(updater);
		const next = { overrides: nextOverrides };
		draftRef.current = next;
		setDraft(next);
		if (!dirtyRef.current) {
			dirtyRef.current = true;
			setDirty(true);
		}
		schedulePreview(nextOverrides);
	};

	const markDirty = (value) => {
		dirtyRef.current = value === true;
		setDirty(value === true);
	};

	const applyDraft = () => {
		if (previewTimer.current) {
			clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		try { if (engine && typeof engine.clearPreview === "function") engine.clearPreview(); } catch (error) { /* ignore */ }
		const overrides = cloneOverrideDraft(draftRef.current.overrides);
		let result = null;
		try {
			result = store.set({ overrides }, { reason: "overrides" });
		} catch (error) {
			setStatus({ kind: "bad", text: "应用失败：" + String((error && error.message) || error) });
			return;
		}
		if (result && result.ok === false) {
			setStatus({ kind: "bad", text: "应用被 store 拒绝：" + String(result.error || "未知错误") });
			return;
		}
		markDirty(false);
		setPreviewInfo(null);
		setStatus({
			kind: "ok",
			text: "已应用 · " + String(countOverrides(overrides)) + " 个覆盖已写入 state.overrides · " + miscClock()
		});
	};

	const cancelDraft = () => {
		if (previewTimer.current) {
			clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		try { if (engine && typeof engine.clearPreview === "function") engine.clearPreview(); } catch (error) { /* ignore */ }
		const fresh = cloneOverrideDraft(store.get().overrides);
		draftRef.current = { overrides: fresh };
		setDraft({ overrides: fresh });
		markDirty(false);
		setPreviewInfo(null);
		setStatus({ kind: "ok", text: "已取消未应用的改动（草稿回滚到已提交值）· " + miscClock() });
	};

	const togglePreviewLive = () => {
		const next = !previewLiveRef.current;
		previewLiveRef.current = next;
		setPreviewLive(next);
		uiSafeSetUi(store, { previewLive: next });
		if (next) {
			flushPreview(draftRef.current.overrides);
			setStatus({ kind: "ok", text: "实时预览已开启：草稿改动将在 16ms 去抖后作用到全页" });
		} else {
			if (previewTimer.current) {
				clearTimeout(previewTimer.current);
				previewTimer.current = null;
			}
			try { if (engine && typeof engine.clearPreview === "function") engine.clearPreview(); } catch (error) { /* ignore */ }
			setPreviewInfo({ ok: false, reason: "off" });
			setStatus({ kind: "ok", text: "实时预览已关闭：只更新迷你小样，全页保持已提交值" });
		}
	};

	/* ── immediate-commit actions (not part of the draft) ───────────────── */

	const activatePack = (id) => {
		let result = null;
		try { result = store.set({ activePackId: id, enabled: true }, { reason: "activate" }); } catch (error) {
			setStatus({ kind: "bad", text: "换包失败：" + String((error && error.message) || error) });
			return;
		}
		if (result && result.ok === false) {
			setStatus({ kind: "bad", text: "换包被 store 拒绝：" + String(result.error || "未知错误") });
			return;
		}
		if (dirtyRef.current) {
			try { if (engine && typeof engine.clearPreview === "function") engine.clearPreview(); } catch (error) { /* ignore */ }
			const fresh = cloneOverrideDraft(store.get().overrides);
			draftRef.current = { overrides: fresh };
			setDraft({ overrides: fresh });
			markDirty(false);
			setPreviewInfo(null);
			setStatus({ kind: "ok", text: "已切换到「" + id + "」；换包丢弃了未应用的草稿改动" });
			return;
		}
		setStatus({ kind: "ok", text: "已切换到「" + id + "」（换包 = 允许叠层的时机）" });
	};

	const toggleEnabled = () => {
		const enabled = store.get().enabled !== false;
		const result = store.set({ enabled: !enabled }, { reason: "enabled" });
		if (result && result.ok === false) {
			setStatus({ kind: "bad", text: "切换启用状态失败：" + String(result.error || "未知错误") });
			return;
		}
		setStatus({ kind: "ok", text: enabled ? "已停用皮肤（回退原生外观）" : "已启用皮肤" });
	};

	const setSchemePolicy = (value) => {
		if (value !== "mirror" && value !== "inherit") return;
		const result = store.set({ schemePolicy: value }, { reason: "schemePolicy" });
		if (result && result.ok === false) {
			setStatus({ kind: "bad", text: "写入深色策略失败：" + String(result.error || "未知错误") });
			return;
		}
		setStatus({ kind: "ok", text: "深色策略已设为 " + value + "（即时提交）" });
	};

	const setEditScheme = (scheme) => {
		setEditSchemeState(scheme === "dark" ? "dark" : "light");
	};

	const toggleSafeMode = () => {
		const next = !safeModeRef.current;
		safeModeRef.current = next;
		setSafeMode(next);
		// Contract §0.6 / engine-core note: the top-level and Advanced buttons MUST
		// go through engine.setSafeMode() — it persists the flag AND withdraws /
		// reloads the layer. store.setSafeMode alone would not withdraw anything.
		if (engine && typeof engine.setSafeMode === "function") {
			try { engine.setSafeMode(next); } catch (error) {
				setStatus({ kind: "bad", text: "切换安全模式失败：" + String((error && error.message) || error) });
				return;
			}
		} else {
			uiSafeSetSafeMode(store, next);
		}
		if (previewTimer.current) {
			clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		setPreviewInfo(null);
		setStatus({
			kind: next ? "bad" : "ok",
			text: next
				? "已开启安全模式：本引擎已撤掉全部样式层，页面 = 宿主原生外观"
				: "已关闭安全模式：正在重新加载主题包（顺序：loadPack → apply → 自定义 CSS → 本机字体）"
		});
	};

	const resetDefault = () => {
		if (previewTimer.current) {
			clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		try { if (engine && typeof engine.clearPreview === "function") engine.clearPreview(); } catch (error) { /* ignore */ }
		const result = store.set(
			{ enabled: false, overrides: { light: {}, dark: {} }, schemePolicy: null },
			{ reason: "enabled" }
		);
		if (result && result.ok === true) {
			const fresh = cloneOverrideDraft(store.get().overrides);
			draftRef.current = { overrides: fresh };
			setDraft({ overrides: fresh });
			markDirty(false);
			setPreviewInfo(null);
			setStatus({ kind: "ok", text: "已恢复默认：皮肤停用、overrides 清空、schemePolicy=null（token 交回宿主 / dream-skin）" });
		}
		return result || { ok: false, error: "store.set 没有返回结果" };
	};

	const refresh = () => setTick((count) => count + 1);

	/* ── unmount: clear preview + roll back unsaved custom CSS ──────────── */

	React.useEffect(() => {
		return () => {
			if (previewTimer.current) clearTimeout(previewTimer.current);
			previewTimer.current = null;
			try { if (engine && typeof engine.clearPreview === "function") engine.clearPreview(); } catch (error) { /* ignore */ }
			try {
				if (engine && typeof engine.setUserCss === "function") {
					const saved = uiSafeGetCustomCss(store);
					engine.setUserCss(saved.text || "");
				}
			} catch (error) { /* ignore */ }
		};
	}, [store, engine]);

	/* ── shared context passed to every row ─────────────────────────────── */

	const ctx = {
		store,
		engine,
		state,
		diag,
		pack,
		packId,
		packs,
		trash,
		model,
		draft,
		dirty,
		previewLive,
		previewInfo,
		editScheme,
		status,
		safeMode: safeModeActive,
		actions: {
			setStatus: (text, kind) => setStatus({ kind: kind === undefined ? "ok" : kind, text: String(text) }),
			setEditScheme,
			changeOverrides,
			updateOverrides: changeOverrides,
			applyDraft,
			cancelDraft,
			togglePreviewLive,
			toggleSafeMode,
			activatePack,
			toggleEnabled,
			setSchemePolicy,
			resetDefault,
			refresh,
			refreshPacks: async () => {
				try {
					await store.refreshPacks();
					await store.refreshTrash();
					const nextPacks = store.packs();
					setStatus({
						kind: "ok",
						text: "包列表已刷新：内置 " + String(nextPacks.builtin.length) + " · 用户 " + String(nextPacks.user.length) + " · 回收站 " + String(store.trash().count) + " 条 · " + miscClock()
					});
					setTick((count) => count + 1);
					return nextPacks;
				} catch (error) {
					setStatus({ kind: "bad", text: "刷新包列表失败：" + String((error && error.message) || error) });
					return null;
				}
			},
			refreshTrash: async () => {
				try {
					await store.refreshTrash();
					setTick((count) => count + 1);
					return store.trash();
				} catch (error) {
					setStatus({ kind: "bad", text: "刷新回收站失败：" + String((error && error.message) || error) });
					return null;
				}
			}
		}
	};

	return h("div", {
		"data-dshte-page": "step7",
		"data-dshte-step": "7",
		"data-dshte-engine": "step7",
		style: UI.wrap
	},
		h(StatusBar, { ctx }),
		h(ActionBar, { ctx }),
		h(RowPack, { ctx }),
		h(RowPreview, { ctx }),
		h(RowPreviewLive, { ctx }),
		h(RowImport, { ctx }),
		h(RowExport, { ctx }),
		h(RowManage, { ctx }),
		h(RowScheme, { ctx }),
		h(RowColors, { ctx }),
		h(RowTypography, { ctx }),
		h(RowShape, { ctx }),
		h(RowRegions, { ctx }),
		h(RowComponents, { ctx }),
		h(RowCustomCss, { ctx }),
		h(RowDiagnostics, { ctx }),
		h(RowAdvanced, { ctx })
	);
}
