/**
 * Step 6 rows 1/4/5/6 client half: pack cards · import · export · manage/trash.
 *
 * Contract: docs/step6-plan.md §4.2/§4.3/§4.4 (data attributes are frozen —
 * the acceptance script selects them literally). Host API: §2 of the same file.
 *
 * The top block is PURE (no React/DOM) so tests/step6-client.test.mjs can execute
 * it with `new Function` and exercise the precheck / arg-building logic directly.
 * Deep validation stays on the host (`packs.import`); the client only does a
 * lightweight precheck: JSON syntax, format detection, size/count limits, CSS
 * syntax (reusing the inlined `precheckThemeCss`) and "contains theme.css".
 */

/* ── limits (contract §2.2 / §4.3; diag.caps overrides when available) ──── */

const IO_LIMITS = Object.freeze({
	packMaxBytes: 16 * 1024 * 1024,
	fileMaxBytes: 8 * 1024 * 1024,
	fileCountMax: 200,
	bundleMaxBytes: 24 * 1024 * 1024,
	cssMaxBytes: 1024 * 1024
});

const IO_TEXT_PATH_RE = /\.(css|json|md|txt)$/i;

function ioLimitsFromCaps(caps) {
	const value = caps && typeof caps === "object" ? caps : {};
	const pick = (key, fallback) => {
		const number = Number(value[key]);
		return Number.isFinite(number) && number > 0 ? number : fallback;
	};
	return {
		packMaxBytes: pick("packMaxBytes", IO_LIMITS.packMaxBytes),
		fileMaxBytes: pick("fileMaxBytes", IO_LIMITS.fileMaxBytes),
		fileCountMax: IO_LIMITS.fileCountMax,
		bundleMaxBytes: pick("importMaxBundleBytes", IO_LIMITS.bundleMaxBytes),
		cssMaxBytes: IO_LIMITS.cssMaxBytes
	};
}

function ioTextBytes(text) {
	const value = typeof text === "string" ? text : "";
	if (typeof TextEncoder === "function") {
		try { return new TextEncoder().encode(value).length; } catch (error) { /* fall through */ }
	}
	return value.length;
}

function ioIssue(path, message, extra) {
	const issue = { path: path || "$", message: String(message || "") };
	if (extra && typeof extra === "object") {
		for (const key of Object.keys(extra)) {
			if (extra[key] !== undefined) issue[key] = extra[key];
		}
	}
	return issue;
}

/** POSIX-only pack-relative path: no absolute, no `..`, no backslash, no NUL. */
function ioIsSafePackPath(path) {
	if (typeof path !== "string" || path.length === 0 || path.length > 240) return false;
	if (path.indexOf("\0") >= 0 || path.indexOf("\\") >= 0 || path.indexOf(":") >= 0) return false;
	if (path.charAt(0) === "/") return false;
	const segments = path.split("/");
	for (const segment of segments) {
		if (segment === "" || segment === "." || segment === "..") return false;
	}
	return true;
}

function ioDataUrlPart(dataUrl) {
	const text = typeof dataUrl === "string" ? dataUrl : "";
	const index = text.indexOf(",");
	if (text.slice(0, 5) !== "data:" || index < 0) return null;
	return text.slice(index + 1);
}

function ioBase64Bytes(base64) {
	const text = typeof base64 === "string" ? base64.replace(/\s+/g, "") : "";
	if (text.length === 0) return 0;
	let padding = 0;
	if (text.charAt(text.length - 1) === "=") padding += 1;
	if (text.charAt(text.length - 2) === "=") padding += 1;
	return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

/** Decoded byte estimate of one bundle file value (text for .css/.json/…, data URL otherwise). */
function ioBundleFileBytes(path, value) {
	if (IO_TEXT_PATH_RE.test(path)) return ioTextBytes(value);
	const base64 = ioDataUrlPart(value);
	if (base64 !== null) return ioBase64Bytes(base64);
	return ioTextBytes(value);
}

function ioTextToBase64(text) {
	const source = typeof text === "string" ? text : "";
	let bytes = null;
	if (typeof TextEncoder === "function") {
		try { bytes = new TextEncoder().encode(source); } catch (error) { bytes = null; }
	}
	if (bytes === null) {
		bytes = new Uint8Array(source.length);
		for (let index = 0; index < source.length; index += 1) bytes[index] = source.charCodeAt(index) & 0xff;
	}
	if (typeof uiBytesToBase64 === "function") return uiBytesToBase64(bytes);
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const a = bytes[index];
		const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
		const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
		const triple = (a << 16) | (b << 8) | c;
		output += alphabet[(triple >> 18) & 63];
		output += alphabet[(triple >> 12) & 63];
		output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
		output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
	}
	return output;
}

/* ── pure prechecks (mirror lib/host/packs-io.js limits, not its full schema) ─ */

function ioCssFindings(css, path) {
	const errors = [];
	const warnings = [];
	if (typeof precheckThemeCss !== "function") return { errors, warnings };
	let check = null;
	try { check = precheckThemeCss(css, { filename: "theme.css" }); }
	catch (error) {
		errors.push(ioIssue(path, "CSS 预检异常：" + String((error && error.message) || error)));
		return { errors, warnings };
	}
	for (const issue of check.errors || []) {
		errors.push(ioIssue(String(path || "theme.css") + " / " + String(issue.path || "theme.css"), issue.message, { line: issue.line, code: issue.code }));
	}
	for (const issue of check.warnings || []) {
		warnings.push(ioIssue(path, issue.message, { line: issue.line, code: issue.code }));
	}
	return { errors, warnings };
}

/**
 * Detect the kind of a single JSON file.
 * @returns {{ok: boolean, kind: "bundle"|"dreamskin"|"theme"|null, parsed: any, fileName: string, errors: Array}}
 */
function ioDetectJsonKind(text, fileName) {
	const source = typeof text === "string" ? text : "";
	const name = typeof fileName === "string" ? fileName : "";
	let parsed = null;
	try { parsed = JSON.parse(source); }
	catch (error) {
		return { ok: false, kind: null, parsed: null, fileName: name, errors: [ioIssue("$", "JSON 解析失败：" + String((error && error.message) || error))] };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, kind: null, parsed, fileName: name, errors: [ioIssue("$", "JSON 顶层必须是对象")] };
	}
	if (parsed.format === "dshte.bundle") return { ok: true, kind: "bundle", parsed, fileName: name, errors: [] };
	if (parsed.format === "dsh-dream-skin/pack") return { ok: true, kind: "dreamskin", parsed, fileName: name, errors: [] };
	if (parsed.format === "dshte.theme") return { ok: true, kind: "theme", parsed, fileName: name, errors: [] };
	return {
		ok: false,
		kind: null,
		parsed,
		fileName: name,
		errors: [ioIssue("format", "无法识别的文件格式：format=" + JSON.stringify(parsed.format) + "；支持 .dshte.json（dshte.bundle）/ dream-skin（dsh-dream-skin/pack）/ theme.json（dshte.theme）")]
	};
}

/** Lightweight precheck of a parsed `.dshte.json` bundle (host does the deep one). */
function ioPrecheckBundle(parsed, limits) {
	const cap = limits || IO_LIMITS;
	const errors = [];
	const warnings = [];
	const result = { ok: false, errors, warnings, info: null, cssPresent: false };
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		errors.push(ioIssue("$", "bundle 顶层必须是对象"));
		return result;
	}
	if (parsed.format !== "dshte.bundle") errors.push(ioIssue("format", "顶层 format 必须是 \"dshte.bundle\"，当前是 " + JSON.stringify(parsed.format)));
	if (parsed.formatVersion !== 1) errors.push(ioIssue("formatVersion", "formatVersion 必须是 1，当前是 " + JSON.stringify(parsed.formatVersion)));
	const pack = parsed.pack && typeof parsed.pack === "object" && !Array.isArray(parsed.pack) ? parsed.pack : null;
	if (!pack) errors.push(ioIssue("pack", "缺少 pack 对象（theme.json 的内容）"));
	const files = parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files) ? parsed.files : null;
	if (parsed.files !== undefined && !files) errors.push(ioIssue("files", "files 必须是 { 路径: 内容 } 对象"));
	const fileList = files ? Object.keys(files) : [];
	if (fileList.length > cap.fileCountMax) errors.push(ioIssue("files", "文件数 " + fileList.length + " 超过上限 " + cap.fileCountMax));
	let totalBytes = 0;
	let cssPresent = false;
	for (const path of fileList) {
		const value = files[path];
		if (!ioIsSafePackPath(path)) {
			errors.push(ioIssue("files[" + JSON.stringify(path) + "]", "文件路径不安全（禁止 .. / 绝对路径 / 反斜杠 / NUL）"));
			continue;
		}
		if (typeof value !== "string") {
			errors.push(ioIssue("files[" + JSON.stringify(path) + "]", "文件内容必须是字符串（文本或 data URL）"));
			continue;
		}
		const bytes = ioBundleFileBytes(path, value);
		if (bytes > cap.fileMaxBytes) errors.push(ioIssue("files[" + JSON.stringify(path) + "]", "单文件解码后约 " + bytes + " 字节，超过 8 MB 上限"));
		totalBytes += bytes;
		if (path === "theme.css") {
			cssPresent = true;
			const css = ioCssFindings(value, "theme.css");
			errors.push(...css.errors);
			warnings.push(...css.warnings);
		}
	}
	if (totalBytes > cap.packMaxBytes) errors.push(ioIssue("files", "包解码后约 " + totalBytes + " 字节，超过 16 MB 上限"));
	if (!cssPresent && pack && typeof pack.css === "string") warnings.push(ioIssue("files", "theme.json 声明了 css 文件，但 files 里没有 theme.css（导出件应内联它）"));
	result.info = {
		id: pack && typeof pack.id === "string" ? pack.id : null,
		name: pack ? pack.nameZh || pack.name || null : null,
		fileCount: fileList.length,
		assetCount: fileList.filter((path) => path !== "theme.css").length,
		bytes: totalBytes,
		source: "bundle",
		cssPresent
	};
	result.cssPresent = cssPresent;
	result.ok = errors.length === 0;
	return result;
}

/** Lightweight precheck of a dream-skin pack JSON (mapping itself happens on the host). */
function ioPrecheckDreamskin(parsed, limits) {
	const cap = limits || IO_LIMITS;
	const errors = [];
	const warnings = [];
	const result = { ok: false, errors, warnings, info: null, cssPresent: false };
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		errors.push(ioIssue("$", "dream-skin 包顶层必须是对象"));
		return result;
	}
	if (parsed.format !== "dsh-dream-skin/pack") errors.push(ioIssue("format", "format 必须是 \"dsh-dream-skin/pack\"，当前是 " + JSON.stringify(parsed.format)));
	if (parsed.version !== 1) errors.push(ioIssue("version", "version 必须是 1，当前是 " + JSON.stringify(parsed.version)));
	const manifest = parsed.manifest && typeof parsed.manifest === "object" && !Array.isArray(parsed.manifest) ? parsed.manifest : null;
	if (!manifest) errors.push(ioIssue("manifest", "缺少 manifest 对象"));
	if (manifest) {
		for (const key of ["id", "name", "colorScheme"]) {
			if (typeof manifest[key] !== "string" || !manifest[key]) errors.push(ioIssue("manifest." + key, "manifest." + key + " 必须是非空字符串"));
		}
		if (!manifest.tokens || typeof manifest.tokens !== "object" || Array.isArray(manifest.tokens)) errors.push(ioIssue("manifest.tokens", "manifest.tokens 必须是 { --dsw-*: 颜色 } 对象"));
	}
	const tokenCount = manifest && manifest.tokens && typeof manifest.tokens === "object" && !Array.isArray(manifest.tokens) ? Object.keys(manifest.tokens).length : 0;
	if (tokenCount > 400) warnings.push(ioIssue("manifest.tokens", "token 数 " + tokenCount + " 较多，映射报告会很长"));
	const bytes = ioTextBytes(JSON.stringify(parsed));
	if (bytes > cap.packMaxBytes) errors.push(ioIssue("$", "dream-skin JSON 约 " + bytes + " 字节，超过 16 MB 上限"));
	result.info = {
		id: manifest && typeof manifest.id === "string" ? manifest.id : null,
		name: manifest ? manifest.nameZh || manifest.name || null : null,
		fileCount: 1,
		assetCount: 0,
		bytes,
		source: "dreamskin",
		cssPresent: false,
		tokenCount
	};
	result.ok = errors.length === 0;
	return result;
}

/**
 * Lightweight precheck of a folder package.
 * @param {Array<{path: string, size: number, text?: string}>} entries theme.json/theme.css carry text.
 */
function ioPrecheckFolder(entries, limits) {
	const cap = limits || IO_LIMITS;
	const errors = [];
	const warnings = [];
	const result = { ok: false, errors, warnings, info: null, cssPresent: false, theme: null };
	const list = Array.isArray(entries) ? entries : [];
	if (list.length === 0) errors.push(ioIssue("$", "没有读到任何文件（目录为空？）"));
	if (list.length > cap.fileCountMax) errors.push(ioIssue("$", "文件数 " + list.length + " 超过上限 " + cap.fileCountMax));
	let totalBytes = 0;
	for (const entry of list) {
		const path = entry && typeof entry.path === "string" ? entry.path : "";
		if (!ioIsSafePackPath(path)) {
			errors.push(ioIssue(path || "$", "文件路径不安全（禁止 .. / 绝对路径 / 反斜杠 / NUL）"));
			continue;
		}
		const size = Number(entry.size);
		if (!Number.isFinite(size) || size < 0) {
			errors.push(ioIssue(path, "文件大小未知"));
			continue;
		}
		if (size > cap.fileMaxBytes) errors.push(ioIssue(path, "单文件 " + size + " 字节，超过 8 MB 上限"));
		totalBytes += size;
	}
	if (totalBytes > cap.packMaxBytes) errors.push(ioIssue("$", "包总大小约 " + totalBytes + " 字节，超过 16 MB 上限"));
	const themeEntries = list.filter((entry) => entry && entry.path === "theme.json");
	if (themeEntries.length === 0) errors.push(ioIssue("theme.json", "缺少 theme.json（必须位于包根目录）"));
	else if (themeEntries.length > 1) errors.push(ioIssue("theme.json", "theme.json 必须唯一"));
	let theme = null;
	if (themeEntries.length === 1) {
		const text = typeof themeEntries[0].text === "string" ? themeEntries[0].text : null;
		if (text === null) errors.push(ioIssue("theme.json", "无法读取 theme.json 文本"));
		else {
			try { theme = JSON.parse(text); }
			catch (error) { errors.push(ioIssue("theme.json", "JSON 解析失败：" + String((error && error.message) || error))); }
			if (theme !== null && (typeof theme !== "object" || Array.isArray(theme))) {
				errors.push(ioIssue("theme.json", "theme.json 顶层必须是对象"));
				theme = null;
			}
		}
	}
	let cssPresent = false;
	const cssEntry = list.find((entry) => entry && entry.path === "theme.css");
	if (cssEntry) {
		cssPresent = true;
		if (typeof cssEntry.text === "string") {
			const css = ioCssFindings(cssEntry.text, "theme.css");
			errors.push(...css.errors);
			warnings.push(...css.warnings);
		}
	} else if (theme && typeof theme.css === "string") {
		warnings.push(ioIssue("theme.css", "theme.json 声明了 css 文件，但目录里没有 theme.css"));
	}
	const fileCount = list.length;
	result.info = {
		id: theme && typeof theme.id === "string" ? theme.id : null,
		name: theme ? theme.nameZh || theme.name || null : null,
		fileCount,
		assetCount: list.filter((entry) => entry && entry.path !== "theme.json" && entry.path !== "theme.css").length,
		bytes: totalBytes,
		source: "folder",
		cssPresent
	};
	result.cssPresent = cssPresent;
	result.theme = theme;
	result.ok = errors.length === 0;
	return result;
}

/** Build the exact `packs.import` args for the three contract sources. */
function ioBuildImportArgs(plan, collision, confirmCustomCss) {
	const mode = collision === "overwrite" || collision === "reject" ? collision : "rename";
	const source = plan && typeof plan === "object" ? plan.source : null;
	const args = { source, collision: mode };
	if (confirmCustomCss === true) args.confirmCustomCss = true;
	if (source === "folder") args.files = plan.filesB64 && typeof plan.filesB64 === "object" ? plan.filesB64 : {};
	else if (source === "bundle") args.bundle = plan.parsed;
	else if (source === "dreamskin") args.json = plan.parsed;
	else throw new Error("未知导入来源：" + String(source));
	return args;
}

function ioCollisionText(collision) {
	if (collision === "renamed") return "同名已存在，已自动改名";
	if (collision === "overwritten") return "已覆盖同名用户包（旧包在回收站，可恢复）";
	return "无冲突";
}

/* ── browser file helpers (async, yield to the event loop) ──────────────── */

function ioYield() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function ioReadFileText(file) {
	if (file && typeof file.text === "function") return file.text();
	return new Promise((resolve, reject) => {
		if (typeof FileReader !== "function") { reject(new Error("FileReader 不可用")); return; }
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () => reject(reader.error || new Error("读取失败"));
		reader.readAsText(file);
	});
}

function ioReadFileDataUrl(file) {
	return new Promise((resolve, reject) => {
		if (!file) { reject(new Error("没有文件")); return; }
		if (typeof FileReader !== "function") { reject(new Error("FileReader 不可用")); return; }
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () => reject(reader.error || new Error("读取失败"));
		reader.readAsDataURL(file);
	});
}

async function ioReadFileBase64(file) {
	const dataUrl = await ioReadFileDataUrl(file);
	const base64 = ioDataUrlPart(dataUrl);
	if (base64 === null) throw new Error("文件读取结果不是 data URL");
	return base64;
}

function ioEntriesFromFiles(files) {
	return Array.from(files || []).map((file) => {
		const relative = typeof file.webkitRelativePath === "string" && file.webkitRelativePath ? file.webkitRelativePath : "";
		let path = relative || String(file.name || "file");
		if (relative) {
			const parts = relative.split("/").filter(Boolean);
			if (parts.length > 1) path = parts.slice(1).join("/");
		}
		return { path, file, size: Number(file.size) || 0 };
	});
}

function ioReadDirectoryEntries(reader) {
	return new Promise((resolve, reject) => {
		try {
			reader.readEntries((batch) => resolve(Array.from(batch || [])), (error) => reject(error || new Error("读取目录失败")));
		} catch (error) { reject(error); }
	});
}

function ioEntryToFile(entry) {
	return new Promise((resolve, reject) => {
		try { entry.file((file) => resolve(file), (error) => reject(error || new Error("读取文件失败"))); }
		catch (error) { reject(error); }
	});
}

async function ioWalkDirectory(directory, prefix, out) {
	const reader = directory.createReader();
	let batch = [];
	do {
		batch = await ioReadDirectoryEntries(reader);
		for (const entry of batch) {
			const childPath = prefix ? prefix + "/" + entry.name : entry.name;
			if (entry.isFile) {
				const file = await ioEntryToFile(entry);
				out.push({ path: childPath, file, size: Number(file.size) || 0 });
			} else if (entry.isDirectory) {
				await ioWalkDirectory(entry, childPath, out);
			}
		}
	} while (batch.length > 0);
}

/** Drag/drop → `[{path, file, size}]`; directories are walked recursively. */
async function ioCollectDrop(dataTransfer) {
	const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
	const roots = [];
	for (const item of items) {
		if (!item || item.kind !== "file" || typeof item.webkitGetAsEntry !== "function") continue;
		const entry = item.webkitGetAsEntry();
		if (entry) roots.push(entry);
	}
	const out = [];
	if (roots.length === 1 && roots[0].isDirectory) {
		await ioWalkDirectory(roots[0], "", out);
		return out;
	}
	if (roots.length > 0) {
		for (const entry of roots) {
			if (entry.isDirectory) await ioWalkDirectory(entry, entry.name, out);
			else {
				const file = await ioEntryToFile(entry);
				out.push({ path: entry.name, file, size: Number(file.size) || 0 });
			}
		}
		return out;
	}
	return ioEntriesFromFiles(dataTransfer && dataTransfer.files ? dataTransfer.files : []);
}

/* ── download helper (export row) ───────────────────────────────────────── */

function ioDeliverDownload(fileName, text) {
	const blob = new Blob([text], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = fileName;
		anchor.rel = "noopener";
		anchor.style.display = "none";
		document.body.appendChild(anchor);
		anchor.click();
		setTimeout(() => {
			try { if (anchor.parentNode) anchor.parentNode.removeChild(anchor); } catch (error) { /* ignore */ }
			try { URL.revokeObjectURL(url); } catch (error) { /* ignore */ }
		}, 1500);
	} catch (error) {
		try { URL.revokeObjectURL(url); } catch (revokeError) { /* ignore */ }
		throw error;
	}
}

/* ── row 4: import ──────────────────────────────────────────────────────── */

function RowImport(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const store = ctx.store;
	const fileRef = React.useRef(null);
	const dirRef = React.useRef(null);
	const capsRef = React.useRef(null);
	const pendingRef = React.useRef(null);
	const [dragging, setDragging] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [collision, setCollision] = React.useState("rename");
	const [progress, setProgress] = React.useState({ active: false, value: 0, text: "等待选择文件：.dshte.json / dream-skin JSON / 包目录（theme.json + theme.css + assets）" });
	const [result, setResult] = React.useState(null);
	const [report, setReport] = React.useState(null);
	const [confirm, setConfirm] = React.useState(null);

	React.useEffect(() => {
		let alive = true;
		(async () => {
			try {
				if (!store || typeof store.apiRaw !== "function") return;
				const outcome = await store.apiRaw("diag.caps");
				if (alive && outcome && outcome.ok && outcome.value && typeof outcome.value === "object") capsRef.current = outcome.value;
			} catch (error) { /* caps are optional; constants are the fallback */ }
		})();
		return () => { alive = false; };
	}, [store]);

	const limits = () => ioLimitsFromCaps(capsRef.current);
	const setStage = (active, value, text) => setProgress({ active, value: Math.max(0, Math.min(100, Math.round(Number(value) || 0))), text: String(text || "") });
	const clearPending = () => { try { if (store && typeof store.setPendingImport === "function") store.setPendingImport(null); } catch (error) { /* ignore */ } };
	const refreshRegistries = async () => {
		try { if (store) { await store.refreshPacks(); await store.refreshTrash(); } } catch (error) { /* the row stays usable */ }
	};
	const fail = (errors, message) => {
		setResult({ ok: false, errors: Array.isArray(errors) ? errors : [], message: String(message || "") });
		setBusy(false);
		clearPending();
	};

	const upload = async (plan) => {
		const caps = limits();
		if (plan.bytes > caps.packMaxBytes) {
			fail([ioIssue("$", "包约 " + uiFormatBytes(plan.bytes) + "，超过 16 MB 上限")]);
			setStage(false, 0, "预检未通过（未发送请求）");
			return;
		}
		setBusy(true);
		setConfirm(null);
		setResult(null);
		setReport(null);
		let args = null;
		try { args = ioBuildImportArgs(plan, collision, plan.confirmedCss === true); }
		catch (error) { fail([ioIssue("$", String((error && error.message) || error))]); return; }
		if (store && typeof store.setPendingImport === "function") {
			try { store.setPendingImport({ source: plan.source, id: plan.info ? plan.info.id : null, phase: "upload", bytes: plan.bytes, at: new Date().toISOString() }); }
			catch (error) { /* diagnostics only */ }
		}
		setStage(true, 72, "上传 " + uiFormatBytes(plan.bytes) + " / 校验写入中…");
		await ioYield();
		let outcome = null;
		try { outcome = await store.apiRaw("packs.import", args); }
		catch (error) {
			setStage(false, 0, "导入失败（未写入任何文件）");
			fail([ioIssue("$", "导入请求异常：" + String((error && error.message) || error))]);
			return;
		}
		if (!outcome || outcome.ok !== true) {
			const error = outcome && outcome.error ? outcome.error : { code: "unknown", message: "导入失败（未知错误）", details: [] };
			if (error.code === "needs-confirmation" && plan.confirmedCss !== true) {
				pendingRef.current = { ...plan, confirmedCss: true };
				setBusy(false);
				clearPending();
				setStage(false, 0, "需要确认自定义 CSS");
				setConfirm({ message: error.message || "该包包含自定义 CSS（可影响整个界面），请确认来源可信后重试。", server: true });
				return;
			}
			setStage(false, 0, "导入失败（未写入任何文件）");
			const details = Array.isArray(error.details) && error.details.length > 0 ? error.details : [ioIssue("$", error.message || "导入失败")];
			fail(details, error.message);
			if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("导入失败：" + String(error.message || "未知错误"), "bad");
			return;
		}
		const value = outcome.value && typeof outcome.value === "object" ? outcome.value : {};
		const imported = {
			ok: true,
			id: String(value.id || ""),
			collision: typeof value.collision === "string" ? value.collision : "none",
			source: typeof value.source === "string" ? value.source : plan.source,
			renamedFrom: typeof value.renamedFrom === "string" ? value.renamedFrom : null,
			stats: value.stats && typeof value.stats === "object" ? value.stats : null,
			warnings: Array.isArray(value.warnings) ? value.warnings : [],
			message: "已导入 " + String(value.id || "")
		};
		setResult(imported);
		if (value.report && typeof value.report === "object") setReport(value.report);
		setStage(true, 100, "完成：已导入 " + imported.id + "（刷新包列表与回收站）");
		await refreshRegistries();
		if (ctx.actions && typeof ctx.actions.setStatus === "function") {
			ctx.actions.setStatus("已导入「" + imported.id + "」· " + ioCollisionText(imported.collision) + "（未自动应用，点包卡片应用）", "ok");
		}
		setBusy(false);
		clearPending();
	};

	const prepareAndUpload = async (plan) => {
		if (plan.cssPresent === true) {
			pendingRef.current = plan;
			setConfirm({ message: "该包包含自定义 CSS（theme.css，可影响整个界面），请确认来源可信后再导入。", server: false });
			setStage(true, 60, "等待确认：包内含自定义 CSS");
			return;
		}
		await upload(plan);
	};

	const runFolder = async (entries) => {
		if (!entries || entries.length === 0) {
			fail([ioIssue("$", "没有读到任何文件")]);
			setStage(false, 0, "读取失败（未写入任何文件）");
			return;
		}
		setBusy(true);
		setResult(null);
		setReport(null);
		setConfirm(null);
		const caps = limits();
		const readEntries = [];
		try {
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				const read = { path: entry.path, size: Number(entry.size) || 0 };
				if (entry.path === "theme.json" || entry.path === "theme.css") read.text = await ioReadFileText(entry.file);
				readEntries.push(read);
				setStage(true, 8 + Math.round((45 * (index + 1)) / entries.length), "读取 " + (index + 1) + "/" + entries.length);
				await ioYield();
			}
		} catch (error) {
			fail([ioIssue("$", "读取文件失败：" + String((error && error.message) || error))]);
			setStage(false, 0, "读取失败（未写入任何文件）");
			return;
		}
		const precheck = ioPrecheckFolder(readEntries, caps);
		if (!precheck.ok) {
			fail(precheck.errors);
			setStage(false, 0, "预检未通过（未发送请求）");
			return;
		}
		const filesB64 = {};
		try {
			for (let index = 0; index < entries.length; index += 1) {
				filesB64[entries[index].path] = await ioReadFileBase64(entries[index].file);
				setStage(true, 54 + Math.round((6 * (index + 1)) / entries.length), "编码 " + (index + 1) + "/" + entries.length);
				await ioYield();
			}
		} catch (error) {
			fail([ioIssue("$", "读取/编码文件失败：" + String((error && error.message) || error))]);
			setStage(false, 0, "读取失败（未写入任何文件）");
			return;
		}
		const plan = { source: "folder", filesB64, info: precheck.info, bytes: precheck.info.bytes, cssPresent: precheck.cssPresent, warnings: precheck.warnings };
		await prepareAndUpload(plan);
	};

	const runText = async (text, fileName) => {
		setBusy(true);
		setResult(null);
		setReport(null);
		setConfirm(null);
		setStage(true, 15, "读取 1/1");
		await ioYield();
		const caps = limits();
		const detected = ioDetectJsonKind(text, fileName);
		if (!detected.ok) {
			fail(detected.errors);
			setStage(false, 0, "预检未通过（未发送请求）");
			return;
		}
		if (detected.kind === "theme") {
			const bytes = ioTextBytes(String(text || ""));
			if (bytes > caps.fileMaxBytes) {
				fail([ioIssue("theme.json", "theme.json 超过单文件 8 MB 上限")]);
				setStage(false, 0, "预检未通过（未发送请求）");
				return;
			}
			const precheck = ioPrecheckFolder([{ path: "theme.json", size: bytes, text: String(text || "") }], caps);
			if (!precheck.ok) {
				fail(precheck.errors);
				setStage(false, 0, "预检未通过（未发送请求）");
				return;
			}
			await prepareAndUpload({ source: "folder", filesB64: { "theme.json": ioTextToBase64(String(text || "")) }, info: precheck.info, bytes, cssPresent: precheck.cssPresent, warnings: precheck.warnings });
			return;
		}
		let precheck = null;
		if (detected.kind === "bundle") {
			const textBytes = ioTextBytes(String(text || ""));
			if (textBytes > caps.bundleMaxBytes) {
				fail([ioIssue("$", "bundle 文本约 " + uiFormatBytes(textBytes) + "，超过 24 MB 上限")]);
				setStage(false, 0, "预检未通过（未发送请求）");
				return;
			}
			precheck = ioPrecheckBundle(detected.parsed, caps);
		} else {
			precheck = ioPrecheckDreamskin(detected.parsed, caps);
		}
		if (!precheck.ok) {
			fail(precheck.errors);
			setStage(false, 0, "预检未通过（未发送请求）");
			return;
		}
		const plan = {
			source: detected.kind,
			parsed: detected.parsed,
			info: precheck.info,
			bytes: precheck.info.bytes,
			cssPresent: precheck.cssPresent,
			warnings: precheck.warnings
		};
		await prepareAndUpload(plan);
	};

	const handleFileList = async (files) => {
		const list = Array.from(files || []);
		if (list.length === 0) return;
		const entries = ioEntriesFromFiles(list);
		try {
			if (entries.length === 1 && entries[0].path.indexOf("/") < 0) {
				const text = await ioReadFileText(entries[0].file);
				await runText(text, entries[0].path);
				return;
			}
			await runFolder(entries);
		} catch (error) {
			fail([ioIssue("$", "读取文件失败：" + String((error && error.message) || error))]);
		}
	};

	const onDrop = async (event) => {
		event.preventDefault();
		setDragging(false);
		if (busy) return;
		try {
			const entries = await ioCollectDrop(event.dataTransfer);
			if (entries.length === 0) {
				fail([ioIssue("$", "拖放内容里没有可读取的文件")]);
				return;
			}
			if (entries.length === 1 && entries[0].path.indexOf("/") < 0) {
				const text = await ioReadFileText(entries[0].file);
				await runText(text, entries[0].path);
				return;
			}
			await runFolder(entries);
		} catch (error) {
			fail([ioIssue("$", "读取拖放内容失败：" + String((error && error.message) || error))]);
		}
	};

	const confirmImport = () => {
		const plan = pendingRef.current;
		pendingRef.current = null;
		setConfirm(null);
		if (!plan) return;
		const next = { ...plan, confirmedCss: plan.cssPresent === true || plan.confirmedCss === true };
		void upload(next);
	};

	const cancelImport = () => {
		pendingRef.current = null;
		setConfirm(null);
		setBusy(false);
		clearPending();
		setResult({ ok: false, cancelled: true, errors: [], message: "已取消导入（未写入任何文件）" });
		setStage(false, 0, "已取消（未写入任何文件）");
	};

	const errors = result && Array.isArray(result.errors) ? result.errors : [];
	const warnings = result && Array.isArray(result.warnings) ? result.warnings : [];
	const importedId = result && result.ok === true ? result.id : undefined;
	const importedCollision = result && result.ok === true ? result.collision : undefined;
	const importedSource = result && result.ok === true ? result.source : undefined;

	return h(UICard, {
		rowId: "import",
		title: "4 · 导入",
		actions: [
			h(UIBadge, { key: "local", ok: true }, "本地预检 + 宿主深校验"),
			busy ? h(UIBadge, { key: "busy", warn: true }, "导入中…") : null
		],
		note: "支持：单文件 .dshte.json、dream-skin JSON、包目录（theme.json + theme.css + assets）与拖放（文件/目录）。客户端只做轻量预检（JSON/体积/数量/CSS 语法），深度校验以宿主为准；任何失败都不落盘。含 theme.css 的包必须行内确认。"
	},
		h("div", {
			"data-dshte-drop": "import",
			style: uiStyle(UI_STYLE.drop, dragging ? UI_STYLE.dropActive : null, busy ? { opacity: 0.7 } : null),
			onDragOver: (event) => { event.preventDefault(); if (!busy) setDragging(true); },
			onDragLeave: () => setDragging(false),
			onDrop,
			onClick: () => { if (!busy && fileRef.current) fileRef.current.click(); },
			onKeyDown: (event) => { if (!busy && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (fileRef.current) fileRef.current.click(); } },
			role: "button",
			tabIndex: busy ? -1 : 0,
			"aria-disabled": busy ? "true" : undefined
		},
			dragging ? "松开即可读取并导入（文件或目录）" : "把 .dshte.json / dream-skin JSON / 包目录拖到这里，或点击选择文件"
		),
		h("div", { style: uiStyle(UI_STYLE.row, { marginTop: "8px" }) },
			h(UIButton, {
				"data-dshte-action": "import-file",
				primary: true,
				disabled: busy,
				onClick: () => { if (fileRef.current) fileRef.current.click(); }
			}, "选择文件（.dshte.json / dream-skin）"),
			h(UIButton, {
				"data-dshte-action": "import-dir",
				disabled: busy,
				title: "选择包目录（theme.json + theme.css + assets/…）",
				onClick: () => { if (dirRef.current) dirRef.current.click(); }
			}, "选择包目录…"),
			h("label", { style: uiStyle(UI_STYLE.hint, { display: "inline-flex", alignItems: "center", gap: "4px" }) },
				"同名冲突：",
				h("select", {
					"data-dshte-import-collision-mode": "",
					value: collision,
					"aria-label": "同名冲突处理",
					disabled: busy,
					onChange: (event) => setCollision(event.target.value),
					style: UI_STYLE.select
				},
					h("option", { value: "rename" }, "自动改名 -2（推荐）"),
					h("option", { value: "overwrite" }, "覆盖（旧包进回收站）"),
					h("option", { value: "reject" }, "拒绝")
				)
			),
			fileRef.current && fileRef.current.files && fileRef.current.files.length > 0
				? h(UIMono, null, String(fileRef.current.files[0].name || ""))
				: null,
			h("span", { style: UI_STYLE.hint }, "尚未选择文件")
		),
		h("input", {
			ref: fileRef,
			type: "file",
			"data-dshte-file": "import",
			accept: ".json,.dshte.json,application/json",
			style: { display: "none" },
			disabled: busy,
			onChange: (event) => {
				// Snapshot BEFORE clearing: `input.files` is a LIVE FileList — setting
				// value="" empties it, so a stored reference would read back empty and
				// the whole import would silently no-op (acceptance-found bug).
				const files = Array.from(event.target.files || []);
				event.target.value = "";
				void handleFileList(files);
			}
		}),
		h("input", {
			ref: dirRef,
			type: "file",
			"data-dshte-dir": "import",
			webkitdirectory: "",
			multiple: true,
			style: { display: "none" },
			disabled: busy,
			onChange: (event) => {
				// Snapshot BEFORE clearing: `input.files` is a LIVE FileList — setting
				// value="" empties it, so a stored reference would read back empty and
				// the whole import would silently no-op (acceptance-found bug).
				const files = Array.from(event.target.files || []);
				event.target.value = "";
				void handleFileList(files);
			}
		}),
		h("div", {
			"data-dshte-import-progress": "",
			role: "progressbar",
			"aria-valuemin": 0,
			"aria-valuemax": 100,
			"aria-valuenow": progress.value,
			"aria-valuetext": progress.text,
			"aria-label": "导入进度",
			"aria-live": "polite",
			style: {
				display: "grid",
				gap: "4px",
				marginTop: "8px",
				padding: "6px 9px",
				borderRadius: "8px",
				border: "1px solid " + UI_COLOR.border,
				background: UI_COLOR.surface2,
				boxSizing: "border-box"
			}
		},
			h("div", { style: { height: "6px", borderRadius: "999px", background: UI_COLOR.border, overflow: "hidden" } },
				h("div", {
					style: {
						height: "100%",
						width: String(progress.value) + "%",
						background: progress.active ? UI_COLOR.brand : UI_COLOR.textTertiary,
						transition: "width 120ms linear"
					}
				})
			),
			h("span", { "data-dshte-import-progress-text": "", style: UI_STYLE.hint }, progress.text)
		),
		confirm
			? h("div", {
				"data-dshte-import-confirm": "",
				role: "group",
				"aria-label": "确认导入（含自定义 CSS）",
				style: uiStyle(UI_STYLE.confirm, { marginTop: "8px" })
			},
				h("span", { style: UI_STYLE.confirmText }, String(confirm.message || "")),
				h(UIButton, { "data-dshte-action": "import-confirm", primary: true, onClick: confirmImport }, "确认导入（含自定义 CSS）"),
				h(UIButton, { "data-dshte-action": "import-cancel", onClick: cancelImport }, "取消")
			)
			: null,
		h("div", {
			"data-dshte-import-result": "",
			"data-imported-id": importedId,
			"data-import-collision": importedCollision,
			"data-import-source": importedSource,
			role: errors.length > 0 ? "alert" : "status",
			"aria-live": "polite",
			style: {
				display: "grid",
				gap: "2px",
				marginTop: "8px",
				padding: "7px 10px",
				borderRadius: "8px",
				border: "1px solid " + (errors.length > 0 ? UI_COLOR.danger : UI_COLOR.border),
				background: errors.length > 0 ? UI_COLOR.dangerBg : UI_COLOR.surface2,
				fontSize: "11px",
				lineHeight: 1.65,
				color: errors.length > 0 ? UI_COLOR.danger : UI_COLOR.textSecondary
			}
		},
			!result ? h("span", { style: UI_STYLE.hint }, "导入结果会显示在这里（错误带字段路径 / CSS 行号；失败不落盘）。") : null,
			result && result.ok
				? h("span", { style: { color: UI_COLOR.ok, fontSize: "11.5px" } },
					"✓ 已导入「" + result.id + "」 · " + ioCollisionText(result.collision) +
					(result.renamedFrom ? "（原名 " + result.renamedFrom + "）" : "") +
					(result.stats ? " · " + uiFormatBytes(Number(result.stats.bytes) || 0) + " / " + String(result.stats.fileCount || 0) + " 文件" : "")
				)
				: null,
			result && result.cancelled ? h("span", { style: UI_STYLE.hint }, "已取消导入（未写入任何文件）") : null,
			result && result.ok === false && result.cancelled !== true
				? h("span", { style: { color: UI_COLOR.danger, fontSize: "11.5px" } }, "✗ 导入失败" + (errors.length > 0 ? "（" + errors.length + " 个错误）" : "") + (result.message ? "：" + result.message : ""))
				: null,
			...errors.map((issue, index) => h("div", { key: "e" + index, "data-dshte-error": "", style: { fontSize: "11px", color: UI_COLOR.danger, wordBreak: "break-word" } },
				"· " + String(issue.path || "$") + "：" + String(issue.message || ""))),
			...warnings.map((issue, index) => h("div", { key: "w" + index, style: { fontSize: "10.5px", color: UI_COLOR.warn } },
				"⚠ " + (issue.path ? String(issue.path) + "：" : "") + String(issue.message || ""))),
			result && result.ok ? h("span", { style: { fontSize: "10.5px", color: UI_COLOR.textTertiary } }, "导入后不会自动应用；点第 1 行的包卡片应用。") : null
		),
		report
			? h("div", {
				"data-dshte-import-report": "",
				"data-report-target-id": String(report.targetId || ""),
				style: uiStyle(UI_STYLE.subcard, { marginTop: "8px", display: "grid", gap: "2px" })
			},
				h("div", { style: UI_STYLE.subtitle }, "dream-skin 映射报告"),
				h("div", { style: UI_STYLE.hint },
					"源：" + String(report.sourceId || "?") + (report.sourceName ? "（" + report.sourceName + "）" : "") +
					" → 目标 id：" + String(report.targetId || "?") +
					" · colorScheme：" + String(report.colorScheme || "?") +
					" · 映射 token：" + String(Array.isArray(report.mapped) ? report.mapped.length : 0) + " 个"),
				Array.isArray(report.dropped) && report.dropped.length > 0
					? h("div", { "data-dshte-import-report-dropped": "", style: { fontSize: "10.5px", color: UI_COLOR.warn, lineHeight: 1.6 } },
						"丢弃 token（" + report.dropped.length + "）：" +
						report.dropped.slice(0, 24).map((item) => String(item.token || "?") + (item.reason ? "（" + item.reason + "）" : "")).join("；") +
						(report.dropped.length > 24 ? " …" : ""))
					: h("div", { style: UI_STYLE.hint }, "没有丢弃 token。"),
				Array.isArray(report.notes) && report.notes.length > 0
					? h("div", { style: UI_STYLE.hint }, "说明：" + report.notes.map((note) => String(note)).join("；"))
					: null
			)
			: null,
		h(UINote, null, "格式：.dshte.json 顶层 { format: \"dshte.bundle\", formatVersion: 1, pack, files }；dream-skin 包只映射 manifest.tokens（颜色）与 colorScheme，目标 id 为 imported-<源 id>，其余字段丢弃并展示在上方报告；目录导入的每个文件以纯 base64 发送给宿主。")
	);
}

/* ── row 5: export ──────────────────────────────────────────────────────── */

function RowExport(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const state = ctx.state || {};
	const activeId = state.activePackId ? String(state.activePackId) : null;
	const meta = activeId && ctx.store && typeof ctx.store.packMeta === "function" ? ctx.store.packMeta(activeId) : null;
	const sourceLabel = meta && meta.source === "builtin" ? "内置包" : meta && meta.source === "user" ? "用户包" : (ctx.store && typeof ctx.store.isBuiltin === "function" && ctx.store.isBuiltin(activeId) ? "内置包" : "用户包");
	const busyRef = React.useRef(false);
	const [phase, setPhase] = React.useState({
		status: activeId ? "idle" : "empty",
		message: activeId ? "点击导出：由宿主读取包目录（theme.json / theme.css / assets）并组装 .dshte.json" : "当前没有活动包，无法导出"
	});

	React.useEffect(() => {
		setPhase((prev) => {
			if (!activeId) return { status: "empty", message: "当前没有活动包，无法导出" };
			if (prev.status === "idle" || prev.status === "empty") return { status: "idle", message: "点击导出：由宿主读取包目录并组装 .dshte.json（内置与用户包同一路径）" };
			return prev;
		});
	}, [activeId]);

	const run = async () => {
		if (!activeId) {
			setPhase({ status: "error", message: "当前没有活动包，无法导出" });
			return;
		}
		if (busyRef.current) return;
		busyRef.current = true;
		setPhase({ status: "busy", message: "正在请求宿主导出（读取 theme.json / theme.css / assets，资源内嵌 data URL）…" });
		try {
			const outcome = await ctx.store.apiRaw("packs.export", { id: activeId });
			if (!outcome || outcome.ok !== true) {
				const error = outcome && outcome.error ? outcome.error : { code: "unknown", message: "导出失败（未知错误）", details: [] };
				const message = "导出失败：" + String(error.message || "未知错误") + (error.code ? "（" + error.code + "）" : "");
				setPhase({ status: "error", message });
				if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus(message, "bad");
				return;
			}
			const value = outcome.value && typeof outcome.value === "object" ? outcome.value : {};
			const bundle = value.bundle && typeof value.bundle === "object" ? value.bundle : null;
			if (!bundle) {
				const message = "导出失败：宿主没有返回 bundle 对象";
				setPhase({ status: "error", message });
				return;
			}
			const text = JSON.stringify(bundle, null, 2) + "\n";
			const release = bundle.pack && typeof bundle.pack.release === "string" && bundle.pack.release ? bundle.pack.release : "1.0.0";
			const fileName = typeof value.fileName === "string" && value.fileName ? value.fileName : activeId + "-" + release + ".dshte.json";
			const bytes = Number(value.bytes) > 0 ? Number(value.bytes) : ioTextBytes(text);
			ioDeliverDownload(fileName, text);
			setPhase({ status: "ok", message: "已导出 " + fileName + "（" + uiFormatBytes(bytes) + (value.fileCount ? " · " + String(value.fileCount) + " 个文件" : "") + "）" });
			if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("已导出 " + fileName + "（" + uiFormatBytes(bytes) + "）", "ok");
		} catch (error) {
			const message = "导出异常：" + String((error && error.message) || error);
			setPhase({ status: "error", message });
			if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus(message, "bad");
		} finally {
			busyRef.current = false;
		}
	};

	const infoColor = phase.status === "error" ? UI_COLOR.danger : phase.status === "ok" ? UI_COLOR.ok : UI_COLOR.textSecondary;
	return h(UICard, {
		rowId: "export",
		title: "5 · 导出",
		actions: activeId ? h(UIBadge, { key: "src", ok: sourceLabel === "内置包", warn: sourceLabel === "用户包" }, sourceLabel) : null,
		note: "宿主读包目录 → 组装单文件交换包（资源 base64 内嵌）→ 浏览器 Blob 下载 `<id>-<release>.dshte.json`；导出前宿主会再跑一遍校验，保证「能导就能导回」。内置包与用户包走同一条路径。"
	},
		h("div", { style: UI_STYLE.row },
			h(UIButton, {
				"data-dshte-action": "export",
				primary: true,
				disabled: !activeId || phase.status === "busy",
				onClick: () => { void run(); }
			}, phase.status === "busy" ? "导出中…" : "导出当前包 .dshte.json"),
			activeId ? h(UIMono, null, activeId) : h("span", { style: UI_STYLE.hint }, "无活动包"),
			h("span", { style: uiStyle(UI_STYLE.hint, { flex: "1 1 220px" }) }, "文件名 <id>-<release>.dshte.json；Tab + Enter 也可触发下载；大小会显示在下方。")
		),
		h("div", {
			"data-dshte-export-info": "",
			role: phase.status === "error" ? "alert" : "status",
			"aria-live": "polite",
			style: {
				marginTop: "6px",
				padding: "6px 9px",
				borderRadius: "7px",
				border: "1px solid " + (phase.status === "error" ? UI_COLOR.danger : UI_COLOR.border),
				background: phase.status === "error" ? UI_COLOR.dangerBg : UI_COLOR.surface2,
				fontSize: "11px",
				lineHeight: 1.6,
				color: infoColor,
				wordBreak: "break-word"
			}
		},
			phase.message,
			phase.status === "error" ? h("span", { "data-dshte-error": "", style: { display: "block", marginTop: "2px" } }, phase.message) : null
		)
	);
}

/* ── row 6: manage (user-pack delete / trash restore / purge / reset) ───── */

function RowManage(props) {
	const ctx = props.ctx;
	const h = React.createElement;
	const store = ctx.store;
	const packs = ctx.packs && typeof ctx.packs === "object" ? ctx.packs : (store && typeof store.packs === "function" ? store.packs() : { builtin: [], user: [] });
	const trash = ctx.trash && typeof ctx.trash === "object" ? ctx.trash : (store && typeof store.trash === "function" ? store.trash() : { entries: [], count: 0, at: null });
	const [confirm, setConfirm] = React.useState(null);
	const [busy, setBusy] = React.useState(false);
	const [info, setInfo] = React.useState(null);
	const [error, setError] = React.useState(null);

	React.useEffect(() => {
		let alive = true;
		(async () => {
			try {
				if (!alive || !store) return;
				if (store.trash().at === null) await store.refreshTrash();
				if (store.packs().at === null) await store.refreshPacks();
			} catch (errorMessage) { /* row stays usable; errors surface inline on actions */ }
		})();
		return () => { alive = false; };
	}, [store]);

	const refresh = async (quiet) => {
		setBusy(true);
		try {
			if (store) { await store.refreshPacks(); await store.refreshTrash(); }
			if (!quiet && ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("包列表与回收站已刷新", "ok");
		} catch (errorMessage) {
			setError("刷新失败：" + String((errorMessage && errorMessage.message) || errorMessage));
		} finally {
			setBusy(false);
		}
	};

	const doDelete = async (id) => {
		setConfirm(null);
		setBusy(true);
		setError(null);
		setInfo(null);
		try {
			const outcome = await store.apiRaw("packs.delete", { id });
			if (!outcome || outcome.ok !== true) {
				const errorValue = outcome && outcome.error ? outcome.error : { message: "删除失败（未知错误）" };
				setError("删除失败：" + String(errorValue.message || "未知错误"));
				if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("删除失败：" + String(errorValue.message || "未知错误"), "bad");
				return;
			}
			const value = outcome.value && typeof outcome.value === "object" ? outcome.value : {};
			await refresh(true);
			const wasActive = ctx.state && ctx.state.activePackId === id;
			if (wasActive) {
				const result = store.set({ activePackId: null, enabled: false }, { reason: "activate" });
				setInfo("已删除用户包「" + id + "」（回收站：" + String(value.trashId || "?") + "，可恢复）；它是当前激活包，已切回无包并停用皮肤。");
				if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("已删除当前激活包「" + id + "」，皮肤已停用", "ok");
				if (!result || result.ok === false) setError("切换激活包失败：" + String((result && result.error) || "未知错误"));
			} else {
				setInfo("已删除用户包「" + id + "」，已移入回收站（" + String(value.trashId || "?") + "），可恢复。");
				if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("已删除用户包「" + id + "」（进回收站，可恢复）", "ok");
			}
		} catch (errorValue) {
			setError("删除异常：" + String((errorValue && errorValue.message) || errorValue));
		} finally {
			setBusy(false);
		}
	};

	const doRestore = async (trashId) => {
		setBusy(true);
		setError(null);
		setInfo(null);
		try {
			const outcome = await store.apiRaw("trash.restore", { trashId });
			if (!outcome || outcome.ok !== true) {
				const errorValue = outcome && outcome.error ? outcome.error : { message: "恢复失败（未知错误）" };
				setError("恢复失败：" + String(errorValue.message || "未知错误"));
				return;
			}
			const value = outcome.value && typeof outcome.value === "object" ? outcome.value : {};
			await refresh(true);
			const restoredTo = value.restoredTo || value.id || "?";
			setInfo("已从回收站恢复「" + String(value.id || "?") + "」→「" + String(restoredTo) + "」" + (value.renamed === true ? "（同名已存在，自动加了后缀）" : "") + "。");
			if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("已恢复包「" + String(restoredTo) + "」", "ok");
		} catch (errorValue) {
			setError("恢复异常：" + String((errorValue && errorValue.message) || errorValue));
		} finally {
			setBusy(false);
		}
	};

	const doPurge = async (trashId) => {
		setConfirm(null);
		setBusy(true);
		setError(null);
		setInfo(null);
		try {
			const outcome = await store.apiRaw("trash.purge", { trashId });
			if (!outcome || outcome.ok !== true) {
				const errorValue = outcome && outcome.error ? outcome.error : { message: "彻底删除失败（未知错误）" };
				setError("彻底删除失败：" + String(errorValue.message || "未知错误"));
				return;
			}
			await refresh(true);
			setInfo("已彻底删除回收站条目「" + trashId + "」（不可恢复）。");
			if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("已彻底删除回收站条目", "ok");
		} catch (errorValue) {
			setError("彻底删除异常：" + String((errorValue && errorValue.message) || errorValue));
		} finally {
			setBusy(false);
		}
	};

	const doResetDefault = () => {
		setConfirm(null);
		setBusy(true);
		setError(null);
		setInfo(null);
		try {
			if (ctx.actions && typeof ctx.actions.resetDefault === "function") {
				const result = ctx.actions.resetDefault();
				if (result && result.ok === false) {
					setError("恢复默认失败：" + String(result.error || "未知错误"));
					return;
				}
			}
			setInfo("已恢复默认：皮肤停用、overrides 清空、schemePolicy=null；token 交回宿主 / dream-skin 的值。");
			if (ctx.actions && typeof ctx.actions.setStatus === "function") ctx.actions.setStatus("已恢复默认（停用皮肤 + 清空覆盖）", "ok");
		} catch (errorValue) {
			setError("恢复默认异常：" + String((errorValue && errorValue.message) || errorValue));
		} finally {
			setBusy(false);
		}
	};

	const embeddedIds = BUILTIN_PACKS && typeof BUILTIN_PACKS === "object" ? Object.keys(BUILTIN_PACKS).sort() : [];
	const builtinMetas = embeddedIds.map((id) => {
		const embedded = BUILTIN_PACKS[id] && BUILTIN_PACKS[id].pack ? BUILTIN_PACKS[id].pack : {};
		const listed = (Array.isArray(packs.builtin) ? packs.builtin : []).find((meta) => meta && meta.id === id) || {};
		return {
			id,
			source: "builtin",
			name: listed.name || embedded.name || id,
			nameZh: listed.nameZh || embedded.nameZh || null,
			release: listed.release || embedded.release || null
		};
	});
	const userMetas = (Array.isArray(packs.user) ? packs.user : []).map((meta) => ({ ...meta, source: "user" }));
	// User packs first: the first `[data-dshte-action="delete-pack"]` in the DOM is
	// an enabled one (acceptance scripts commonly click the first match); built-in
	// delete buttons stay rendered but disabled (契约 §4.2).
	const allPacks = userMetas.concat(builtinMetas);
	const trashEntries = Array.isArray(trash.entries) ? trash.entries : [];

	const packRow = (meta) => h("div", {
		key: "pack-" + meta.id,
		style: {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap",
			padding: "4px 0",
			borderBottom: "1px solid " + UI_COLOR.border
		}
	},
		h(UIBadge, { ok: meta.source === "builtin", warn: meta.source === "user" }, meta.source === "builtin" ? "内置" : "用户"),
		h(UIMono, null, String(meta.id)),
		h("span", { style: uiStyle(UI_STYLE.hint, { flex: "1 1 160px" }) }, String(meta.nameZh || meta.name || "") + (meta.release ? " · v" + meta.release : "")),
		h(UIButton, {
			"data-dshte-action": "delete-pack",
			"data-dshte-pack-id": String(meta.id),
			danger: meta.source === "user",
			disabled: meta.source !== "user" || busy,
			title: meta.source === "user" ? "删除用户包：目录移入回收站，可恢复" : "内置包随插件发布，不可删除",
			onClick: () => setConfirm({ kind: "delete", id: meta.id })
		}, meta.source === "user" ? "删除…" : "不可删除（内置）")
	);

	const trashRow = (entry) => h("div", {
		key: "trash-" + entry.trashId,
		"data-dshte-trash-entry": String(entry.trashId),
		style: {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap",
			padding: "4px 0",
			borderBottom: "1px solid " + UI_COLOR.border
		}
	},
		h(UIMono, null, String(entry.trashId)),
		h("span", { style: uiStyle(UI_STYLE.hint, { flex: "1 1 200px" }) },
			"id " + String(entry.id || "?") + (entry.nameZh || entry.name ? "（" + (entry.nameZh || entry.name) + "）" : "") +
			" · 删除于 " + String(entry.deletedAt || "?") +
			" · " + uiFormatBytes(Number(entry.bytes) || 0) +
			" · " + String(entry.fileCount || 0) + " 文件"),
		h(UIButton, {
			"data-dshte-action": "trash-restore",
			"data-dshte-trash-id": String(entry.trashId),
			disabled: busy,
			onClick: () => { void doRestore(entry.trashId); }
		}, "恢复"),
		h(UIButton, {
			"data-dshte-action": "trash-purge",
			"data-dshte-trash-id": String(entry.trashId),
			danger: true,
			disabled: busy,
			onClick: () => setConfirm({ kind: "purge", trashId: entry.trashId })
		}, "彻底删除…")
	);

	return h(UICard, {
		rowId: "manage",
		title: "6 · 管理",
		actions: [
			h(UIButton, {
				key: "refresh",
				"data-dshte-action": "packs-refresh",
				disabled: busy,
				onClick: () => { void refresh(false); }
			}, busy ? "刷新中…" : "刷新包列表 / 回收站"),
			h(UIButton, {
				key: "reset",
				"data-dshte-action": "reset-default",
				danger: true,
				onClick: () => setConfirm({ kind: "reset" })
			}, "恢复默认…")
		],
		note: "破坏性操作一律行内二次确认（不弹 window.confirm）：删除用户包 = 目录移入回收站（不硬删，可恢复）；彻底删除只删回收站条目；恢复默认 = 停用皮肤 + 清空 overrides + schemePolicy=null。内置包不可删除。"
	},
		h("div", { style: { display: "grid", gap: "0" } },
			h("div", { style: UI_STYLE.subtitle }, "包（内置只读 · 用户包可删除）· 内置 " + String(builtinMetas.length) + " / 用户 " + String(userMetas.length)),
			...allPacks.map(packRow),
			builtinMetas.length + userMetas.length === 0 ? h("div", { style: UI_STYLE.hint }, "没有读到包列表（宿主 API 未就绪？可点右上「刷新包列表 / 回收站」重试）。") : null
		),
		confirm && confirm.kind === "delete" ? h("div", {
			"data-dshte-confirm": "delete-pack",
			role: "group",
			"aria-label": "确认删除用户包",
			style: uiStyle(UI_STYLE.confirm, { marginTop: "8px" })
		},
			h("span", { style: UI_STYLE.confirmText }, "确认删除用户包「" + String(confirm.id) + "」？包目录会移入回收站（可恢复），不会硬删。"),
			h(UIButton, { "data-dshte-action": "delete-confirm", primary: true, danger: true, disabled: busy, onClick: () => { void doDelete(confirm.id); } }, "确认删除"),
			h(UIButton, { "data-dshte-action": "delete-cancel", onClick: () => setConfirm(null) }, "取消")
		) : null,
		confirm && confirm.kind === "purge" ? h("div", {
			"data-dshte-confirm": "trash-purge",
			role: "group",
			"aria-label": "确认彻底删除",
			style: uiStyle(UI_STYLE.confirm, { marginTop: "8px" })
		},
			h("span", { style: UI_STYLE.confirmText }, "确认彻底删除回收站条目「" + String(confirm.trashId) + "」？此操作不可恢复。"),
			h(UIButton, { "data-dshte-action": "trash-purge-confirm", primary: true, danger: true, disabled: busy, onClick: () => { void doPurge(confirm.trashId); } }, "彻底删除（不可恢复）"),
			h(UIButton, { "data-dshte-action": "trash-purge-cancel", onClick: () => setConfirm(null) }, "取消")
		) : null,
		confirm && confirm.kind === "reset" ? h("div", {
			"data-dshte-confirm": "reset-default",
			role: "group",
			"aria-label": "确认恢复默认",
			style: uiStyle(UI_STYLE.confirm, { marginTop: "8px" })
		},
			h("span", { style: UI_STYLE.confirmText }, "确认恢复默认？会停用皮肤并清空 light+dark 两个方案的全部 overrides，token 交回宿主 / dream-skin。"),
			h(UIButton, { "data-dshte-action": "reset-confirm", primary: true, danger: true, disabled: busy, onClick: doResetDefault }, "确认恢复默认"),
			h(UIButton, { "data-dshte-action": "reset-cancel", onClick: () => setConfirm(null) }, "取消")
		) : null,
		error ? h(UIError, { style: { display: "block", marginTop: "6px" } }, error) : null,
		info ? h(UIStatus, { kind: "ok", style: { display: "block", marginTop: "6px" } }, info) : null,
		h("div", {
			"data-dshte-trash": "",
			style: uiStyle(UI_STYLE.subcard, { marginTop: "8px", display: "grid", gap: "2px" })
		},
			h("div", { style: UI_STYLE.subtitle }, "回收站（" + String(typeof trash.count === "number" ? trash.count : trashEntries.length) + " 条，上限 100）"),
			trashEntries.length === 0
				? h("div", { style: UI_STYLE.hint }, "回收站为空。删除用户包后在这里「恢复」或「彻底删除」。")
				: null,
			...trashEntries.map(trashRow)
		),
		h(UINote, null, "删除只移动目录到 trash/<id>-<时间戳>/，不硬删；恢复遇到同名包时宿主会自动加 -2/-3 后缀并提示。彻底删除仅删回收站条目，需要行内二次确认。")
	);
}
