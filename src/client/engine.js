/**
 * Skin engine core (build-inlined fragment, no exports).
 *
 * Owns the token override layer + the engine-variable <style> block. Stacking
 * happens ONLY at: startup, pack switch, override change, and 「以本主题为准」.
 * `theme/change` never re-stacks (方案 §4.3 rule 3); it only toggles on/off when
 * the resolved active state flips (needed for `missingScheme: "inherit"`).
 */
function createSkinEngine(ctx, store) {
	const SOURCE = "dsh-tavern-skin-engine:pack";
	const VAR_STYLE_ID = "dshte-vars";
	const ENGINE_STYLE_ID = "dshte-engine-css";
	const PACK_STYLE_ID = "dshte-pack-css";
	const FONT_STYLE_ID = "dshte-fonts";
	const PREVIEW_STYLE_ID = "dshte-preview";
	const USER_CSS_STYLE_ID = "dshte-user-css";
	let fontReloadPending = false;
	const runtime = {
		theme: null,
		pack: null,
		plan: null,
		layer: null,
		varsEl: null,
		fontsEl: null,
		engineCssEl: null,
		packCssEl: null,
		recipes: null,
		setTokens: [],
		fontFaces: "",
		fonts: [],
		packCss: { present: false, ok: null, bytes: 0, rewrittenCount: 0, errors: [], warnings: [], firstError: null },
		customCss: null,
		/* Step 5 */
		userCss: { present: false, ok: null, bytes: 0, errors: [], warnings: [], firstError: null, rewrittenCount: 0, lineCount: 0 },
		userCssText: "",
		userCssEl: null,
		preview: null,
		previewEl: null,
		committedSetTokens: [],
		safeMode: false,
		assetBase: null,
		hooks: null,
		active: false,
		scheme: "light",
		lastApplyAt: null,
		lastReason: null,
		mismatch: [],
		missing: [],
		unverifiable: [],
		fallbackNames: [],
		lastError: null,
		startupFrameGrid: null,
		themeEvents: 0,
		applying: false,
		verifyTimers: [],
		verifyPoll: null,
		verifyPollTicks: 0,
		bodyObserver: null,
		verifyDebounce: null,
		probeTimers: [],
		offTheme: null,
		offStore: null,
		offInject: null,
		listeners: new Set(),
		/* Step 7: coexistence self-check (§4.5) + console summary + auto safe mode */
		hostInfo: { available: null, version: null, pid: null, lastError: null, checkedAt: null },
		consoleDiag: { count: 0, lastAt: null, lastReason: null },
		consoleTimer: null,
		consolePendingReason: null,
		lastThemeChangeAt: null,
		autoSafeMode: { triggered: false, at: null, reason: null },
		reassertInfo: { lastAt: null, mismatchBefore: null, mismatchAfter: null, stillOverridden: null },
		pageStartedAt: (() => {
			try {
				if (typeof performance === "object" && performance && typeof performance.now === "function") return performance.now();
			} catch { /* ignore */ }
			return Date.now();
		})()
	};

	function notify() {
		for (const listener of [...runtime.listeners]) {
			try { listener(runtime); } catch (error) { console.warn(TAG, "engine listener failed", error); }
		}
	}

	function ensureVarsStyle() {
		if (runtime.varsEl && document.body && document.body.contains(runtime.varsEl)) return runtime.varsEl;
		let element = document.getElementById(VAR_STYLE_ID);
		if (!element) {
			element = document.createElement("style");
			element.id = VAR_STYLE_ID;
			element.dataset.plugin = "dsh-tavern-skin-engine";
			(document.body || document.documentElement).appendChild(element);
		}
		runtime.varsEl = element;
		return element;
	}

	function removeVarsStyle() {
		if (runtime.varsEl) runtime.varsEl.textContent = "";
		if (runtime.varsEl && runtime.varsEl.parentNode) runtime.varsEl.remove();
		runtime.varsEl = null;
	}

	function ensureStyleElement(id, runtimeKey) {
		const existing = document.getElementById(id);
		if (existing) { runtime[runtimeKey] = existing; return existing; }
		const element = document.createElement("style");
		element.id = id;
		element.dataset.plugin = "dsh-tavern-skin-engine";
		(document.body || document.documentElement).appendChild(element);
		runtime[runtimeKey] = element;
		return element;
	}

	/** Static registry styles (ENGINE_CSS): opt-in via html[data-dshte-set~=…]. */
	function ensureEngineStyle() {
		const element = ensureStyleElement(ENGINE_STYLE_ID, "engineCssEl");
		if (element.textContent !== ENGINE_CSS) element.textContent = ENGINE_CSS;
		return element;
	}

	function removeEngineStyle() {
		if (runtime.engineCssEl) runtime.engineCssEl.textContent = "";
		if (runtime.engineCssEl && runtime.engineCssEl.parentNode) runtime.engineCssEl.remove();
		runtime.engineCssEl = null;
	}

	/** @font-face rules live in their own node so variable rewrites cannot unload them. */
	function ensureFontsStyle() {
		return ensureStyleElement(FONT_STYLE_ID, "fontsEl");
	}

	function removeFontsStyle() {
		if (runtime.fontsEl) runtime.fontsEl.textContent = "";
		if (runtime.fontsEl && runtime.fontsEl.parentNode) runtime.fontsEl.remove();
		runtime.fontsEl = null;
	}

	/** Pack theme.css (unsafe channel, prechecked before injection). */
	function ensurePackStyle() {
		return ensureStyleElement(PACK_STYLE_ID, "packCssEl");
	}

	function removePackStyle() {
		if (runtime.packCssEl) runtime.packCssEl.textContent = "";
		if (runtime.packCssEl && runtime.packCssEl.parentNode) runtime.packCssEl.remove();
		runtime.packCssEl = null;
	}

	/**
	 * Step 5 preview overlay: a DISPOSABLE style block that only carries
	 * `body { --host-token: value !important }` for the host tokens the draft
	 * changed. It is never a token layer (no overrideTokens, no runtime.plan
	 * write, no store write — 契约 §4).
	 */
	function ensurePreviewStyle() {
		const existing = document.getElementById(PREVIEW_STYLE_ID);
		if (existing) { runtime.previewEl = existing; return existing; }
		const element = document.createElement("style");
		element.id = PREVIEW_STYLE_ID;
		element.dataset.plugin = "dsh-tavern-skin-engine";
		element.dataset.dshtePreview = "1";
		(document.body || document.documentElement).appendChild(element);
		runtime.previewEl = element;
		return element;
	}

	function removePreviewStyle() {
		const element = runtime.previewEl || document.getElementById(PREVIEW_STYLE_ID);
		if (element) {
			element.textContent = "";
			if (element.parentNode) element.remove();
		}
		runtime.previewEl = null;
	}

	/** Custom CSS lives after #dshte-pack-css so user rules win the cascade. */
	function ensureUserCssStyle() {
		const existing = document.getElementById(USER_CSS_STYLE_ID);
		let element = existing;
		if (!element) {
			element = document.createElement("style");
			element.id = USER_CSS_STYLE_ID;
			element.dataset.plugin = "dsh-tavern-skin-engine";
			element.dataset.dshteUserCss = "1";
		}
		const body = document.body || document.documentElement;
		if (element.parentNode !== body || body.lastChild !== element) body.appendChild(element);
		runtime.userCssEl = element;
		return element;
	}

	function removeUserCssStyle() {
		const element = runtime.userCssEl || document.getElementById(USER_CSS_STYLE_ID);
		if (element) {
			element.textContent = "";
			if (element.parentNode) element.remove();
		}
		runtime.userCssEl = null;
	}

	function setRecipeTokens(tokens) {
		try {
			if (tokens && tokens.length > 0) document.documentElement.setAttribute("data-dshte-set", tokens.join(" "));
			else document.documentElement.removeAttribute("data-dshte-set");
		} catch { /* documentElement always exists */ }
	}

	function assetBaseFor(packId, builtin) {
		return `/dsh-tavern-skin/assets/${builtin ? "builtin" : "pack"}/${encodeURIComponent(String(packId))}`;
	}

	/**
	 * Compile a pack + overrides into everything apply()/preview() need
	 * (契约 §4). User `--dshte-*` overrides are applied LAST, after the pack's
	 * regions/components recipes and the typography/radii/spacing sugar, so an
	 * explicit knob always beats the pack default.
	 * @returns {{plan: object, recipePlan: object, assetBase: string, setTokens: string[]}}
	 */
	function compilePackPlan(pack, overrides, policy) {
		const normalized = normalizeOverrides(overrides);
		const plan = buildTokenPlan(pack, { overrides: normalized, schemePolicy: policy || "mirror" });
		const recipePlan = compileRecipes(pack);
		const assetBase = assetBaseFor(plan.packId, !!(runtime.pack && runtime.pack.builtin));
		const rewrite = (value) => (/url\(\s*['"]?assets\//i.test(value) ? rewriteAssetUrls(value, assetBase) : value);
		for (const target of ["light", "dark"]) {
			const recipeVars = recipePlan.vars[target];
			for (const [name, value] of Object.entries(recipeVars)) recipeVars[name] = rewrite(value);
			// typography/radii/spacing/shadows sugar: explicit pack tokens win.
			for (const [name, value] of Object.entries(recipePlan.baseVars)) {
				if (name in plan.engine[target]) continue;
				plan.engine[target][name] = rewrite(value);
			}
			Object.assign(plan.engine[target], recipeVars);
			// User overrides win over every compiled default.
			for (const [name, value] of Object.entries(normalized[target])) {
				if (isEngineToken(name)) plan.engine[target][name] = value;
			}
		}
		const setTokens = uniqueSetTokens([
			...recipePlan.set,
			...baseVarSetTokens(recipePlan.baseVars),
			...deriveExtraSetTokens(normalized)
		]);
		return { plan, recipePlan, assetBase, setTokens };
	}

	function uniqueSetTokens(list) {
		const seen = new Set();
		const out = [];
		for (const token of list) {
			if (typeof token !== "string" || token.length === 0 || seen.has(token)) continue;
			seen.add(token);
			out.push(token);
		}
		return out;
	}

	/** Build the `!important` fallback table for the given host token names. */
	function fallbackFor(names, plan) {
		const fallback = { light: {}, dark: {} };
		if (!plan || !plan.host || !names) return fallback;
		for (const name of names) {
			const pair = plan.host[name];
			if (!pair) continue;
			fallback.light[name] = pair.light;
			fallback.dark[name] = pair.dark;
		}
		return fallback;
	}

		/** Engine variables only (font faces live in their own node). */
	function writeVarsStyle(plan, fallback) {
		const next = renderVarsCss(plan, { fallback }) || "";
		const element = ensureVarsStyle();
		if (element.textContent !== next) element.textContent = next;
	}

	function writeFontsStyle() {
		const next = runtime.fontFaces || "";
		const element = ensureFontsStyle();
		if (element.textContent !== next) {
			element.textContent = next;
			scheduleFontReload();
		}
	}

	/** Re-run document.fonts.load() after a stylesheet rewrite re-created the faces. */
	function scheduleFontReload() {
		if (fontReloadPending) return;
		fontReloadPending = true;
		setTimeout(() => {
			fontReloadPending = false;
			if (runtime.active && runtime.pack && runtime.pack.pack) void loadPackFonts(runtime.pack.pack);
		}, 150);
	}

	function currentScheme() {
		try {
			const snapshot = runtime.theme.getTheme();
			return snapshot && snapshot.active && snapshot.active.colorScheme === "dark" ? "dark" : "light";
		} catch { return "light"; }
	}

	function currentPolicy() {
		const chosen = store.get().schemePolicy;
		if (chosen === "mirror" || chosen === "inherit") return chosen;
		return (runtime.pack && runtime.pack.pack && runtime.pack.pack.missingScheme) || "mirror";
	}

	function shouldBeActive() {
		const state = store.get();
		if (!state.enabled || !runtime.pack) return false;
		const pack = runtime.pack.pack;
		if (!pack) return false;
		if (currentPolicy() === "inherit" && currentScheme() !== pack.colorScheme) return false;
		return true;
	}

	function frameGrid() {
		try {
			const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]');
			return frame ? String(frame.getAttribute("style") || "") : null;
		} catch { return null; }
	}

	/* ── Step 7: §4.5 coexistence self-check helpers (read-only) ─────────── */

	/** Host-shaped 3-track frame grid (the shell's own inline value). */
	const HOST_GRID_RE = /grid-template-columns:\s*280px minmax\(\d+(?:\.\d+)?px, 1fr\) minmax\(0px, \d+(?:\.\d+)?px\);?$/;

	function gridLooksHost(grid) {
		try {
			if (grid === null || grid === undefined) return null;
			return HOST_GRID_RE.test(String(grid).trim());
		} catch { return null; }
	}

	/** Ms since page load (performance.now() is navigation-relative). */
	function pageAgeMs() {
		try {
			if (typeof performance === "object" && performance && typeof performance.now === "function") return performance.now();
		} catch { /* ignore */ }
		return Date.now() - runtime.pageStartedAt;
	}

	/** Our own six style nodes must never be reported as "late styles". */
	function isOwnStyleNode(element) {
		try {
			if (!element) return false;
			if ([VAR_STYLE_ID, ENGINE_STYLE_ID, PACK_STYLE_ID, FONT_STYLE_ID, PREVIEW_STYLE_ID, USER_CSS_STYLE_ID].indexOf(element.id) >= 0) return true;
			if (element.dataset && element.dataset.plugin === "dsh-tavern-skin-engine") return true;
			if (element.dataset && (element.dataset.dshtePreview || element.dataset.dshteUserCss)) return true;
			return false;
		} catch { return false; }
	}

	/**
	 * §4.5 items 1/2: scan ONLY `document.body` <style> nodes. `lateStyles` are
	 * the non-engine nodes AFTER `#dshte-pack-css` (no pack node ⇒ all of them).
	 * Never throws (diagnostics discipline).
	 */
	function scanBodyStyles() {
		const out = {
			count: 0,
			order: [],
			present: { vars: false, engine: false, pack: false, fonts: false },
			lateStyles: [],
			orderHealth: "unknown",
			note: "无法判断（未找到 document.body）"
		};
		try {
			if (!document.body) return out;
			const nodes = Array.prototype.slice.call(document.body.querySelectorAll("style"));
			out.count = nodes.length;
			const packIndex = nodes.findIndex((element) => element.id === PACK_STYLE_ID);
			for (let index = 0; index < nodes.length; index++) {
				const element = nodes[index];
				const own = isOwnStyleNode(element);
				out.order.push(element.id || (element.dataset && element.dataset.plugin) || "(anon)");
				if (element.id === VAR_STYLE_ID) out.present.vars = true;
				if (element.id === ENGINE_STYLE_ID) out.present.engine = true;
				if (element.id === PACK_STYLE_ID) out.present.pack = true;
				if (element.id === FONT_STYLE_ID) out.present.fonts = true;
				if (own) continue;
				const afterPack = packIndex >= 0 ? index > packIndex : true;
				if (!afterPack) continue;
				const pluginCss = element.getAttribute("data-plugin-css") || null;
				out.lateStyles.push({
					id: element.id || null,
					pluginCss,
					source: pluginCss || element.id || "(anon)",
					bytes: utf8ByteLength(element.textContent || "")
				});
			}
			if (out.count === 0) {
				out.orderHealth = "unknown";
				out.note = "body 内没有 style 节点（无法判断样式顺序）";
			} else if (out.lateStyles.length > 0) {
				out.orderHealth = "degraded";
				const sources = [];
				for (const entry of out.lateStyles) {
					if (sources.indexOf(entry.source) < 0) sources.push(entry.source);
				}
				out.note = "检测到更晚的样式表：" + sources.slice(0, 3).join("、");
			} else {
				out.orderHealth = "ok";
				out.note = "body 内样式顺序正常（没有更晚的非本引擎样式表）";
			}
		} catch { /* diagnostics must never throw */ }
		return out;
	}

	function isDreamSkinStyle(entry) {
		try {
			if (!entry) return false;
			return [entry.pluginCss, entry.id, entry.source].some((value) => typeof value === "string" && value.indexOf("dsh-dream-skin") >= 0);
		} catch { return false; }
	}

	/**
	 * §4.5 item 3: existence-only dream-skin probe. Never reads its style text and
	 * never calls `window.dshDreamSkin`（方案 §4.6）— only `typeof` + DOM existence.
	 */
	function dreamSkinDiagnostics() {
		const out = { detected: false, cssSkin: false, materialStyle: false, bridge: false, note: "未检测到 dream-skin" };
		try {
			out.cssSkin = !!document.querySelector('style[data-plugin-css="dsh-dream-skin/interface-skin"]');
			out.bridge = typeof window === "object" && window !== null && typeof window.dshDreamSkin === "object" && window.dshDreamSkin !== null;
			// 壁纸/玻璃材质没有可靠判据：只做 html[data-dsh-material] 存在性检查，不看内容。
			out.materialStyle = !!(document.documentElement
				&& typeof document.documentElement.hasAttribute === "function"
				&& document.documentElement.hasAttribute("data-dsh-material"));
			out.detected = out.cssSkin || out.bridge || out.materialStyle;
			if (out.detected) {
				const parts = [];
				if (out.cssSkin) parts.push("CSS 皮肤");
				if (out.bridge) parts.push("桥");
				if (out.materialStyle) parts.push("材质");
				out.note = "检测到 dream-skin（" + parts.join(" / ") + "，只做存在性判断）";
			} else {
				out.note = "未检测到 dream-skin（CSS 皮肤 / 桥 / 材质都不存在）";
			}
		} catch { /* existence checks must never throw */ }
		return out;
	}

	/** §3.4: heuristic "who overrides it" guess — always labelled as 推测. */
	function suspectFor(entry, dreamSkin, lateStyles) {
		try {
			const recentThemeChange = runtime.lastThemeChangeAt !== null && (Date.now() - runtime.lastThemeChangeAt) < 5000;
			const lateDreamSkin = (lateStyles || []).some((item) => isDreamSkinStyle(item));
			if (dreamSkin && dreamSkin.detected && (lateDreamSkin || recentThemeChange)) return "dsh-dream-skin（外观层后叠）";
			const late = (lateStyles || [])[0];
			if (late) return "更晚的样式表：" + String(late.source || late.id || "?");
			return "宿主内联样式或其他插件";
		} catch {
			return "未知（推测失败）";
		}
	}

	/** §3.1: host identity from GET /dsh-tavern-skin/ping, once at startup. */
	async function fetchHostInfo() {
		const checkedAt = new Date().toISOString();
		try {
			if (typeof fetch !== "function") throw new Error("fetch 不可用");
			const response = await fetch("/dsh-tavern-skin/ping", { credentials: "same-origin" });
			const data = await response.json();
			if (data && data.ok === false) throw new Error(String(data.error || "ping 返回 ok:false"));
			runtime.hostInfo = {
				available: true,
				version: data && typeof data.version === "string" ? data.version : null,
				pid: data && typeof data.pid === "number" ? data.pid : null,
				lastError: null,
				checkedAt
			};
		} catch (error) {
			runtime.hostInfo = {
				available: false,
				version: null,
				pid: null,
				lastError: String((error && error.message) || error),
				checkedAt
			};
		}
		notify();
		return runtime.hostInfo;
	}

	/**
	 * §3.3: one console summary. Contains names/counts only — never a token's
	 * computed value, never a token/secret.
	 */
	function consoleSummary(reason) {
		const bodyStyles = scanBodyStyles();
		const dreamSkin = dreamSkinDiagnostics();
		return {
			at: new Date().toISOString(),
			reason,
			applied: !!runtime.active,
			pack: runtime.plan ? runtime.plan.packId : (store.get().activePackId || null),
			scheme: currentScheme(),
			layer: runtime.layer ? 1 : 0,
			safeMode: runtime.safeMode === true,
			mismatch: runtime.mismatch.length,
			fallback: runtime.fallbackNames.length,
			orderHealth: bodyStyles.orderHealth,
			lateStyles: bodyStyles.lateStyles.length,
			dreamSkin: {
				detected: dreamSkin.detected,
				cssSkin: dreamSkin.cssSkin,
				materialStyle: dreamSkin.materialStyle,
				bridge: dreamSkin.bridge
			},
			host: {
				available: runtime.hostInfo.available,
				version: runtime.hostInfo.version,
				pid: runtime.hostInfo.pid
			},
			hookHitRate: runtime.hooks ? runtime.hooks.hitRate : null
		};
	}

	function emitConsoleDiag(reason) {
		try {
			const summary = consoleSummary(reason);
			runtime.consoleDiag = { count: runtime.consoleDiag.count + 1, lastAt: summary.at, lastReason: reason };
			// console.info("[dsh-tavern-skin-engine] diag", summary) — §4.5 一次汇总
			console.info(TAG + " diag", summary);
		} catch { /* console summary must never break the engine */ }
	}

	/** §3.3: theme/change summaries are throttled to one per second. */
	function scheduleConsoleDiag(reason) {
		runtime.consolePendingReason = reason;
		if (runtime.consoleTimer) return;
		runtime.consoleTimer = setTimeout(() => {
			runtime.consoleTimer = null;
			const pending = runtime.consolePendingReason || reason;
			runtime.consolePendingReason = null;
			emitConsoleDiag(pending);
		}, 1000);
	}

	const AUTO_SAFE_MODE_MIN_AGE_MS = 15000;

	/**
	 * §3.6: auto safe mode with four guards — only when the engine is active,
	 * the drag handle is gone AND the frame grid is no longer host-shaped, the
	 * page has been up >15 s, this session never triggered it, and no draft
	 * preview is running. Called only from the existing verifyNow() throttle.
	 */
	function maybeAutoSafeMode() {
		try {
			if (runtime.autoSafeMode.triggered) return false;
			if (!runtime.active) return false;
			if (runtime.preview && runtime.preview.active) return false;
			const age = pageAgeMs();
			if (age < AUTO_SAFE_MODE_MIN_AGE_MS) return false;
			const grid = frameGrid();
			if (grid === null) return false;
			const gridHost = gridLooksHost(grid);
			const handle = !!document.querySelector('[data-side="sidebar"]');
			if (handle !== false) return false;
			if (gridHost !== false) return false;
			const at = new Date().toISOString();
			runtime.autoSafeMode = { triggered: true, at, reason: "layout-violation" };
			try {
				console.warn(TAG, "布局自检失败：三栏把手缺失且 frame grid 已被改写，已自动进入安全模式", {
					frameGrid: grid,
					handlePresent: handle,
					pageAgeMs: Math.round(age)
				});
			} catch { /* ignore */ }
			setSafeMode(true);
			return true;
		} catch { return false; }
	}

	function readToken(name) {
		try { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
		catch { return ""; }
	}

	function resolvePack(id) {
		if (!id) return null;
		if (typeof BUILTIN_PACKS === "object" && BUILTIN_PACKS && BUILTIN_PACKS[id]) {
			const entry = BUILTIN_PACKS[id];
			return { pack: entry.pack, css: entry.css || null, builtin: true };
		}
		return null;
	}

	async function loadPack() {
		const id = store.get().activePackId;
		runtime.pack = null;
		if (!id) return;
		const builtin = resolvePack(id);
		if (builtin) { runtime.pack = builtin; return; }
		try {
			const remote = await store.api("packs.get", { id });
			if (remote && remote.pack) runtime.pack = { pack: remote.pack, css: remote.css || null, builtin: false };
		} catch (error) {
			runtime.lastError = String((error && error.message) || error);
		}
	}

	function withdraw(reason) {
		stopVerify();
		stopProbe();
		if (runtime.layer) {
			try { runtime.layer(); } catch { /* disposers must not throw */ }
			runtime.layer = null;
		}
		runtime.active = false;
		runtime.fallbackNames = [];
		runtime.mismatch = [];
		runtime.missing = [];
		runtime.setTokens = [];
		runtime.committedSetTokens = [];
		runtime.preview = null;
		setRecipeTokens([]);
		removeVarsStyle();
		removeFontsStyle();
		removePackStyle();
		removePreviewStyle();
		removeUserCssStyle();
		runtime.userCss = { ...runtime.userCss, present: false };
		runtime.packCss = { present: false, ok: null, bytes: 0, rewrittenCount: 0, errors: [], warnings: [], firstError: null };
		runtime.fonts = [];
		runtime.fontFaces = "";
		runtime.hooks = null;
		runtime.lastReason = reason || "withdraw";
		notify();
	}

	function scheduleVerify() {
		if (!runtime.plan) return;
		for (const delay of [40, 500, 1500, 4000]) {
			const timer = setTimeout(() => {
				runtime.verifyTimers = runtime.verifyTimers.filter((item) => item !== timer);
				verifyNow();
			}, delay);
			runtime.verifyTimers.push(timer);
		}
		// dream-skin republishes its appearance layer after ITS host state hydrates
		// (measured: >4 s after page load). A bounded poll catches that late write
		// and any later skin switch without ever stacking a token layer.
		if (!runtime.verifyPoll) {
			runtime.verifyPollTicks = 0;
			runtime.verifyPoll = setInterval(() => {
				runtime.verifyPollTicks += 1;
				if (!runtime.active || runtime.verifyPollTicks > 40) {
					if (runtime.verifyPoll) clearInterval(runtime.verifyPoll);
					runtime.verifyPoll = null;
					return;
				}
				// Fallback path for the scheme gate even if a host build does not
				// forward theme/change to third-party contexts.
				const scheme = currentScheme();
				if (scheme !== runtime.scheme) {
					runtime.scheme = scheme;
					const should = shouldBeActive();
					if (should !== runtime.active) {
						if (should) apply("scheme-activated");
						else withdraw("scheme-inactive");
						return;
					}
				}
				verifyNow();
			}, 1500);
		}
		if (!runtime.bodyObserver && typeof MutationObserver === "function") {
			// dream-skin republishes its token layer asynchronously and the shell
			// writes the composed values inline on <body>; watch that write (not
			// theme/change) so the !important safety net lands after the winner.
			runtime.bodyObserver = new MutationObserver(() => {
				if (!runtime.active || runtime.applying) return;
				if (runtime.preview && runtime.preview.active) return;
				if (runtime.verifyDebounce) return;
				runtime.verifyDebounce = setTimeout(() => {
					runtime.verifyDebounce = null;
					verifyNow();
				}, 250);
			});
			runtime.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["style", "data-ds-dark-theme"] });
		}
	}

	function stopVerify() {
		for (const timer of runtime.verifyTimers) clearTimeout(timer);
		runtime.verifyTimers = [];
		if (runtime.verifyDebounce) { clearTimeout(runtime.verifyDebounce); runtime.verifyDebounce = null; }
		if (runtime.verifyPoll) { clearInterval(runtime.verifyPoll); runtime.verifyPoll = null; }
		if (runtime.bodyObserver) { runtime.bodyObserver.disconnect(); runtime.bodyObserver = null; }
	}

	/* ── Step 4: drift probe + resources + pack CSS ───────────────────────── */

	function stopProbe() {
		for (const timer of runtime.probeTimers) clearTimeout(timer);
		runtime.probeTimers = [];
	}

	function probeNow() {
		if (!runtime.active) return runtime.hooks;
		// The host may evict unused font faces after a big DOM change; refresh them
		// so diagnostics and document.fonts.check() reflect the applied pack.
		if (runtime.pack && runtime.pack.pack && runtime.fonts.length > 0) void loadPackFonts(runtime.pack.pack);
		try {
			const registry = probeRegistry(document);
			const slots = probeSlots(document);
			runtime.hooks = {
				...registry,
				slots,
				slotHitRate: slots.hitRate,
				at: new Date().toISOString()
			};
		} catch (error) {
			runtime.lastError = String((error && error.message) || error);
		}
		notify();
		return runtime.hooks;
	}

	/** Re-probe after boot and after the shell lazy-renders a conversation. */
	function scheduleProbe() {
		stopProbe();
		for (const delay of [0, 1200, 4000, 10000]) {
			const timer = setTimeout(() => {
				runtime.probeTimers = runtime.probeTimers.filter((item) => item !== timer);
				probeNow();
			}, delay);
			runtime.probeTimers.push(timer);
		}
	}

	async function loadPackFonts(pack) {
		const checks = listFontChecks(pack && pack.typography);
		runtime.fonts = checks.map((font) => ({ ...font, loaded: false, check: false, error: null }));
		if (runtime.fonts.length === 0) { notify(); return; }
		if (!document.fonts || typeof document.fonts.load !== "function" || typeof document.fonts.check !== "function") {
			for (const font of runtime.fonts) font.error = "FontFaceSet API 不可用";
			notify();
			return;
		}
		for (const font of runtime.fonts) {
			const spec = `${font.weight} 16px "${font.family}"`;
			try { await document.fonts.load(spec); } catch (error) { font.error = String((error && error.message) || error); }
			try { font.check = document.fonts.check(spec); } catch { font.check = false; }
			font.loaded = true;
			notify();
		}
	}

	/**
	 * Inject the pack theme.css (unsafe channel) AFTER rewriting url(assets/…)
	 * and prechecking it. A syntax/layout error blocks injection and keeps the
	 * first error (with line number) visible in diagnostics.
	 */
	function applyPackCss(pack, assetBase) {
		const raw = runtime.pack && typeof runtime.pack.css === "string" ? runtime.pack.css : null;
		if (!raw) {
			removePackStyle();
			runtime.packCss = { present: false, ok: null, bytes: 0, rewrittenCount: 0, errors: [], warnings: [], firstError: null };
			return;
		}
		const rewritten = rewriteAssetUrls(raw, assetBase);
		const check = precheckThemeCss(rewritten, { filename: "theme.css" });
		if (!check.ok) {
			removePackStyle();
			runtime.packCss = {
				present: false,
				ok: false,
				bytes: utf8ByteLength(rewritten),
				rewrittenCount: listAssetUrls(raw).length,
				errors: check.errors.slice(0, 8),
				warnings: check.warnings.slice(0, 8),
				firstError: check.errors[0] || null
			};
			log("theme.css blocked before injection", check.errors[0]);
			notify();
			return;
		}
		ensurePackStyle().textContent = rewritten;
		runtime.packCss = {
			present: true,
			ok: true,
			bytes: check.stats.bytes,
			rewrittenCount: listAssetUrls(raw).length,
			errors: [],
			warnings: check.warnings.slice(0, 8),
			firstError: null
		};
	}

	/**
	 * Public precheck/preview entry (Step 5 custom-CSS row will reuse this):
	 * returns the line-numbered errors instead of injecting broken CSS.
	 */
	function previewCss(css, options = {}) {
		const assetBase = runtime.assetBase || "/dsh-tavern-skin/assets/builtin/unknown";
		const text = rewriteAssetUrls(String(css == null ? "" : css), assetBase);
		const check = precheckThemeCss(text, { filename: options.filename || "custom.css", allowUnsafe: options.allowUnsafe === true });
		const result = {
			injected: false,
			ok: check.ok,
			errors: check.errors,
			warnings: check.warnings,
			stats: check.stats,
			assetUrls: listAssetUrls(String(css == null ? "" : css))
		};
		if (!check.ok) { runtime.customCss = result; notify(); return result; }
		ensurePackStyle().textContent = text;
		result.injected = true;
		runtime.customCss = result;
		notify();
		return result;
	}


	/**
	 * Re-check the composed values and keep the `!important` safety net up to date.
	 * This never stacks an override layer (方案 §4.3 rule 3) and never emits
	 * theme/change itself, so it cannot race with dream-skin.
	 */
	function verifyNow() {
		// A draft preview must never be verified/pinned as if it were committed:
		// #dshte-vars currently carries draft values and #dshte-preview holds the
		// host-token deltas (契约 §4: 预览热替换时不触发 !important 兜底).
		if (runtime.preview && runtime.preview.active) return;
		if (!runtime.plan || !runtime.theme || !runtime.active) return;
		// self-heal: React portals / third-party plugins may remove our nodes.
		ensureEngineStyle();
		ensureVarsStyle();
		if (runtime.fontFaces) ensureFontsStyle();
		if (runtime.packCss.present) ensurePackStyle();
		const scheme = currentScheme();
		let diff = diffComposedTokens(runtime.plan, scheme, readToken);
		const names = [...new Set([...diff.mismatched, ...diff.missing].map((item) => item.name))];
		// Never DROP a fallback inside one layer lifetime: dream-skin republishes
		// its layer on a timer, and removing+re-adding the net would visibly flap
		// the palette. The net is rebuilt from scratch on every apply/withdraw.
		const needed = [...new Set([...runtime.fallbackNames, ...names])];
		const fallback = { light: {}, dark: {} };
		for (const name of needed) {
			const pair = runtime.plan.host[name];
			if (!pair) continue;
			fallback.light[name] = pair.light;
			fallback.dark[name] = pair.dark;
		}
		if (needed.length > 0) {
			try {
				writeVarsStyle(runtime.plan, fallback);
			} catch (error) {
				runtime.lastError = String((error && error.message) || error);
			}
		}
		if (needed.length > 0) diff = diffComposedTokens(runtime.plan, scheme, readToken);
		runtime.mismatch = diff.mismatched;
		runtime.missing = diff.missing;
		runtime.unverifiable = diff.unverifiable;
		runtime.fallbackNames = needed;
		// §3.6: the auto safe-mode check lives on this existing throttle path only.
		maybeAutoSafeMode();
		notify();
	}

	/**
	 * Compile + stack the layer, verify computed values, and add the
	 * `!important` fallback only for tokens the host layer did not deliver.
	 */
	function apply(reason, options = {}) {
		if (runtime.applying) return;
		if (runtime.safeMode) { runtime.lastReason = `${reason}:safe-mode`; notify(); return; }
		if (!runtime.theme) { runtime.lastReason = `${reason}:no-theme`; notify(); return; }
		if (!shouldBeActive()) { withdraw(`${reason}:inactive`); return; }
		const pack = runtime.pack ? runtime.pack.pack : null;
		if (!pack) { withdraw(`${reason}:no-pack`); return; }
		runtime.applying = true;
		try {
			// A committed apply always ends a pending preview overlay first; the
			// preview block is disposable and must never survive into the layer.
			removePreviewStyle();
			runtime.preview = null;
			const compiled = compilePackPlan(pack, store.get().overrides, currentPolicy());
			const plan = compiled.plan;
			const scheme = currentScheme();
			runtime.recipes = compiled.recipePlan;
			runtime.setTokens = compiled.setTokens.slice();
			runtime.committedSetTokens = compiled.setTokens.slice();
			runtime.assetBase = compiled.assetBase;
			runtime.fontFaces = renderFontFaces(pack.typography, compiled.assetBase);
			setRecipeTokens(compiled.setTokens);
			runtime.plan = plan;
			runtime.scheme = scheme;

			// Four allowed stacking moments; restack = replace our single source layer.
			if (runtime.layer && options.restack !== false) {
				try { runtime.layer(); } catch { /* ignore */ }
				runtime.layer = null;
			}
			let layerError = null;
			runtime.active = true; // set before overrideTokens emits theme/change (re-entrancy)
			try {
				runtime.layer = runtime.theme.overrideTokens(SOURCE, plan.host);
				runtime.lastError = null;
			} catch (error) {
				layerError = String((error && error.message) || error);
				runtime.layer = null;
				runtime.active = false;
				runtime.lastError = layerError;
			}

			let diff = layerError
				? { mismatched: Object.keys(plan.host).map((name) => ({ name, expected: expectedHostValue(plan, scheme, name), actual: readToken(name) })), missing: [], unverifiable: [] }
				: diffComposedTokens(plan, scheme, readToken);
			const fallbackNames = layerError
				? Object.keys(plan.host)
				: [...new Set([...diff.mismatched, ...diff.missing].map((item) => item.name))];
			const fallback = fallbackFor(fallbackNames, plan);

			try {
				writeVarsStyle(plan, fallbackNames.length > 0 ? fallback : null);
			} catch (error) {
				runtime.lastError = String((error && error.message) || error);
			}
			writeFontsStyle();
			applyPackCss(pack, compiled.assetBase);
			// Custom CSS is always (re)published AFTER the pack block, so a pack
			// stylesheet cannot outrank the user's own rules in tree order.
			publishUserCss();
			void loadPackFonts(pack);
			scheduleProbe();
			if (fallbackNames.length > 0) diff = diffComposedTokens(plan, scheme, readToken);

			runtime.mismatch = diff.mismatched;
			runtime.missing = diff.missing;
			runtime.unverifiable = diff.unverifiable;
			runtime.fallbackNames = fallbackNames;
			runtime.lastApplyAt = new Date().toISOString();
			runtime.lastReason = reason;
			log("apply", reason, {
				pack: plan.packId,
				hostTokens: plan.hostTokenCount,
				engineTokens: plan.engineTokenCount,
				fallback: fallbackNames.length,
				mismatched: runtime.mismatch.length,
				layer: !!runtime.layer
			});
		} finally {
			runtime.applying = false;
		}
		scheduleVerify();
		notify();
	}

	function reassert() {
		// The fourth allowed moment: user explicitly asks our layer to win.
		// §3.2: returns the before/after mismatch counts; the 2 s re-check is done
		// by the diagnostics row via diagnostics() (read-only, no second restack).
		const mismatchBefore = runtime.mismatch.length;
		apply("reassert", { restack: true });
		const result = {
			ok: !!runtime.active,
			mismatchBefore,
			mismatched: runtime.mismatch.length,
			layerCount: runtime.layer ? 1 : 0
		};
		runtime.reassertInfo = {
			lastAt: new Date().toISOString(),
			mismatchBefore,
			mismatchAfter: null,
			stillOverridden: null
		};
		emitConsoleDiag("reassert");
		return result;
	}

	/* ── Step 5: live preview / custom CSS / safe mode ────────────────────── */

	function renderPreviewDeclarations(values) {
		if (!values) return "";
		return Object.entries(values)
			.filter(([name, value]) => isHostToken(name) && isSafeCssValue(value))
			.map(([name, value]) => `  ${name}: ${value} !important;`)
			.join("\n");
	}

	function renderPreviewCss(diff) {
		const blocks = [];
		const light = renderPreviewDeclarations(diff && diff.light);
		const dark = renderPreviewDeclarations(diff && diff.dark);
		if (light) blocks.push(`body {\n${light}\n}`);
		if (dark) blocks.push(`body[data-ds-dark-theme] {\n${dark}\n}`);
		return blocks.join("\n");
	}

	/**
	 * Preview a draft override table WITHOUT stacking a token layer (契约 §4):
	 * only rewrites #dshte-vars text, toggles the opt-in set tokens and writes
	 * the disposable #dshte-preview block for changed HOST tokens.
	 * @returns {{ok: boolean, reason?: string, hostDiffCount: number, setTokens: number}}
	 */
	function preview(overrides) {
		if (runtime.safeMode) return { ok: false, reason: "safe-mode", hostDiffCount: 0, setTokens: 0 };
		if (!runtime.active || !runtime.layer || !runtime.pack || !runtime.pack.pack || !runtime.plan) {
			return { ok: false, reason: "inactive", hostDiffCount: 0, setTokens: 0 };
		}
		const draft = compilePackPlan(runtime.pack.pack, overrides, currentPolicy());
		const fallback = fallbackFor(runtime.fallbackNames, draft.plan);
		try {
			writeVarsStyle(draft.plan, runtime.fallbackNames.length > 0 ? fallback : null);
			setRecipeTokens(draft.setTokens);
		} catch (error) {
			return { ok: false, reason: String((error && error.message) || error), hostDiffCount: 0, setTokens: 0 };
		}
		const diff = { light: {}, dark: {} };
		const changed = new Set();
		for (const [name, pair] of Object.entries(draft.plan.host)) {
			const committed = runtime.plan.host[name];
			if (!committed || committed.light !== pair.light) { diff.light[name] = pair.light; changed.add(name); }
			if (!committed || committed.dark !== pair.dark) { diff.dark[name] = pair.dark; changed.add(name); }
		}
		const text = renderPreviewCss(diff);
		const element = ensurePreviewStyle();
		if (element.textContent !== text) element.textContent = text;
		runtime.preview = { active: true, hostDiffCount: changed.size, at: new Date().toISOString(), setTokens: draft.setTokens.slice() };
		// Deliberately NO scheduleVerify(): a draft value must not be pinned as
		// the committed !important fallback.
		notify();
		return { ok: true, hostDiffCount: changed.size, setTokens: draft.setTokens.length };
	}

	/** Drop the preview overlay and restore the committed plan verbatim. */
	function clearPreview() {
		removePreviewStyle();
		runtime.preview = null;
		if (runtime.plan) {
			const fallback = fallbackFor(runtime.fallbackNames, runtime.plan);
			try {
				writeVarsStyle(runtime.plan, runtime.fallbackNames.length > 0 ? fallback : null);
			} catch (error) {
				runtime.lastError = String((error && error.message) || error);
			}
			setRecipeTokens(runtime.committedSetTokens);
		}
		notify();
	}

	/**
	 * Precheck + inject the custom-CSS block (契约 §4): a failing precheck never
	 * replaces a working stylesheet, and errors carry line numbers.
	 */
	function setUserCss(text) {
		const source = typeof text === "string" ? text : String(text == null ? "" : text);
		const lineCount = source.length === 0 ? 0 : source.split("\n").length;
		if (source.trim().length === 0) {
			removeUserCssStyle();
			runtime.userCssText = "";
			runtime.userCss = { present: false, ok: true, bytes: 0, errors: [], warnings: [], firstError: null, rewrittenCount: 0, lineCount: 0 };
			notify();
			return { ok: true, injected: false, errors: [], warnings: [], bytes: 0, lineCount: 0, rewrittenCount: 0 };
		}
		const assetBase = runtime.assetBase || "/dsh-tavern-skin/assets/builtin/unknown";
		const rewritten = rewriteAssetUrls(source, assetBase);
		const check = precheckThemeCss(rewritten, { filename: "custom.css" });
		const rewrittenCount = listAssetUrls(source).length;
		const bytes = check.stats && typeof check.stats.bytes === "number" ? check.stats.bytes : utf8ByteLength(rewritten);
		if (!check.ok) {
			const existing = document.getElementById(USER_CSS_STYLE_ID);
			runtime.userCss = {
				present: !!(existing && existing.textContent),
				ok: false,
				bytes,
				errors: check.errors.slice(0, 12),
				warnings: check.warnings.slice(0, 12),
				firstError: check.errors[0] || null,
				rewrittenCount,
				lineCount
			};
			log("custom CSS blocked before injection", check.errors[0]);
			notify();
			return { ok: false, injected: false, errors: check.errors, warnings: check.warnings, bytes, lineCount, rewrittenCount };
		}
		const element = ensureUserCssStyle();
		if (element.textContent !== rewritten) element.textContent = rewritten;
		runtime.userCssText = source;
		runtime.userCss = { present: true, ok: true, bytes, errors: [], warnings: check.warnings.slice(0, 12), firstError: null, rewrittenCount, lineCount };
		notify();
		return { ok: true, injected: true, errors: [], warnings: check.warnings, bytes, lineCount, rewrittenCount };
	}

	/** Re-publish the in-memory CSS after a pack switch (asset base may change). */
	function publishUserCss() {
		if (!runtime.userCssText) { removeUserCssStyle(); return; }
		const assetBase = runtime.assetBase || "/dsh-tavern-skin/assets/builtin/unknown";
		const rewritten = rewriteAssetUrls(runtime.userCssText, assetBase);
		const element = ensureUserCssStyle();
		if (element.textContent !== rewritten) element.textContent = rewritten;
		runtime.userCss = { ...runtime.userCss, present: true };
	}

	function restoreSavedUserCss() {
		let saved = null;
		try { saved = store.getCustomCss(); }
		catch (error) { log("read saved custom CSS failed", String((error && error.message) || error)); }
		if (saved && typeof saved.text === "string" && saved.text) setUserCss(saved.text);
	}

	/** The lifeline switch (契约 §0.6 / §4): on = inert, off = reload + apply. */
	function setSafeMode(on) {
		const want = on === true;
		if (want === runtime.safeMode) { notify(); return; }
		try { store.setSafeMode(want); }
		catch (error) { log("persist safe mode failed", String((error && error.message) || error)); }
		runtime.safeMode = want;
		if (want) {
			withdraw("safe-mode");
			removePreviewStyle();
			removeUserCssStyle();
			runtime.preview = null;
			log("safe mode on: token layer withdrawn, static rules inactive");
			notify();
			return;
		}
		log("safe mode off: reloading pack");
		void restorePack();
	}

	async function restorePack() {
		if (runtime.safeMode) return;
		if (!runtime.theme) { injectTheme(); return; }
		try {
			await reloadPack();
			restoreSavedUserCss();
			await store.userFonts.restore();
		} catch (error) {
			runtime.lastError = String((error && error.message) || error);
			log("restore after safe mode failed", runtime.lastError);
		}
	}

	/** Advanced row「重新加载主题包」/「清缓存后恢复」(契约 §4). */
	async function reloadPack() {
		if (runtime.safeMode) { notify(); return; }
		if (!runtime.theme) { injectTheme(); return; }
		try {
			await loadPack();
			apply("reload", { restack: true });
		} catch (error) {
			runtime.lastError = String((error && error.message) || error);
			log("reloadPack failed", runtime.lastError);
			notify();
		}
	}

	function injectTheme() {
		if (runtime.theme || runtime.offInject) return;
		// The theme service is resolved lazily so the plugin still loads (and the
		// settings page still opens) if a future host lacks it (方案 §1.8).
		runtime.offInject = ctx.inject(["theme"], (themeCtx) => {
			runtime.theme = themeCtx.theme;
			// Subscribe on the ROOT ctx (dream-skin does the same): a child
			// inject context is not guaranteed to forward feature events.
			runtime.offTheme = ctx.on("theme/change", onThemeChange);
			void boot();
		});
	}

	function userCssDiagnostics() {
		const element = runtime.userCssEl && document.body && document.body.contains(runtime.userCssEl)
			? runtime.userCssEl
			: document.getElementById(USER_CSS_STYLE_ID);
		return {
			present: !!(element && element.textContent),
			ok: runtime.userCss.ok,
			bytes: runtime.userCss.bytes,
			lineCount: runtime.userCss.lineCount,
			rewrittenCount: runtime.userCss.rewrittenCount,
			errors: runtime.userCss.errors.slice(0, 8),
			firstError: runtime.userCss.firstError
		};
	}

	function listStyleOrder() {
		const order = [];
		try {
			for (const element of document.querySelectorAll("style")) {
				order.push(element.id || (element.dataset && element.dataset.plugin ? element.dataset.plugin : "(anon)"));
			}
		} catch { /* ignore */ }
		return order;
	}

	function diagnostics() {
		const state = store.get();
		const bodyStyles = scanBodyStyles();
		const dreamSkin = dreamSkinDiagnostics();
		const live = runtime.plan && runtime.theme ? diffComposedTokens(runtime.plan, currentScheme(), readToken) : null;
		// §3.4: every mismatch entry carries a heuristic "who overrides it" guess.
		const mismatch = (live ? live.mismatched : runtime.mismatch).map((entry) => ({
			...entry,
			suspected: suspectFor(entry, dreamSkin, bodyStyles.lateStyles)
		}));
		const missing = live ? live.missing : runtime.missing;
		const required = REQUIRED_HOST_TOKENS.map((name) => ({
			name,
			expected: runtime.plan ? expectedHostValue(runtime.plan, currentScheme(), name) : null,
			actual: readToken(name)
		}));
		const currentGrid = frameGrid();
		if (!runtime.startupFrameGrid && currentGrid) runtime.startupFrameGrid = currentGrid;
		const handlePresent = !!document.querySelector('[data-side="sidebar"]');
		const gridHost = gridLooksHost(currentGrid);
		// "layout untouched" = the host still owns the inline grid (host-shaped
		// 3-track value) AND the drag handle is still there. Opening a
		// conversation legitimately changes the host grid (rightbar expands), so
		// this is NOT a before/after string comparison.
		const layoutUntouched = currentGrid === null ? null : (gridHost === true && handlePresent);
		const reasserted = runtime.reassertInfo.lastAt !== null;
		return {
			applied: runtime.active,
			enabled: state.enabled,
			activePackId: state.activePackId,
			packColorScheme: runtime.pack ? runtime.pack.pack.colorScheme : null,
			hasDarkBlock: !!(runtime.pack && runtime.pack.pack.tokens && runtime.pack.pack.tokens.dark),
			scheme: currentScheme(),
			policy: currentPolicy(),
			layerCount: runtime.layer ? 1 : 0,
			layerSource: SOURCE,
			hostTokenCount: runtime.plan ? runtime.plan.hostTokenCount : 0,
			engineTokenCount: runtime.plan ? runtime.plan.engineTokenCount : 0,
			requiredTokens: required,
			mismatch,
			mismatchCount: mismatch.length,
			missing,
			unverifiableCount: live ? live.unverifiable.length : runtime.unverifiable.length,
			fallbackNames: runtime.fallbackNames,
			rejected: runtime.plan ? runtime.plan.rejected : [],
			lastError: runtime.lastError,
			lastReason: runtime.lastReason,
			lastApplyAt: runtime.lastApplyAt,
			hostApi: store.hostStatus(),
			/* Step 7 diagnostics (契约 §3.1) */
			step: 7,
			host: {
				available: runtime.hostInfo.available,
				version: runtime.hostInfo.version,
				pid: runtime.hostInfo.pid,
				lastError: runtime.hostInfo.lastError,
				checkedAt: runtime.hostInfo.checkedAt
			},
			bodyStyles: {
				count: bodyStyles.count,
				order: bodyStyles.order,
				present: bodyStyles.present,
				lateStyles: bodyStyles.lateStyles,
				orderHealth: bodyStyles.orderHealth,
				note: bodyStyles.note
			},
			dreamSkin,
			layout: {
				handlePresent,
				frameGrid: currentGrid,
				startupFrameGrid: runtime.startupFrameGrid,
				untouched: layoutUntouched,
				alert: {
					active: runtime.autoSafeMode.triggered,
					at: runtime.autoSafeMode.at,
					reason: runtime.autoSafeMode.reason
				}
			},
			consoleDiag: {
				count: runtime.consoleDiag.count,
				lastAt: runtime.consoleDiag.lastAt,
				lastReason: runtime.consoleDiag.lastReason
			},
			autoSafeMode: {
				triggered: runtime.autoSafeMode.triggered,
				at: runtime.autoSafeMode.at,
				reason: runtime.autoSafeMode.reason
			},
			reassert: {
				lastAt: runtime.reassertInfo.lastAt,
				mismatchBefore: runtime.reassertInfo.mismatchBefore,
				// live count at diagnostics() time: the 2 s re-check re-reads this.
				mismatchAfter: reasserted ? mismatch.length : null,
				stillOverridden: reasserted ? mismatch.length > 0 : null
			},
			safeMode: runtime.safeMode || (typeof store.isSafeMode === "function" ? store.isSafeMode() === true : false),
			preview: {
				active: !!(runtime.preview && runtime.preview.active),
				hostDiffCount: runtime.preview ? runtime.preview.hostDiffCount : 0,
				at: runtime.preview ? runtime.preview.at : null,
				setTokens: runtime.preview ? runtime.preview.setTokens.length : 0
			},
			userCss: userCssDiagnostics(),
			lateStyles: bodyStyles.lateStyles,
			styleOrder: listStyleOrder(),
			store: typeof store.snapshot === "function" ? store.snapshot() : null,
			dreamSkinCssDetected: dreamSkin.cssSkin,
			varsStylePresent: !!(runtime.varsEl && document.body && document.body.contains(runtime.varsEl)),
			engineStylePresent: !!(runtime.engineCssEl && document.body && document.body.contains(runtime.engineCssEl)),
			packStylePresent: !!(runtime.packCssEl && document.body && document.body.contains(runtime.packCssEl)),
			fontsStylePresent: !!(runtime.fontsEl && document.body && document.body.contains(runtime.fontsEl)),
			assetBase: runtime.assetBase,
			setTokens: runtime.setTokens,
			recipes: runtime.recipes ? {
				regions: runtime.recipes.counts.regions,
				components: runtime.recipes.counts.components,
				declarations: runtime.recipes.counts.declarations,
				assetUrls: runtime.recipes.counts.assetUrls,
				warnings: runtime.recipes.warnings.slice(0, 12)
			} : null,
			packCss: runtime.packCss,
			fonts: runtime.fonts,
			customCss: runtime.customCss,
			hooks: runtime.hooks,
			hookHitRate: runtime.hooks ? runtime.hooks.hitRate : null,
			slotHitRate: runtime.hooks ? runtime.hooks.slotHitRate : null,
			componentsMissed: runtime.hooks ? runtime.hooks.missed.filter((entry) => entry.kind === "component") : [],
			frameGrid: currentGrid,
			startupFrameGrid: runtime.startupFrameGrid,
			frameGridChangedSinceStartup: runtime.startupFrameGrid === null ? null : currentGrid !== runtime.startupFrameGrid,
			handlePresent,
			gridLooksHost: gridHost,
			layoutUntouched
		};
	}

	function onThemeChange() {
		// Rule 3: never restack here. Only flip the layer when the active state
		// actually changes (missingScheme=inherit + scheme flip). Otherwise just
		// refresh the !important safety net (a stylesheet write, not a layer stack).
		runtime.themeEvents += 1;
		if (runtime.applying) return;
		// §3.3: one console summary per theme/change, throttled to 1 s (our own
		// restack-driven events return above and never count as external).
		runtime.lastThemeChangeAt = Date.now();
		scheduleConsoleDiag("theme-change");
		const should = shouldBeActive();
		const scheme = currentScheme();
		if (scheme !== runtime.scheme) log("theme/change", { from: runtime.scheme, to: scheme, should, active: runtime.active });
		runtime.scheme = scheme;
		if (should !== runtime.active) {
			if (should) apply("scheme-activated");
			else withdraw("scheme-inactive");
			return;
		}
		if (should) scheduleVerify();
		notify();
	}

	async function onStoreChange(_state, reason) {
		if (runtime.safeMode) { notify(); return; }
		if (reason === "host-state" || reason === "local-seed" || reason === "host-unavailable" || reason === "change" || reason === "host-fresh" || reason === "host-write-failed" || reason === "ui" || reason === "custom-css" || reason === "user-fonts") { notify(); return; }
		if (reason === "enabled") { if (store.get().enabled) apply("enabled", { restack: true }); else withdraw("disabled"); return; }
		if (reason === "activate") { await loadPack(); apply("activate", { restack: true }); return; }
		if (reason === "overrides" || reason === "schemePolicy") { apply(reason, { restack: true }); return; }
		notify();
	}

	async function boot() {
		runtime.startupFrameGrid = frameGrid();
		await loadPack();
		apply("startup", { restack: true });
		// Custom CSS + local fonts are client-only, so they are restored after the
		// pack layer exists (契约 §4 boot).
		restoreSavedUserCss();
		try { await store.userFonts.restore(); }
		catch (error) { log("user font restore failed", String((error && error.message) || error)); }
		if (!runtime.startupFrameGrid) runtime.startupFrameGrid = frameGrid();
		log("engine started", { pack: store.get().activePackId, scheme: currentScheme(), safeMode: runtime.safeMode });
		// §3.3: exactly one startup console summary (after the pack layer exists).
		emitConsoleDiag("startup");
	}

	async function start() {
		runtime.startupFrameGrid = frameGrid();
		// §3.1: host identity (version/pid) from the ping route; async, one shot.
		// A missing/failing route only flips `host.available` to false.
		void fetchHostInfo();
		// Static registry styles are injected immediately; every rule is opt-in via
		// html[data-dshte-set~=…], so nothing changes until a pack is applied.
		ensureEngineStyle();
		runtime.offStore = store.subscribe((state, reason) => { void onStoreChange(state, reason); });
		await store.hydrate();
		runtime.safeMode = store.isSafeMode() === true;
		if (runtime.safeMode) {
			// Lifeline: no token layer, no pack CSS, no user CSS. The static engine
			// styles stay injected but all their rules are opt-in → inert.
			log("safe mode is on: engine stays inert until it is switched off");
			emitConsoleDiag("startup");
			notify();
			return;
		}
		injectTheme();
	}

	function dispose() {
		stopVerify();
		stopProbe();
		if (runtime.consoleTimer) { clearTimeout(runtime.consoleTimer); runtime.consoleTimer = null; }
		try { if (runtime.offInject) runtime.offInject(); } catch { /* ignore */ }
		try { if (runtime.offTheme) runtime.offTheme(); } catch { /* ignore */ }
		try { if (runtime.offStore) runtime.offStore(); } catch { /* ignore */ }
		runtime.offInject = null;
		runtime.offTheme = null;
		runtime.offStore = null;
		if (runtime.layer) { try { runtime.layer(); } catch { /* ignore */ } runtime.layer = null; }
		setRecipeTokens([]);
		removeVarsStyle();
		removeFontsStyle();
		removePackStyle();
		removePreviewStyle();
		removeUserCssStyle();
		removeEngineStyle();
		runtime.preview = null;
		runtime.active = false;
	}

	return {
		start,
		apply,
		withdraw,
		reassert,
		diagnostics,
		dispose,
		subscribe: (listener) => { runtime.listeners.add(listener); return () => runtime.listeners.delete(listener); },
		currentScheme,
		frameGrid,
		probe: () => probeNow(),
		previewCss,
		/* Step 5 public surface (契约 §4) */
		preview,
		clearPreview,
		setUserCss,
		setSafeMode,
		reloadPack,
		hooks: () => runtime.hooks,
		debugVerify: verifyNow,
		debugState: () => ({
			active: runtime.active,
			applying: runtime.applying,
			fallbackNames: runtime.fallbackNames.slice(),
			mismatch: runtime.mismatch.length,
			verifyTimers: runtime.verifyTimers.length,
			hasObserver: !!runtime.bodyObserver,
			plan: !!runtime.plan,
			themeEvents: runtime.themeEvents,
			scheme: runtime.scheme,
			setTokens: runtime.setTokens.slice(),
			committedSetTokens: runtime.committedSetTokens.slice(),
			fonts: runtime.fonts.length,
			packCss: runtime.packCss.present,
			safeMode: runtime.safeMode,
			preview: runtime.preview ? runtime.preview.hostDiffCount : -1,
			previewActive: !!(runtime.preview && runtime.preview.active),
			userCssBytes: runtime.userCss.bytes,
			userCssPresent: !!(runtime.userCssEl && document.body && document.body.contains(runtime.userCssEl) && runtime.userCssEl.textContent)
		})
	};
}
