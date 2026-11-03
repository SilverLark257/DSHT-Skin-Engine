/**
 * 用户主题包导入 / 导出 / 删除（Step 6 契约 §1 / §2.2 / §2.3）
 *
 * 数据布局（`skin-engine/`）：
 *   packs/<id>/                 用户导入包（只读语义）
 *   packs/.tmp-<id>-<rand>/     staging；成功后 rename 成 packs/<id>/，失败 rm -rf
 *   trash/<trashId>/            回收站（见 trash.js）
 *
 * 导入流水线（**任何一步失败都不落盘**）：
 *   1. 体积/数量预检（解码前先按 base64 长度估算，避免为超限包做无谓解码）
 *   2. 解码 base64 / 解包 bundle / dream-skin 映射，路径安全 + 文件白名单
 *   3. theme.json 必须存在且唯一；parseThemeJson + validateThemePack；声明的
 *      theme.css / assets.preview / typography.fonts[] 必须存在，CSS 走 validateThemeCss
 *   4. 自定义 CSS 确认：含 theme.css 且 confirmCustomCss !== true → 400 needs-confirmation
 *   5. 冲突/内置保护（内置 id 一律自动另存 `<id>-2`，overwrite 永远 400）
 *   6. 写 staging → 校验写入文件数/字节 → 覆盖时旧包先移入 trash → rename
 *
 * 所有错误都是中文可读 message + `details:[{path,code,message}]`；失败后 packs/ 与
 * trash/ 均无新增（staging 一定会被清理）。
 */
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import {
	LIMITS,
	checkPackPath,
	parseThemeJson,
	validateFileManifest,
	validateThemeCss,
	validateThemePack
} from "../../src/shared/pack-schema.js";
import {
	MAX_BUNDLE_BYTES,
	base64ToBytes,
	buildBundle,
	formatBytes,
	parseBundle,
	stringifyBundle
} from "../../src/shared/bundle-format.js";
import { mapDreamSkinPack } from "../../src/shared/dreamskin-compat.js";
import { builtinPackDir, getBuiltinPack, listBuiltinPacks } from "./packs.js";
import { packsDir, skinEngineDataDir, trashDir } from "./paths.js";
import {
	TRASH_COUNT_MAX,
	listTrash,
	moveToTrash,
	purgeTrash,
	restoreTrash,
	scanPackDirectory,
	trashCount
} from "./trash.js";

/** HTTP 传输自卫上限（契约 §2.3）：超过直接 413 可读 JSON，不再裸 destroy。 */
export const MAX_BODY_BYTES = 48 * 1024 * 1024;
/** 业务导入上限：bundle 原文 JSON 文本 ≤24 MB（16 MB 包 base64 膨胀后 ≈21.3 MB）。 */
export const IMPORT_MAX_BUNDLE_BYTES = MAX_BUNDLE_BYTES;
/** 活跃用户包数量上限。 */
export const PACK_COUNT_MAX = LIMITS.packCount;

const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;
const encoder = new TextEncoder();
const decoderUtf8Strict = new TextDecoder("utf-8", { fatal: true });

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isInside = (base, target) => target === base || target.startsWith(base + sep);
const issue = (path, code, message) => ({ path, code, message });

function fail(status, code, message, details) {
	return { ok: false, status, error: { code, message, ...(details && details.length > 0 ? { details } : {}) } };
}

function normalizeIssues(list) {
	const seen = new Set();
	const out = [];
	for (const item of list || []) {
		if (!item || typeof item !== "object") continue;
		const entry = {
			path: typeof item.path === "string" ? item.path : "$",
			code: typeof item.code === "string" ? item.code : "invalid",
			message: typeof item.message === "string" ? item.message : String(item.message)
		};
		const key = `${entry.path}\u0000${entry.code}\u0000${entry.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(entry);
		if (out.length >= 100) break;
	}
	return out;
}

function summaryOf(details) {
	if (!details || details.length === 0) return "";
	const first = details[0];
	return details.length === 1 ? `${first.path}：${first.message}` : `${first.path}：${first.message}（共 ${details.length} 项问题）`;
}

function decodeUtf8(bytes, path) {
	try {
		return { ok: true, text: decoderUtf8Strict.decode(bytes) };
	} catch {
		return { ok: false, error: issue(path, "encoding", `「${path}」不是合法 UTF-8 文本`) };
	}
}

function jsonByteLength(value) {
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

// ── 诊断 ────────────────────────────────────────────────────────────────────

export function diagCaps() {
	return {
		apiMaxBodyBytes: MAX_BODY_BYTES,
		importMaxBundleBytes: IMPORT_MAX_BUNDLE_BYTES,
		packMaxBytes: LIMITS.packBytes,
		fileMaxBytes: LIMITS.fileBytes,
		packCountMax: PACK_COUNT_MAX,
		trashCountMax: TRASH_COUNT_MAX
	};
}

// ── 用户包读取 ──────────────────────────────────────────────────────────────

/** `packs/<id>` 的真实目录；id 非法 / 不存在 / 符号链接 / 越界一律 null。 */
function userPackDir(id) {
	if (typeof id !== "string" || !ID_RE.test(id)) return null;
	const root = packsDir();
	if (!existsSync(root)) return null;
	const dir = join(root, id);
	let info;
	try {
		info = lstatSync(dir);
	} catch {
		return null;
	}
	if (!info.isDirectory() || info.isSymbolicLink()) return null;
	try {
		const realBase = realpathSync(root);
		const real = realpathSync(dir);
		if (!isInside(realBase, real)) return null;
	} catch {
		return null;
	}
	return dir;
}

/**
 * 安全读取包目录内的一个固定文件（theme.json / theme.css）：
 * 拒绝绝对路径/穿越、拒绝符号链接（不跟随）、realpath 必须仍在包目录内。
 * @returns {{ok: true, text: string} | {ok: false, message: string, missing?: boolean}}
 */
function readPackTextFile(dir, rel) {
	const problem = checkPackPath(rel);
	if (problem) return { ok: false, message: `路径不安全：${problem}` };
	const file = resolve(dir, rel);
	if (!isInside(dir, file) || file === dir) return { ok: false, message: "路径越界" };
	let info;
	try {
		info = lstatSync(file);
	} catch {
		return { ok: false, message: `文件「${rel}」不存在`, missing: true };
	}
	if (info.isSymbolicLink()) return { ok: false, message: `文件「${rel}」是符号链接，已拒绝（不跟随符号链接）` };
	if (!info.isFile()) return { ok: false, message: `「${rel}」不是普通文件` };
	try {
		const realBase = realpathSync(dir);
		const realFile = realpathSync(file);
		if (!isInside(realBase, realFile)) return { ok: false, message: `文件「${rel}」越界` };
	} catch (error) {
		return { ok: false, message: `文件「${rel}」无法解析真实路径：${error && error.message ? error.message : String(error)}` };
	}
	try {
		return { ok: true, text: readFileSync(file, "utf8") };
	} catch (error) {
		return { ok: false, message: `文件「${rel}」无法读取：${error && error.message ? error.message : String(error)}` };
	}
}

function packMeta(pack, extra) {
	return {
		id: pack.id,
		name: pack.name,
		nameZh: pack.nameZh || null,
		release: pack.release || "1.0.0",
		colorScheme: pack.colorScheme,
		preview: pack.preview || null,
		author: pack.author === undefined ? null : pack.author,
		description: pack.description || null,
		...extra
	};
}

/** 读 + 校验一个用户包（packs.get / export / delete 共用）。 */
function loadUserPack(id) {
	if (typeof id !== "string" || !ID_RE.test(id)) {
		return fail(404, "pack-not-found", `找不到用户主题包「${String(id).slice(0, 60)}」`);
	}
	const dir = userPackDir(id);
	if (dir === null) return fail(404, "pack-not-found", `找不到用户主题包「${id}」`);
	const themeFile = readPackTextFile(dir, "theme.json");
	if (!themeFile.ok) {
		return fail(500, "pack-invalid", `用户主题包「${id}」的 theme.json 无法读取：${themeFile.message}`);
	}
	const parsed = parseThemeJson(themeFile.text);
	if (!parsed.ok) {
		return fail(500, "pack-invalid", `用户主题包「${id}」的 theme.json 无法解析`, normalizeIssues(parsed.errors));
	}
	const validation = validateThemePack(parsed.pack);
	if (!validation.ok) {
		const details = normalizeIssues(validation.errors);
		return fail(500, "pack-invalid", `用户主题包「${id}」校验失败：${summaryOf(details)}`, details);
	}
	if (parsed.pack.id !== id) {
		return fail(500, "pack-invalid", `用户主题包「${id}」的 theme.json.id 是「${parsed.pack.id}」，与目录名不一致（目录名必须 = id）`);
	}
	let css = null;
	if (typeof parsed.pack.css === "string") {
		const cssFile = readPackTextFile(dir, "theme.css");
		if (!cssFile.ok) {
			return fail(500, "pack-invalid", `用户主题包「${id}」声明了 theme.css，但${cssFile.missing ? "文件不存在" : `无法读取：${cssFile.message}`}`);
		}
		css = cssFile.text;
		const cssResult = validateThemeCss(css, { filename: parsed.pack.css });
		if (!cssResult.ok) {
			const details = normalizeIssues(cssResult.errors);
			return fail(500, "pack-invalid", `用户主题包「${id}」的 CSS 校验失败：${summaryOf(details)}`, details);
		}
	}
	return { ok: true, pack: parsed.pack, css, dir, warnings: validation.warnings };
}

export function listUserPacks() {
	const root = packsDir();
	if (!existsSync(root)) return [];
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const packs = [];
	for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
		const id = entry.name;
		if (!entry.isDirectory() || entry.isSymbolicLink() || !ID_RE.test(id)) continue;
		const loaded = loadUserPack(id);
		if (!loaded.ok) continue;
		const stats = scanPackDirectory(loaded.dir);
		let updatedAt = null;
		try { updatedAt = statSync(join(loaded.dir, "theme.json")).mtime.toISOString(); } catch { /* 忽略 */ }
		packs.push(packMeta(loaded.pack, {
			bytes: stats.bytes,
			fileCount: stats.fileCount,
			updatedAt,
			source: "user"
		}));
	}
	return packs;
}

/** `packs.list`。 */
export function packsList() {
	const builtin = listBuiltinPacks();
	const user = listUserPacks();
	return {
		ok: true,
		status: 200,
		value: {
			builtin,
			user,
			counts: {
				builtin: builtin.length,
				user: user.length,
				trash: trashCount(),
				total: builtin.length + user.length
			},
			limits: { packCount: PACK_COUNT_MAX, packBytes: LIMITS.packBytes, fileBytes: LIMITS.fileBytes }
		}
	};
}

/** `packs.get`：内置优先（内置 id 不可能被用户包占用），否则读用户包。 */
export function getPack(args) {
	const id = args && args.id;
	if (typeof id !== "string" || id.trim() === "") return fail(400, "bad-request", "packs.get 需要 id 参数");
	const builtin = getBuiltinPack(id);
	if (builtin.ok) {
		return { ok: true, status: 200, value: { pack: builtin.pack, css: builtin.css, builtin: true, source: "builtin" } };
	}
	const loaded = loadUserPack(id);
	if (!loaded.ok) return loaded;
	return { ok: true, status: 200, value: { pack: loaded.pack, css: loaded.css, builtin: false, source: "user" } };
}

// ── 导出 ────────────────────────────────────────────────────────────────────

/** 递归列出包目录文件（不跟随符号链接；符号链接视为不安全直接报错）。 */
function collectPackFiles(dir) {
	const files = [];
	const problems = [];
	const walk = (current, prefix) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch (error) {
			problems.push(issue(prefix || "$", "read", `目录读取失败：${error && error.message ? error.message : String(error)}`));
			return;
		}
		for (const entry of entries) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const absolute = join(current, entry.name);
			if (entry.isSymbolicLink()) {
				problems.push(issue(rel, "symlink", `包内含符号链接「${rel}」，已拒绝（不跟随符号链接）`));
				continue;
			}
			if (entry.isDirectory()) walk(absolute, rel);
			else if (entry.isFile()) {
				if (entry.name === ".trash-meta.json") continue;
				files.push({ path: rel, absolute });
			}
		}
	};
	walk(dir, "");
	return { files, problems };
}

/** `packs.export`：读包目录 → 组装 `.dshte.json` 交换对象（资源内嵌 data URL）。 */
export function exportPack(args) {
	const id = args && args.id;
	if (typeof id !== "string" || id.trim() === "") return fail(400, "bad-request", "packs.export 需要 id 参数");

	let pack = null;
	let dir = null;
	if (listBuiltinPacks().some((item) => item.id === id)) {
		const builtin = getBuiltinPack(id);
		if (!builtin.ok) return fail(500, "pack-invalid", `内置主题包「${id}」无法导出：${builtin.error}`);
		pack = builtin.pack;
		dir = builtinPackDir(id);
	} else {
		const loaded = loadUserPack(id);
		if (!loaded.ok) return loaded;
		pack = loaded.pack;
		dir = loaded.dir;
	}

	const collected = collectPackFiles(dir);
	if (collected.problems.length > 0) {
		return fail(500, "pack-invalid", `主题包「${id}」文件不安全：${summaryOf(collected.problems)}`, normalizeIssues(collected.problems));
	}
	const files = new Map();
	for (const file of collected.files) {
		if (file.path === "theme.json") continue;
		try {
			files.set(file.path, readFileSync(file.absolute));
		} catch (error) {
			return fail(500, "pack-invalid", `读取「${file.path}」失败：${error && error.message ? error.message : String(error)}`);
		}
	}
	const built = buildBundle({ pack, files });
	if (!built.ok) {
		const details = normalizeIssues(built.errors);
		return fail(500, "pack-invalid", `主题包「${id}」导出前校验失败：${summaryOf(details)}`, details);
	}
	const text = stringifyBundle(built.bundle);
	return {
		ok: true,
		status: 200,
		value: {
			fileName: `${pack.id}-${pack.release || "1.0.0"}.dshte.json`,
			bytes: Buffer.byteLength(text, "utf8"),
			fileCount: built.stats.fileCount,
			bundle: built.bundle
		}
	};
}

// ── 删除 ────────────────────────────────────────────────────────────────────

/** `packs.delete`：用户包移入回收站；内置包 400；不存在 404。 */
export function deletePack(args) {
	const id = args && args.id;
	if (typeof id !== "string" || id.trim() === "") return fail(400, "bad-request", "packs.delete 需要 id 参数");
	if (listBuiltinPacks().some((item) => item.id === id)) {
		return fail(400, "builtin-protected", `「${id}」是内置主题包，不能删除（内置包只读）`);
	}
	const loaded = loadUserPack(id);
	if (!loaded.ok) return loaded;
	const stats = scanPackDirectory(loaded.dir);
	const moved = moveToTrash({
		sourceDir: loaded.dir,
		id,
		name: loaded.pack.name,
		nameZh: loaded.pack.nameZh || null,
		bytes: stats.bytes,
		fileCount: stats.fileCount,
		source: "user"
	});
	if (!moved.ok) return moved;
	return { ok: true, status: 200, value: { id, trashId: moved.trashId } };
}

// ── 冲突 / 另存 ────────────────────────────────────────────────────────────

function nextFreePackId(baseId, builtinIds, userIds) {
	const exists = (candidate) => builtinIds.has(candidate) || userIds.has(candidate);
	const base = String(baseId).slice(0, 47).replace(/-+$/, "") || "pack";
	if (!exists(base)) return base;
	for (let counter = 2; counter <= 1000; counter++) {
		const suffix = `-${counter}`;
		const cut = base.slice(0, 47 - suffix.length).replace(/-+$/, "") || "pack";
		const candidate = `${cut}${suffix}`;
		if (!exists(candidate)) return candidate;
	}
	return null;
}

/**
 * 冲突解析（Lead 2026-11-03 批准的最终语义）：
 *   - 内置 id：`overwrite` → 400 builtin-protected（内置永远不可覆盖）；
 *     reject / rename / 缺省 → 自动另存 `<id>-2`（验收「内置导出→导入」必须成功）；
 *   - 用户包：reject（缺省）→ 409；rename → `<id>-2…`；overwrite → 旧包进 trash。
 * @returns {{ok:true, finalId:string, collision:string, renamedFrom?:string} | {ok:false, status:number, error:object}}
 */
function resolveCollision(packId, collision, builtinIds, userIds) {
	if (builtinIds.has(packId)) {
		if (collision === "overwrite") {
			return fail(
				400,
				"builtin-protected",
				`「${packId}」是内置主题包，不能被覆盖；已自动另存为「${packId}-2」（内置包只读）`,
				[issue("id", "builtin-protected", "内置主题包 id 不可覆盖；导入会另存为新的用户包 id")]
			);
		}
		const finalId = nextFreePackId(packId, builtinIds, userIds);
		if (finalId === null) return fail(409, "conflict", `「${packId}」是内置主题包且找不到可用新 id，请先清理部分用户主题包`);
		return { ok: true, finalId, collision: "renamed", renamedFrom: packId };
	}
	if (!userIds.has(packId)) return { ok: true, finalId: packId, collision: "none" };
	if (collision === "reject") {
		return fail(
			409,
			"conflict",
			`用户主题包「${packId}」已存在；请改用 collision:"rename"（另存为 ${packId}-2）或 collision:"overwrite"（旧包移入回收站）`,
			[issue("id", "conflict", "同名用户主题包已存在")]
		);
	}
	if (collision === "rename") {
		const finalId = nextFreePackId(packId, builtinIds, userIds);
		if (finalId === null) return fail(409, "conflict", `找不到可用的新 id，请先清理部分用户主题包`);
		return { ok: true, finalId, collision: "renamed", renamedFrom: packId };
	}
	return { ok: true, finalId: packId, collision: "overwritten" };
}

// ── 导入：三种来源的解码 ────────────────────────────────────────────────────

/**
 * folder：`files: { 路径: 纯 base64 }`。
 * 先按 base64 长度估算解码体积（避免为超限包做无谓解码），再严格解码。
 */
function decodeFolderInput(input, limits) {
	if (!isPlainObject(input)) return fail(400, "bad-request", "source:\"folder\" 需要 files: { 路径: base64 } 对象");
	const entries = Object.entries(input);
	if (entries.length === 0) return fail(400, "bad-request", "导入的文件列表不能为空");
	if (entries.length > limits.fileCount) {
		return fail(400, "too-many-files", `文件数量 ${entries.length} 超过上限 ${limits.fileCount}`);
	}
	const details = [];
	let estimatedTotal = 0;
	for (const [path, value] of entries) {
		if (typeof value !== "string") {
			details.push(issue(`files["${path}"]`, "type", "文件内容必须是 base64 字符串（纯 base64，不带 data: 前缀）"));
			continue;
		}
		const estimated = Math.max(0, Math.floor((value.length * 3) / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
		estimatedTotal += estimated;
		if (estimated > limits.fileBytes) {
			details.push(issue(`files["${path}"]`, "file-too-large", `文件「${path}」约 ${formatBytes(estimated)}，超过单文件上限 ${formatBytes(limits.fileBytes)}`));
		}
	}
	if (estimatedTotal > limits.packBytes) {
		return fail(400, "pack-too-large", `包总大小超过上限 ${formatBytes(limits.packBytes)}（base64 解码后约 ${formatBytes(estimatedTotal)}）`);
	}
	if (details.length > 0) {
		return fail(400, "invalid-files", `导入文件列表不合法：${summaryOf(details)}`, details);
	}

	const files = new Map();
	const decodeErrors = [];
	for (const [path, value] of entries) {
		try {
			files.set(path, base64ToBytes(value));
		} catch (error) {
			decodeErrors.push(issue(`files["${path}"]`, "base64", `base64 解码失败：${error && error.message ? error.message : String(error)}`));
		}
	}
	if (decodeErrors.length > 0) return fail(400, "invalid-files", `导入文件列表不合法：${summaryOf(decodeErrors)}`, decodeErrors);

	const manifestResult = validateFileManifest(
		[...files].map(([path, bytes]) => ({ path, size: bytes.length })),
		{ limits }
	);
	if (!manifestResult.ok) {
		const detailsOut = normalizeIssues(manifestResult.errors);
		return fail(400, "invalid-files", `导入文件列表不合法：${summaryOf(detailsOut)}`, detailsOut);
	}
	if (!files.has("theme.json")) {
		return fail(400, "missing-file", "包内缺少 theme.json", [issue("theme.json", "missing-file", "folder 导入必须包含 theme.json")]);
	}
	const themeText = decodeUtf8(files.get("theme.json"), "theme.json");
	if (!themeText.ok) return fail(400, "invalid-pack", "theme.json 不是合法 UTF-8 文本", [themeText.error]);
	const parsed = parseThemeJson(themeText.text);
	if (!parsed.ok) {
		const detailsOut = normalizeIssues(parsed.errors);
		return fail(400, "invalid-pack", `theme.json 不是合法 JSON：${summaryOf(detailsOut)}`, detailsOut);
	}
	return { ok: true, pack: parsed.pack, files, warnings: manifestResult.warnings, report: null };
}

/** bundle：客户端已 JSON.parse 的 `.dshte.json` 对象。 */
function decodeBundleInput(input, limits, maxBundleBytes) {
	if (!isPlainObject(input)) return fail(400, "bad-request", "source:\"bundle\" 需要 bundle: { format, formatVersion, pack, files } 对象（客户端已 JSON.parse）");
	const textBytes = jsonByteLength(input);
	if (textBytes > maxBundleBytes) {
		return fail(400, "bundle-too-large", `交换包文本约 ${formatBytes(textBytes)}，超过上限 ${formatBytes(maxBundleBytes)}`);
	}
	const parsed = parseBundle(input, { limits, maxBundleBytes });
	if (!parsed.ok) {
		const details = normalizeIssues(parsed.errors);
		// 体积类问题给专门的错误码，方便验收区分「业务上限」与「格式错误」。
		const codes = new Set(details.map((item) => item.code));
		const code = codes.has("bundle-too-large") ? "bundle-too-large"
			: codes.has("pack-too-large") ? "pack-too-large"
				: codes.has("file-too-large") ? "file-too-large"
					: "invalid-bundle";
		return fail(400, code, `交换包校验失败：${summaryOf(details)}`, details);
	}
	const files = new Map();
	for (const [path, value] of parsed.files) {
		files.set(path, typeof value === "string" ? encoder.encode(value) : value);
	}
	return { ok: true, pack: parsed.pack, files, warnings: parsed.warnings, report: null };
}

/** dreamskin：`dsh-dream-skin/pack` 单 JSON（映射成 v1 包）。 */
function decodeDreamSkinInput(input, maxBundleBytes) {
	if (!isPlainObject(input)) return fail(400, "bad-request", "source:\"dreamskin\" 需要 json: dream-skin 主题包对象（客户端已 JSON.parse）");
	const textBytes = jsonByteLength(input);
	if (textBytes > maxBundleBytes) {
		return fail(400, "bundle-too-large", `dream-skin 主题包文本约 ${formatBytes(textBytes)}，超过上限 ${formatBytes(maxBundleBytes)}`);
	}
	const mapped = mapDreamSkinPack(input);
	if (!mapped.ok) {
		const details = normalizeIssues(mapped.errors);
		return fail(400, "invalid-dreamskin", `dream-skin 主题包不合法：${summaryOf(details)}`, details);
	}
	return { ok: true, pack: mapped.pack, files: new Map(), warnings: mapped.warnings, report: mapped.report };
}

// ── 导入：公共校验（③ 声明文件存在 / CSS / ④ 自定义 CSS 确认） ────────────────

function validateImportedPack(pack, files, warnings) {
	if (!isPlainObject(pack)) {
		return fail(400, "invalid-pack", "theme.json 顶层必须是对象", [issue("$", "type", "theme.json 顶层必须是对象")]);
	}
	const validation = validateThemePack(pack);
	if (!validation.ok) {
		const details = normalizeIssues(validation.errors);
		return fail(400, "invalid-pack", `主题包校验失败：${summaryOf(details)}`, details);
	}
	warnings.push(...validation.warnings);

	const details = [];
	const cssPath = typeof pack.css === "string" ? pack.css : null;
	if (cssPath !== null) {
		const problem = checkPackPath(cssPath);
		if (problem) details.push(issue("css", "unsafe-path", `theme.json 的 css 路径不安全：${problem}`));
		else if (!files.has(cssPath)) details.push(issue(`files["${cssPath}"]`, "missing-file", `theme.json 声明了「${cssPath}」，但导入内容里没有这个文件`));
	}
	if (isPlainObject(pack.assets) && typeof pack.assets.preview === "string" && !files.has(pack.assets.preview)) {
		details.push(issue("assets.preview", "missing-file", `assets.preview 指向的文件「${pack.assets.preview}」不在包内`));
	}
	if (isPlainObject(pack.typography) && Array.isArray(pack.typography.fonts)) {
		pack.typography.fonts.forEach((font, index) => {
			const file = isPlainObject(font) && typeof font.file === "string" ? font.file : null;
			if (file !== null && !files.has(file)) details.push(issue(`typography.fonts[${index}].file`, "missing-file", `字体文件「${file}」不在包内`));
		});
	}
	if (cssPath !== null && files.has(cssPath)) {
		const cssText = decodeUtf8(files.get(cssPath), cssPath);
		if (!cssText.ok) details.push(cssText.error);
		else {
			const cssResult = validateThemeCss(cssText.text, { filename: cssPath });
			if (!cssResult.ok) details.push(...cssResult.errors);
			warnings.push(...cssResult.warnings);
		}
	}
	if (cssPath === null && files.has("theme.css")) {
		warnings.push(issue("theme.css", "theme-css-undeclared", "包内存在 theme.css，但 theme.json 没有写 \"css\":\"theme.css\"，导入后这份 CSS 不会生效"));
	}
	if (details.length > 0) {
		const normalized = normalizeIssues(details);
		return fail(400, "invalid-pack", `主题包校验失败：${summaryOf(normalized)}`, normalized);
	}
	return null;
}

function needsCustomCssConfirmation(pack, files, confirmCustomCss) {
	const hasCustomCss = (typeof pack.css === "string" && pack.css !== "") || files.has("theme.css");
	if (!hasCustomCss || confirmCustomCss === true) return null;
	const path = typeof pack.css === "string" && pack.css !== "" ? pack.css : "theme.css";
	return fail(
		400,
		"needs-confirmation",
		"该包包含自定义 CSS（可影响整个界面），请确认来源可信后重试",
		[issue(path, "contains-custom-css", "包内含 theme.css；确认可信后带 confirmCustomCss:true 重试")]
	);
}

// ── 导入：落盘（staging → 校验 → rename） ──────────────────────────────────

function walkStaging(dir) {
	const files = [];
	const walk = (current, prefix) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const absolute = join(current, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) walk(absolute, rel);
			else if (entry.isFile()) files.push({ path: rel, size: statSync(absolute).size });
		}
	};
	walk(dir, "");
	return files;
}

function writeStaging(finalId, files, storedPack) {
	const root = packsDir();
	let staging = null;
	try {
		mkdirSync(root, { recursive: true });
		const rootReal = realpathSync(root);
		staging = join(root, `.tmp-${finalId}-${randomUUID().slice(0, 8)}`);
		mkdirSync(staging, { recursive: true });
		const stagingReal = realpathSync(staging);
		if (!isInside(rootReal, stagingReal)) throw new Error("staging 目录越界");
		if (files.has("theme.json")) files.delete("theme.json");

		const expected = [];
		const themeText = JSON.stringify(storedPack, null, 2) + "\n";
		writeFileSync(join(stagingReal, "theme.json"), themeText, "utf8");
		expected.push({ path: "theme.json", size: Buffer.byteLength(themeText, "utf8") });

		let assetCount = 0;
		for (const [rel, bytes] of files) {
			const problem = checkPackPath(rel);
			if (problem) throw new Error(`文件路径不安全：${rel}（${problem}）`);
			const target = resolve(stagingReal, rel);
			if (!isInside(stagingReal, target) || target === stagingReal) throw new Error(`文件路径越界：${rel}`);
			mkdirSync(dirname(target), { recursive: true });
			const parentReal = realpathSync(dirname(target));
			if (!isInside(stagingReal, parentReal)) throw new Error(`文件父目录越界：${rel}`);
			writeFileSync(target, bytes);
			if (rel.startsWith("assets/")) assetCount += 1;
			expected.push({ path: rel, size: bytes.length });
		}

		const scanned = walkStaging(stagingReal);
		const expectedBytes = expected.reduce((total, file) => total + file.size, 0);
		const scannedBytes = scanned.reduce((total, file) => total + file.size, 0);
		if (scanned.length !== expected.length) throw new Error(`写入文件数不一致：期望 ${expected.length}，实际 ${scanned.length}`);
		if (scannedBytes !== expectedBytes) throw new Error(`写入字节数不一致：期望 ${expectedBytes}，实际 ${scannedBytes}`);
		for (const file of scanned) {
			if (!expected.some((item) => item.path === file.path)) throw new Error(`写入出现多余文件：${file.path}`);
		}
		return {
			ok: true,
			staging: stagingReal,
			stats: { bytes: scannedBytes, fileCount: scanned.length, assetCount }
		};
	} catch (error) {
		if (staging !== null) {
			try { rmSync(staging, { recursive: true, force: true }); } catch { /* 清理失败不掩盖原错误 */ }
		}
		return fail(500, "internal", `写入临时目录失败：${error && error.message ? error.message : String(error)}`);
	}
}

function buildUserMeta(pack, dir, stats) {
	let updatedAt = null;
	try { updatedAt = statSync(join(dir, "theme.json")).mtime.toISOString(); } catch { /* 忽略 */ }
	return packMeta(pack, {
		bytes: stats.bytes,
		fileCount: stats.fileCount,
		updatedAt,
		source: "user"
	});
}

// ── 导入入口 ────────────────────────────────────────────────────────────────

/**
 * `packs.import`（契约 §2.2）。args.source 为 folder / bundle / dreamskin。
 * @param {object} args
 * @param {{limits?: object, maxBundleBytes?: number}} [context] 测试可注入更小上限
 */
export function importPack(args, context = {}) {
	if (!isPlainObject(args)) return fail(400, "bad-request", "packs.import 参数必须是对象");
	const limits = { ...LIMITS, ...(isPlainObject(context.limits) ? context.limits : {}) };
	const maxBundleBytes = Number.isFinite(context.maxBundleBytes) ? context.maxBundleBytes : IMPORT_MAX_BUNDLE_BYTES;
	const source = args.source;
	if (source !== "folder" && source !== "bundle" && source !== "dreamskin") {
		return fail(400, "bad-request", `不支持的导入来源 ${JSON.stringify(source)}，只支持 "folder" / "bundle" / "dreamskin"`);
	}
	const collision = args.collision === undefined ? "reject" : args.collision;
	if (collision !== "reject" && collision !== "rename" && collision !== "overwrite") {
		return fail(400, "bad-request", `collision 只能是 "reject" / "rename" / "overwrite"，当前是 ${JSON.stringify(args.collision)}`);
	}
	const confirmCustomCss = args.confirmCustomCss === true;

	let decoded;
	if (source === "folder") decoded = decodeFolderInput(args.files, limits);
	else if (source === "bundle") decoded = decodeBundleInput(args.bundle, limits, maxBundleBytes);
	else decoded = decodeDreamSkinInput(args.json, maxBundleBytes);
	if (!decoded.ok) return decoded;

	const warnings = [...(decoded.warnings || [])];

	const packProblem = validateImportedPack(decoded.pack, decoded.files, warnings);
	if (packProblem !== null) return packProblem;
	const pack = decoded.pack;

	const confirmation = needsCustomCssConfirmation(pack, decoded.files, confirmCustomCss);
	if (confirmation !== null) return confirmation;

	// 冲突 / 内置保护（先取一次包清单，供后续计数与覆盖提示使用）
	const builtinIds = new Set(listBuiltinPacks().map((item) => item.id));
	const userPacks = listUserPacks();
	const userById = new Map(userPacks.map((item) => [item.id, item]));
	const userIds = new Set(userById.keys());
	const resolved = resolveCollision(pack.id, collision, builtinIds, userIds);
	if (!resolved.ok) return resolved;

	// 数量上限（覆盖导入不增加数量）
	if (resolved.collision !== "overwritten" && userPacks.length >= PACK_COUNT_MAX) {
		return fail(400, "pack-limit-reached", `用户主题包已达上限 ${PACK_COUNT_MAX} 个，请先删除部分包再导入`);
	}

	// 最终落盘 id 与源 theme.json id 不一致时，改写并重新校验（目录名 = theme.json 的 id）
	const finalId = resolved.finalId;
	const storedPack = finalId === pack.id ? pack : { ...pack, id: finalId };
	if (finalId !== pack.id) {
		const revalidation = validateThemePack(storedPack);
		if (!revalidation.ok) {
			const details = normalizeIssues(revalidation.errors);
			return fail(400, "invalid-pack", `自动另存为「${finalId}」后主题包校验失败：${summaryOf(details)}`, details);
		}
	}

	const staging = writeStaging(finalId, decoded.files, storedPack);
	if (!staging.ok) return staging;

	const root = packsDir();
	const target = join(root, finalId);
	let movedTrashId = null;
	try {
		if (resolved.collision === "overwritten") {
			const oldMeta = userById.get(finalId);
			const oldStats = scanPackDirectory(target);
			const moved = moveToTrash({
				sourceDir: target,
				id: finalId,
				name: oldMeta ? oldMeta.name : finalId,
				nameZh: oldMeta ? oldMeta.nameZh : null,
				bytes: oldStats.bytes,
				fileCount: oldStats.fileCount,
				source: "user"
			});
			if (!moved.ok) {
				try { rmSync(staging.staging, { recursive: true, force: true }); } catch { /* 忽略 */ }
				return moved;
			}
			movedTrashId = moved.trashId;
		}
		renameSync(staging.staging, target);
	} catch (error) {
		if (movedTrashId !== null) {
			// 覆盖失败回滚：旧包从 trash 移回原位。
			try { renameSync(join(trashDir(), movedTrashId), target); } catch { /* 回滚失败时旧包仍在 trash，可手工恢复 */ }
		}
		try { rmSync(staging.staging, { recursive: true, force: true }); } catch { /* 忽略 */ }
		return fail(500, "internal", `写入用户主题包失败：${error && error.message ? error.message : String(error)}`);
	}

	const value = {
		id: finalId,
		collision: resolved.collision,
		source,
		pack: buildUserMeta(storedPack, target, staging.stats),
		stats: staging.stats,
		warnings: normalizeIssues(warnings),
		report: decoded.report === undefined ? null : decoded.report
	};
	if (resolved.renamedFrom !== undefined) value.renamedFrom = resolved.renamedFrom;
	if (movedTrashId !== null) value.trashId = movedTrashId;
	return { ok: true, status: 200, value };
}

// ── trash 便捷导出（api.js 直接用） ─────────────────────────────────────────

export { listTrash, purgeTrash, restoreTrash };

/** 数据根（诊断/测试用）。 */
export function dataDirectory() {
	return skinEngineDataDir();
}
