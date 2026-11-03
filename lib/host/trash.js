/**
 * 回收站（Step 6 契约 §1 / §2.1）：
 *
 *   skin-engine/trash/<trashId>/            trashId = <id>-<YYYYMMDD-HHmmss-SSS>
 *   ├─ theme.json / theme.css / assets/…    包文件原样保留
 *   └─ .trash-meta.json                     {id,name,nameZh,deletedAt,bytes,fileCount,source}
 *
 * 设计要点：
 *   - 删除只进回收站，**不硬删**；`trash.purge` 才真正 rm -rf（只删 `trash/<trashId>`）；
 *   - 条目上限 100（契约 §1）：满了以后 `packs.delete` / 覆盖导入返回可读错误；
 *   - 恢复时若 `packs/<id>` 已存在（或撞内置包 id），自动后缀 `-2/-3…`，
 *     并把写入的 `theme.json.id` **同步改写成最终 id**（否则目录名 ≠ pack.id，
 *     engine 的 `packs.get` 与 assets 路由会 404）；改写后重新 `validateThemePack`，
 *     失败则回滚（包退回回收站），绝不留下坏包；
 *   - 恢复成功会删掉 `.trash-meta.json`（它不是合法包文件，留着会让后续 export 报 file-location）。
 *
 * 路径安全：所有 trashId 先过 `^[a-z][a-z0-9-]{2,71}$`，再确认是 trash 根下的真实目录
 * （`lstat` 非符号链接 + `realpath` 包含性），绝不拼出 trash 根以外的路径。
 */
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { parseThemeJson, validateThemePack } from "../../src/shared/pack-schema.js";
import { listBuiltinPacks } from "./packs.js";
import { packsDir, trashDir } from "./paths.js";

export const TRASH_META_FILE = ".trash-meta.json";
export const TRASH_COUNT_MAX = 100;

const ID_RE = /^[a-z][a-z0-9-]{2,47}$/;
const TRASH_ID_RE = /^[a-z][a-z0-9-]{2,71}$/;
const TRASH_ID_PARTS = /^(.*)-(\d{8})-(\d{6})-(\d{3})$/;

const isInside = (base, target) => target === base || target.startsWith(base + sep);

function fail(status, code, message, details) {
	return { ok: false, status, error: { code, message, ...(details ? { details } : {}) } };
}

function realRoot(root) {
	mkdirSync(root, { recursive: true });
	return realpathSync(root);
}

/** 解析一个“必须是 root 下真实目录（非符号链接）”的路径；不合格返回 null。 */
function realDirectoryInside(root, candidate) {
	let info;
	try {
		info = lstatSync(candidate);
	} catch {
		return null;
	}
	if (!info.isDirectory() || info.isSymbolicLink()) return null;
	let real;
	try {
		real = realpathSync(candidate);
	} catch {
		return null;
	}
	let base;
	try {
		base = realpathSync(root);
	} catch {
		return null;
	}
	return isInside(base, real) ? real : null;
}

// ── 通用目录扫描 ────────────────────────────────────────────────────────────

/** 递归统计一个包目录的文件数与总字节（不跟随符号链接）。 */
export function scanPackDirectory(dir) {
	const files = [];
	const walk = (current, prefix) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const absolute = join(current, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) walk(absolute, rel);
			else if (entry.isFile()) {
				let size = 0;
				try { size = statSync(absolute).size; } catch { /* 忽略读不到的文件 */ }
				files.push({ path: rel, size });
			}
		}
	};
	walk(dir, "");
	return { files, fileCount: files.length, bytes: files.reduce((total, file) => total + file.size, 0) };
}

// ── trashId ────────────────────────────────────────────────────────────────

function stampOf(date) {
	const iso = date.toISOString(); // 2026-11-03T07:30:00.123Z
	return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${iso.slice(20, 23)}`;
}

function uniqueTrashId(id, now) {
	const base = `${id}-${stampOf(now)}`;
	let candidate = base;
	let counter = 1;
	while (existsSync(join(trashDir(), candidate))) {
		counter += 1;
		candidate = `${base}-${counter}`;
	}
	return candidate;
}

export function assertTrashId(trashId) {
	if (typeof trashId !== "string" || !TRASH_ID_RE.test(trashId)) return "回收站条目 id 不合法";
	return null;
}

// ── 元数据 ──────────────────────────────────────────────────────────────────

function deriveEntryFromTrashId(trashId, dir) {
	const match = TRASH_ID_PARTS.exec(trashId);
	const id = match && ID_RE.test(match[1]) ? match[1] : trashId.slice(0, 47);
	let deletedAt = null;
	try { deletedAt = statSync(dir).mtime.toISOString(); } catch { /* 忽略 */ }
	const stats = scanPackDirectory(dir);
	let name = id;
	let nameZh = null;
	let source = "user";
	try {
		const file = join(dir, "theme.json");
		const info = lstatSync(file);
		if (info.isFile() && !info.isSymbolicLink()) {
			const parsed = parseThemeJson(readFileSync(file, "utf8"));
			if (parsed.ok && parsed.pack && typeof parsed.pack === "object") {
				if (typeof parsed.pack.name === "string" && parsed.pack.name.trim() !== "") name = parsed.pack.name;
				if (typeof parsed.pack.nameZh === "string" && parsed.pack.nameZh.trim() !== "") nameZh = parsed.pack.nameZh;
			}
		}
	} catch { /* 包目录可能已损坏，元数据退化为 id */ }
	return { trashId, id, name, nameZh, deletedAt, bytes: stats.bytes, fileCount: stats.fileCount, source };
}

/** 读一个回收站条目的元数据（缺 `.trash-meta.json` 时按目录内容退化推断）。 */
export function readTrashEntry(trashId) {
	const dir = join(trashDir(), trashId);
	const metaFile = join(dir, TRASH_META_FILE);
	let meta = null;
	try {
		const raw = JSON.parse(readFileSync(metaFile, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) meta = raw;
	} catch { /* 缺文件或坏 JSON → 退化 */ }
	const derived = deriveEntryFromTrashId(trashId, dir);
	const entry = {
		trashId,
		id: typeof meta?.id === "string" && ID_RE.test(meta.id) ? meta.id : derived.id,
		name: typeof meta?.name === "string" && meta.name.trim() !== "" ? meta.name : derived.name,
		nameZh: typeof meta?.nameZh === "string" && meta.nameZh.trim() !== "" ? meta.nameZh : derived.nameZh,
		deletedAt: typeof meta?.deletedAt === "string" ? meta.deletedAt : derived.deletedAt,
		bytes: Number.isFinite(meta?.bytes) && meta.bytes >= 0 ? meta.bytes : derived.bytes,
		fileCount: Number.isFinite(meta?.fileCount) && meta.fileCount >= 0 ? meta.fileCount : derived.fileCount,
		source: typeof meta?.source === "string" ? meta.source : derived.source
	};
	return entry;
}

function trashEntryDirectories() {
	const root = trashDir();
	if (!existsSync(root)) return [];
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const out = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		if (!TRASH_ID_RE.test(entry.name)) continue;
		out.push(entry.name);
	}
	return out;
}

export function trashCount() {
	return trashEntryDirectories().length;
}

/** `trash.list`：按 deletedAt 倒序（同时间按 trashId 倒序，保证稳定）。 */
export function listTrash() {
	const entries = trashEntryDirectories().map((trashId) => readTrashEntry(trashId));
	entries.sort((left, right) => {
		const a = left.deletedAt || "";
		const b = right.deletedAt || "";
		if (a !== b) return a < b ? 1 : -1;
		return left.trashId < right.trashId ? 1 : left.trashId > right.trashId ? -1 : 0;
	});
	return { entries, count: entries.length };
}

// ── 移入回收站 ──────────────────────────────────────────────────────────────

/**
 * 把一个包目录整体移入回收站（rename；跨卷时才 copy+rm）。调用方负责先把
 * `sourceDir` 校验成 `packs/` 下的真实目录。
 * @returns {{ok: true, trashId: string, entry: object} | {ok: false, status: number, error: object}}
 */
export function moveToTrash(input) {
	const { sourceDir, id, name, nameZh, bytes, fileCount, source, now } = input;
	if (trashCount() >= TRASH_COUNT_MAX) {
		return fail(409, "trash-full", `回收站已满（${TRASH_COUNT_MAX} 条），请先彻底删除部分条目再删除主题包`);
	}
	const root = realRoot(trashDir());
	const trashId = uniqueTrashId(ID_RE.test(id) ? id : "pack", now || new Date());
	const target = resolve(root, trashId);
	if (!isInside(root, target) || target === root) return fail(500, "internal", "回收站目标路径不合法");
	const entry = {
		id,
		name: typeof name === "string" && name.trim() !== "" ? name : id,
		nameZh: typeof nameZh === "string" && nameZh.trim() !== "" ? nameZh : null,
		deletedAt: (now || new Date()).toISOString(),
		bytes: Number.isFinite(bytes) ? bytes : 0,
		fileCount: Number.isFinite(fileCount) ? fileCount : 0,
		source: typeof source === "string" ? source : "user"
	};
	try {
		renameSync(sourceDir, target);
	} catch (error) {
		if (error && error.code === "EXDEV") {
			try {
				cpSync(sourceDir, target, { recursive: true });
				rmSync(sourceDir, { recursive: true, force: true });
			} catch (fallbackError) {
				try { rmSync(target, { recursive: true, force: true }); } catch { /* 清理失败不掩盖原错误 */ }
				return fail(500, "internal", `移入回收站失败：${fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError)}`);
			}
		} else {
			return fail(500, "internal", `移入回收站失败：${error && error.message ? error.message : String(error)}`);
		}
	}
	try {
		writeFileSync(join(target, TRASH_META_FILE), JSON.stringify({ ...entry, trashId }, null, 2) + "\n", "utf8");
	} catch (error) {
		// 元数据写失败：把包退回原位，避免“回收站里有个没有元数据的包”。
		try { renameSync(target, sourceDir); } catch { /* 回滚失败时保留在 trash，用户仍可手动处理 */ }
		return fail(500, "internal", `回收站元数据写入失败：${error && error.message ? error.message : String(error)}`);
	}
	return { ok: true, trashId, entry: { ...entry, trashId } };
}

// ── 恢复 / 彻底删除 ─────────────────────────────────────────────────────────

/** `packs/<id>` 是否被占用（用户包或内置包 id）；占用则给出下一个可用 id。 */
function nextFreePackId(baseId, builtinIds) {
	const root = packsDir();
	const exists = (candidate) => builtinIds.has(candidate) || existsSync(join(root, candidate));
	const trimmed = String(baseId).slice(0, 47).replace(/-+$/, "") || "pack";
	if (!exists(trimmed)) return trimmed;
	for (let counter = 2; counter <= 1000; counter++) {
		const suffix = `-${counter}`;
		const cut = trimmed.slice(0, 47 - suffix.length).replace(/-+$/, "") || "pack";
		const candidate = `${cut}${suffix}`;
		if (!exists(candidate)) return candidate;
	}
	return null;
}

/**
 * 恢复后的强校验：目录名必须 = theme.json 的 id（否则 engine 的 packs.get 与
 * assets 路由会 404）。id 不一致时改写并**重新 validateThemePack**；校验失败
 * 由调用方回滚，绝不留下坏包。
 */
function repairRestoredPack(dir, id) {
	const file = join(dir, "theme.json");
	let info;
	try {
		info = lstatSync(file);
	} catch {
		return { ok: false, message: "theme.json 不存在" };
	}
	if (info.isSymbolicLink() || !info.isFile()) return { ok: false, message: "theme.json 不是普通文件（拒绝符号链接）" };
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		return { ok: false, message: `theme.json 无法读取：${error && error.message ? error.message : String(error)}` };
	}
	const parsed = parseThemeJson(text);
	if (!parsed.ok) return { ok: false, message: "theme.json 无法解析：" + parsed.errors.map((item) => item.message).join("; ") };
	if (parsed.pack === null || typeof parsed.pack !== "object" || Array.isArray(parsed.pack)) {
		return { ok: false, message: "theme.json 顶层不是对象" };
	}
	const needsRewrite = parsed.pack.id !== id;
	const pack = needsRewrite ? { ...parsed.pack, id } : parsed.pack;
	const validation = validateThemePack(pack);
	if (!validation.ok) {
		return { ok: false, message: "theme.json 校验失败：" + validation.errors.map((item) => `${item.path} ${item.message}`).join("; ") };
	}
	if (needsRewrite) {
		try {
			writeFileSync(file, JSON.stringify(pack, null, 2) + "\n", "utf8");
		} catch (error) {
			return { ok: false, message: `改写 theme.json 失败：${error && error.message ? error.message : String(error)}` };
		}
	}
	return { ok: true, rewritten: needsRewrite };
}

/** `trash.restore`。 */
export function restoreTrash(trashId) {
	const idProblem = assertTrashId(trashId);
	if (idProblem) return fail(400, "bad-request", idProblem);
	const source = join(trashDir(), trashId);
	const sourceReal = realDirectoryInside(trashDir(), source);
	if (sourceReal === null) return fail(404, "trash-not-found", `回收站里找不到条目「${trashId}」`);

	const entry = readTrashEntry(trashId);
	const builtinIds = new Set(listBuiltinPacks().map((pack) => pack.id));
	const restoredTo = nextFreePackId(ID_RE.test(entry.id) ? entry.id : "pack", builtinIds);
	if (restoredTo === null) return fail(409, "conflict", "找不到可用的包 id，请先清理部分用户主题包");

	const root = realRoot(packsDir());
	const target = resolve(root, restoredTo);
	if (!isInside(root, target) || target === root) return fail(500, "internal", "恢复目标路径不合法");
	if (existsSync(target)) return fail(409, "conflict", `用户主题包「${restoredTo}」已存在，无法恢复`);

	try {
		renameSync(sourceReal, target);
	} catch (error) {
		return fail(500, "internal", `恢复失败：${error && error.message ? error.message : String(error)}`);
	}

	const repaired = repairRestoredPack(target, restoredTo);
	if (!repaired.ok) {
		// 回滚：包退回回收站，绝不留下 id 与目录名不一致的坏包。
		try { renameSync(target, sourceReal); } catch { /* 回滚失败时保留在 packs/ 便于人工处理，但仍报错 */ }
		return fail(500, "pack-invalid", `恢复为「${restoredTo}」后校验失败：${repaired.message}`);
	}
	try { rmSync(join(target, TRASH_META_FILE), { force: true }); } catch { /* 元数据残留不影响包可用性 */ }
	return { ok: true, value: { trashId, id: entry.id, restoredTo, renamed: restoredTo !== entry.id } };
}

/** `trash.purge`（彻底删除，只删 `trash/<trashId>`）。 */
export function purgeTrash(trashId) {
	const idProblem = assertTrashId(trashId);
	if (idProblem) return fail(400, "bad-request", idProblem);
	const target = join(trashDir(), trashId);
	const real = realDirectoryInside(trashDir(), target);
	if (real === null) return fail(404, "trash-not-found", `回收站里找不到条目「${trashId}」`);
	try {
		rmSync(real, { recursive: true, force: true });
	} catch (error) {
		return fail(500, "internal", `彻底删除失败：${error && error.message ? error.message : String(error)}`);
	}
	return { ok: true, value: { trashId, removed: true } };
}
