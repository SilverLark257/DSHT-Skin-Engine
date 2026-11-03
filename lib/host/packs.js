/**
 * Built-in theme packs (read-only): plugin root `themes/<id>/`.
 * The host half validates once per request with the same v1 validator the CLI
 * uses, so a broken builtin pack can never reach the browser unnoticed.
 *
 * Step 6: user-imported packs live in `skin-engine/packs/<id>/`; `packs.get`
 * for those is implemented in `packs-io.js` (this module stays the read-only
 * built-in source, so there is no import cycle between the two).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateThemePack, validateThemeCss } from "../../src/shared/pack-schema.js";

const THEMES_DIR = fileURLToPath(new URL("../../themes/", import.meta.url));
const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;

/** Absolute root of the read-only built-in pack directory (`themes/`). */
export function builtinPacksRoot() {
	return THEMES_DIR;
}

/** Absolute directory of one built-in pack (no path validation; caller validates the id). */
export function builtinPackDir(id) {
	return join(THEMES_DIR, id);
}

export function listBuiltinPacks() {
	if (!existsSync(THEMES_DIR)) return [];
	const packs = [];
	for (const id of readdirSync(THEMES_DIR).sort()) {
		if (!ID_RE.test(id)) continue;
		const dir = join(THEMES_DIR, id);
		if (!statSync(dir).isDirectory()) continue;
		try {
			const pack = JSON.parse(readFileSync(join(dir, "theme.json"), "utf8"));
			if (!validateThemePack(pack).ok) continue;
			packs.push({
				id,
				name: pack.name,
				nameZh: pack.nameZh || null,
				release: pack.release || "1.0.0",
				colorScheme: pack.colorScheme,
				preview: pack.preview || null,
				author: pack.author === undefined ? null : pack.author,
				description: pack.description || null,
				source: "builtin"
			});
		} catch { /* skip a broken pack folder, keep the rest available */ }
	}
	return packs;
}

export function getBuiltinPack(id) {
	if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, error: "非法主题包 id" };
	const dir = join(THEMES_DIR, id);
	if (!existsSync(dir)) return { ok: false, error: `找不到内置主题包「${id}」` };
	try {
		const pack = JSON.parse(readFileSync(join(dir, "theme.json"), "utf8"));
		const result = validateThemePack(pack);
		if (!result.ok) return { ok: false, error: "内置主题包校验失败：" + result.errors.map((item) => `${item.path} ${item.message}`).join("; ") };
		let css = null;
		if (typeof pack.css === "string") {
			const cssText = readFileSync(join(dir, pack.css), "utf8");
			const cssResult = validateThemeCss(cssText, { filename: pack.css });
			if (!cssResult.ok) return { ok: false, error: "内置主题包 CSS 校验失败：" + cssResult.errors.map((item) => `${item.path} ${item.message}`).join("; ") };
			css = cssText;
		}
		return { ok: true, pack, css };
	} catch (error) {
		return { ok: false, error: String((error && error.message) || error) };
	}
}
