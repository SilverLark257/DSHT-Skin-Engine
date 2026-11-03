/**
 * dsh-tavern-skin-engine — pack theme.css precheck + asset-url rewriting (pure).
 *
 * 方案 §2.7/§6.5: the pack `theme.css` is the *unsafe channel* and must be screened
 * BEFORE it is injected into <style>:
 *   1. brace / quote balance + top-level statement scan → errors carry a line number
 *      (CSSStyleSheet.replaceSync silently fails, so it cannot locate the mistake);
 *   2. layout / RTL-hazard property scan (same rule table as pack-schema; the
 *      "unsafe pack" confirmation is a future import-flow flag, see `allowUnsafe`);
 *   3. @import / external url() rejection (resources only via the plugin route);
 *   4. size limit;
 *   5. `url(assets/…)` → `/dsh-tavern-skin/assets/(builtin|pack)/<id>/…` rewriting.
 *
 * No DOM/Node APIs so the build can inline this file into the classic client bundle
 * (scripts/build-client.mjs `@inline-shared`) and `tests/` can import it directly.
 */

export const CSS_PRECHECK_LIMITS = Object.freeze({ bytes: 1024 * 1024 });

const CSS_GLOBAL_LAYOUT_PROPS = Object.freeze([
	"grid-template-columns", "grid-template-rows", "grid-template-areas",
	"grid-column", "grid-row", "grid-area"
]);

const CSS_HOOK_LAYOUT_PROPS = Object.freeze([
	"width", "height", "min-width", "max-width", "min-height", "max-height",
	"padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
	"margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
	"display", "position", "inset", "top", "right", "bottom", "left",
	"transform", "overflow"
]);

const LAYOUT_HOOK_RE = /(\[data-slot\s*=\s*["']?(root|sidebar|main|rightbar|shell\.bottom)["']?\]|_frame\b|_sidebarCol\b|_centerCol\b|_rightbarCol\b|\[data-side\b|\[data-sidebar-right-panel\b|\[data-dsh-center-col\b|\[data-rightbar-col\b)/;

export function utf8ByteLength(text) {
	if (typeof text !== "string") return 0;
	let bytes = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; }
			else bytes += 3;
		} else bytes += 3;
	}
	return bytes;
}

/**
 * @param {string} css
 * @param {{filename?: string, limits?: object, allowUnsafe?: boolean}} [options]
 * @returns {{ok: boolean, errors: Array<{path: string, code: string, message: string, line?: number}>,
 *            warnings: Array<{path: string, code: string, message: string, line?: number}>,
 *            stats: {bytes: number, importantCount: number, rules: number}}}
 */
export function precheckThemeCss(css, options = {}) {
	const limits = { ...CSS_PRECHECK_LIMITS, ...(options.limits || {}) };
	const filename = options.filename || "theme.css";
	const allowUnsafe = options.allowUnsafe === true;
	const errors = [];
	const warnings = [];
	const stats = { bytes: 0, importantCount: 0, rules: 0 };
	const issue = (list, code, message, line) => {
		list.push({ path: filename, code, message: line === undefined ? message : `第 ${line} 行：${message}`, line });
	};

	if (typeof css !== "string") {
		issue(errors, "type", `${filename} 必须是字符串`);
		return { ok: false, errors, warnings, stats };
	}
	stats.bytes = utf8ByteLength(css);
	if (stats.bytes > limits.bytes) {
		issue(errors, "css-too-large", `${filename} ${(stats.bytes / 1024).toFixed(1)} KB，超过注入上限 ${(limits.bytes / 1024).toFixed(0)} KB`);
		return { ok: false, errors, warnings, stats };
	}

	const stack = [];
	let pending = "";
	let declaration = "";
	let declarationLine = 0;
	let inString = null;
	let stringLine = 1;
	let line = 1;

	const flushDeclaration = (ruleLine) => {
		const text = declaration.trim();
		const declarationStart = declarationLine;
		declaration = "";
		declarationLine = 0;
		if (!text) return;
		const colon = text.indexOf(":");
		if (colon < 0) return;
		const property = text.slice(0, colon).trim().toLowerCase();
		const value = text.slice(colon + 1).trim();
		const selector = stack.length > 0 ? stack[stack.length - 1].selector : "";
		const rule = ruleLine !== undefined ? ruleLine : declarationStart || (stack.length > 0 ? stack[stack.length - 1].line : line);
		if (value.includes("!important")) stats.importantCount += 1;
		if (selector.startsWith("@")) return;
		if (CSS_GLOBAL_LAYOUT_PROPS.includes(property)) {
			const messageText = `${selector || "(全局)"} 使用了布局属性「${property}」——方案 §2.5 禁止（会压住宿主内联 grid / 拖动把手）`;
			if (allowUnsafe) issue(warnings, "layout-forbidden", messageText + "（unsafe 包已确认）", rule);
			else issue(errors, "layout-forbidden", messageText, rule);
			return;
		}
		if (LAYOUT_HOOK_RE.test(selector) && CSS_HOOK_LAYOUT_PROPS.includes(property)) {
			const messageText = `${selector} 使用了布局属性「${property}」——命中三栏/列钩子，方案 §2.5 禁止`;
			if (allowUnsafe) issue(warnings, "layout-forbidden", messageText + "（unsafe 包已确认）", rule);
			else issue(errors, "layout-forbidden", messageText, rule);
			return;
		}
		const urls = [...text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
		for (const match of urls) {
			const target = match[2].trim();
			const allowed = target.startsWith("assets/")
				|| target.startsWith("/dsh-tavern-skin/assets/")
				|| target.startsWith("data:");
			if (!allowed) issue(errors, "external-resource", `url(${target}) 只能引用包内 assets/、/dsh-tavern-skin/assets/ 或 data:`, rule);
		}
	};

	for (let index = 0; index < css.length; index++) {
		const char = css[index];
		if (char === "\n") line += 1;
		const appendChar = (value) => {
			if (stack.length > 0) {
				if (declaration.trim() === "" && value.trim() !== "") declarationLine = line;
				declaration += value;
			} else pending += value;
		};
		// comments: skip but keep the line counter honest
		if (char === "/" && css[index + 1] === "*") {
			let cursor = index + 2;
			while (cursor < css.length && !(css[cursor] === "*" && css[cursor + 1] === "/")) {
				if (css[cursor] === "\n") line += 1;
				cursor += 1;
			}
			if (cursor >= css.length) {
				issue(warnings, "css-comment", "块注释没有闭合 */（其余内容被当作注释忽略）", line);
				index = css.length;
				break;
			}
			index = cursor + 1;
			pending += " ";
			continue;
		}
		if (inString) {
			if (char === "\\") { index += 1; continue; }
			if (char === inString) {
				inString = null;
				appendChar(char);
				continue;
			}
			if (char === "\n") {
				issue(errors, "css-string", `字符串（从第 ${stringLine} 行开始）没有闭合引号`, stringLine);
				return { ok: false, errors, warnings, stats };
			}
			appendChar(char);
			continue;
		}
		if (char === '"' || char === "'") {
			inString = char;
			stringLine = line;
			appendChar(char);
			continue;
		}
		if (char === "{") {
			stats.rules += 1;
			stack.push({ selector: pending.trim(), line });
			pending = "";
			declaration = "";
			continue;
		}
		if (char === "}") {
			flushDeclaration();
			if (stack.length === 0) issue(errors, "css-brace", "多了一个右花括号 }", line);
			else stack.pop();
			pending = "";
			declaration = "";
			continue;
		}
		if (char === ";") {
			if (stack.length === 0) {
				const statement = pending.trim();
				pending = "";
				if (/^@import\b/i.test(statement)) issue(errors, "css-import", "theme.css 不允许 @import（会引入外部资源/绕过包内资源规则）", line);
				else if (statement && !/^@(charset|namespace)\b/i.test(statement)) issue(warnings, "css-statement", `顶层语句「${statement.slice(0, 60)}」不是规则块，已忽略`, line);
				continue;
			}
			flushDeclaration();
			continue;
		}
		appendChar(char);
	}

	if (inString) issue(errors, "css-string", `字符串（从第 ${stringLine} 行开始）没有闭合引号`, stringLine);
	if (stack.length > 0) {
		const open = stack[stack.length - 1];
		issue(errors, "css-brace", `规则块「${open.selector.slice(0, 60)}」缺少右花括号 }`, open.line);
	}
	if (stats.importantCount > 0) issue(warnings, "important-count", `${filename} 使用了 ${stats.importantCount} 处 !important（允许，但请确认不会压住宿主状态样式）`);
	if (errors.length === 0 && css.trim().length === 0) issue(warnings, "empty-css", `${filename} 是空文件`);
	return { ok: errors.length === 0, errors, warnings, stats };
}

/**
 * Rewrite pack-relative `url(assets/…)` to the plugin asset route.
 * @param {string} css
 * @param {string} assetBase e.g. "/dsh-tavern-skin/assets/builtin/cocreate-paper"
 */
export function rewriteAssetUrls(css, assetBase) {
	if (typeof css !== "string" || typeof assetBase !== "string") return css;
	const base = assetBase.replace(/\/+$/, "");
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, target) => {
		const trimmed = target.trim();
		if (!/^assets\//.test(trimmed)) return match;
		return `url(${quote}${base}/${trimmed}${quote})`;
	});
}

/** Names of `url(assets/…)` targets found in a CSS text (diagnostics/verification). */
export function listAssetUrls(css) {
	if (typeof css !== "string") return [];
	const out = [];
	for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
		const target = match[2].trim();
		if (target.startsWith("assets/")) out.push(target);
	}
	return out;
}
