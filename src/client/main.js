/**
 * dsh-tavern-skin-engine — browser half entry (classic script).
 *
 * BUILD TEMPLATE: scripts/build-client.mjs
 *   - expands "// @include <path>"          → plain client fragments
 *   - expands "// @inline-shared <path>"    → src/shared/*.js with `export ` stripped
 *   - replaces "// @builtin-packs"          → const BUILTIN_PACKS = {...} (themes/ snapshot)
 *   - replaces __PLUGIN_ID__ / __VERSION__ / __MARKER__
 * and writes lib/client.js. Never load this template directly.
 *
 * Contract (补查报告 §1.3): classic script, top-level only
 * window.__ModuleLoader__.load({ id, factory }); id = package.json.name;
 * factory returns { name, apply, inject }; only platform seeds may be required.
 *
 * Step 5: the settings page is a single component (all 15 rows share one draft
 * + apply/cancel lifecycle); preview only rewrites style-block content and never
 * stacks a new override layer (方案 §5.4).
 */
window.__ModuleLoader__.load({
	id: "__PLUGIN_ID__",
	factory: (require) => {
		"use strict";

		const React = require("react");

		// @include ./parts/log.js
		// @inline-shared ../shared/token-plan.js
		// @inline-shared ../shared/css-precheck.js
		// @include ./store.js
		// @inline-shared ../shared/recipes.js
		// @inline-shared ../shared/ui-knobs.js
		// @inline-css ./styles/engine.css
		// @include ./engine.js
		// @builtin-packs
		// @include ./parts/ui-kit.js
		// @include ./parts/preview.js
		// @include ./parts/rows-pack.js
		// @include ./parts/rows-theme.js
		// @include ./parts/rows-structure.js
		// @include ./parts/rows-misc.js
		// @include ./parts/rows-packio.js
		// @include ./parts/settings.js

		const inject = ["slots"];
		let sectionOff = null;
		let engine = null;
		let store = null;

		/** Debug/acceptance helper: compiled knob model for a built-in pack. */
		function modelFor(id) {
			const entry = BUILTIN_PACKS && BUILTIN_PACKS[id];
			if (!entry || !entry.pack) return null;
			try {
				const recipe = compileRecipes(entry.pack);
				return buildKnobModel(entry.pack, {
					baseVars: compilePackBaseVars(entry.pack),
					recipeVars: recipe.vars.light
				});
			} catch (error) {
				console.warn(TAG, "modelFor failed", error);
				return null;
			}
		}

		function apply(ctx) {
			try {
				window.__dshteSkeleton = { applied: true, plugin: "__PLUGIN_ID__", version: VERSION, marker: MARKER, at: new Date().toISOString() };
				log("client apply", VERSION, MARKER, "step7");
				store = createStateStore();
				engine = createSkinEngine(ctx, store);
				window.__dshte = {
					version: VERSION,
					marker: MARKER,
					step: 7,
					store,
					engine,
					rowIds: STEP5_ROW_IDS.slice(),
					diagnostics: () => engine.diagnostics(),
					probe: () => engine.probe(),
					previewCss: (css, options) => engine.previewCss(css, options),
					preview: (overrides) => engine.preview(overrides),
					clearPreview: () => engine.clearPreview(),
					setUserCss: (text) => engine.setUserCss(text),
					setSafeMode: (on) => engine.setSafeMode(on),
					reloadPack: () => engine.reloadPack(),
					reassert: () => engine.reassert(),
					applyPack: (id) => store.set({ activePackId: id, enabled: true }, { reason: "activate" }),
					disable: () => store.set({ enabled: false }, { reason: "enabled" }),
					storeSnapshot: () => store.snapshot(),
					packs: () => store.packs(),
					refreshPacks: () => store.refreshPacks(),
					modelFor
				};
				window.__dshteStep5 = { marker: MARKER, version: VERSION, at: new Date().toISOString() };
				// Step 6 acceptance surface (docs/step6-plan.md §8): packs + refresh.
				window.__dshteStep6 = {
					marker: MARKER,
					version: VERSION,
					step: 6,
					at: new Date().toISOString(),
					packs: () => store.packs(),
					packMeta: (id) => store.packMeta(id),
					isBuiltin: (id) => store.isBuiltin(id),
					trash: () => store.trash(),
					refreshPacks: async () => {
						const value = await store.refreshPacks();
						await store.refreshTrash();
						return value;
					},
					refreshTrash: () => store.refreshTrash(),
					apiRaw: (method, args) => store.apiRaw(method, args),
					snapshot: () => store.snapshot()
				};
				// Step 7 acceptance surface (docs/step7-plan.md §3.7): §4.5 diagnostics,
				// 「以本主题为准」 and host identity. Step 5/6 surfaces stay for regression.
				window.__dshteStep7 = {
					marker: MARKER,
					version: VERSION,
					step: 7,
					at: new Date().toISOString(),
					diagnostics: () => engine.diagnostics(),
					reassert: () => engine.reassert(),
					hostInfo: () => engine.diagnostics().host
				};
				const Section = () => React.createElement(SkinEngineSection, { store, engine });
				sectionOff = ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "skin-engine",
					order: 60,
					label: "皮肤引擎"
				}, Section));
				log("settings.section registered", "skin-engine");
				engine.start().catch((error) => console.warn(TAG, "engine start failed (variables stay off)", error));
			} catch (error) {
				window.__dshteSkeleton = {
					applied: false,
					plugin: "__PLUGIN_ID__",
					version: VERSION,
					marker: MARKER,
					error: String((error && error.stack) || error).slice(0, 500)
				};
				console.warn(TAG, "apply failed (plugin stays inert)", error);
			}
			return () => {
				try { sectionOff?.(); } catch { /* disposal must never throw */ }
				try { engine?.dispose(); } catch { /* disposal must never throw */ }
				sectionOff = null;
				engine = null;
				store = null;
			};
		}

		return { name: "__PLUGIN_ID__", apply, inject };
	}
});
