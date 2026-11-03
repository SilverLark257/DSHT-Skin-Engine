/**
 * Step 6 宿主侧：回收站（packs.delete / trash.list / trash.restore / trash.purge）。
 *
 * 契约：docs/step6-plan.md §1 / §2.1 —— 删除只进 trash、恢复同名自动后缀并同步改写
 * theme.json.id、彻底删除只删 trash/<trashId>、条目上限 100。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deletePack, getPack, importPack, listTrash, purgeTrash, restoreTrash } from "../lib/host/packs-io.js";
import { validateThemePack } from "../src/shared/pack-schema.js";
import {
	base64OfText,
	folderFiles,
	listDirs,
	listFiles,
	makeTempHome,
	packOf,
	packsRoot,
	trashRoot
} from "./fixtures/step6/helpers.mjs";

function importNoCss(t, id) {
	const files = id === undefined
		? folderFiles("valid-no-css")
		: { "theme.json": base64OfText(JSON.stringify(packOf({ id, name: `包 ${id}` }))) };
	const result = importPack({ source: "folder", files });
	assert.equal(result.ok, true, JSON.stringify(result.error));
	return result.value;
}

/** 手写一个回收站条目（用于「恢复撞内置 id」这类现场无法自然造出的场景）。 */
function craftTrashEntry(trashId, pack) {
	const dir = join(trashRoot(), trashId);
	mkdirSync(join(dir, "assets", "images"), { recursive: true });
	writeFileSync(join(dir, "theme.json"), JSON.stringify(pack, null, 2) + "\n", "utf8");
	writeFileSync(join(dir, "assets", "images", "dot.png"), Buffer.from([137, 80, 78, 71]), "binary");
	writeFileSync(join(dir, ".trash-meta.json"), JSON.stringify({
		trashId,
		id: pack.id,
		name: pack.name,
		nameZh: null,
		deletedAt: "2026-01-01T00:00:00.000Z",
		bytes: 1,
		fileCount: 1,
		source: "user"
	}, null, 2) + "\n", "utf8");
	return dir;
}

test("删除用户包 → 进回收站（不硬删），trash.list 元数据完整", (t) => {
	makeTempHome(t);
	importNoCss(t);
	const removed = deletePack({ id: "fixture-no-css" });
	assert.equal(removed.ok, true, JSON.stringify(removed.error));
	assert.equal(removed.value.id, "fixture-no-css");
	const trashId = removed.value.trashId;
	assert.match(trashId, /^fixture-no-css-\d{8}-\d{6}-\d{3}$/);
	assert.deepEqual(listDirs(packsRoot()), []);
	assert.deepEqual(listFiles(join(trashRoot(), trashId)).sort(), [".trash-meta.json", "theme.json"]);
	const meta = JSON.parse(readFileSync(join(trashRoot(), trashId, ".trash-meta.json"), "utf8"));
	for (const key of ["id", "name", "nameZh", "deletedAt", "bytes", "fileCount", "source"]) {
		assert.equal(Object.hasOwn(meta, key), true, `缺字段 ${key}`);
	}
	assert.equal(meta.id, "fixture-no-css");
	assert.equal(meta.source, "user");

	const listed = listTrash();
	assert.equal(listed.count, 1);
	assert.equal(listed.entries[0].trashId, trashId);
	assert.equal(listed.entries[0].id, "fixture-no-css");
	assert.equal(listed.entries[0].name, "Fixture No CSS");
	assert.equal(listed.entries[0].fileCount, 1);
	assert.equal(listed.entries[0].bytes > 0, true);
	assert.equal(listed.entries[0].deletedAt, meta.deletedAt);
});

test("删除内置包 400 / 删除不存在的包 404 / 参数非法 400", (t) => {
	makeTempHome(t);
	const builtin = deletePack({ id: "cocreate-paper" });
	assert.equal(builtin.ok, false);
	assert.equal(builtin.status, 400);
	assert.equal(builtin.error.code, "builtin-protected");
	const missing = deletePack({ id: "no-such-pack" });
	assert.equal(missing.ok, false);
	assert.equal(missing.status, 404);
	assert.equal(missing.error.code, "pack-not-found");
	assert.equal(deletePack({}).status, 400);
	assert.equal(deletePack({ id: "../evil" }).status, 404);
	assert.deepEqual(listDirs(trashRoot()), []);
});

test("恢复：包回到 packs/<id>，renamed:false，.trash-meta.json 被清理", (t) => {
	makeTempHome(t);
	importNoCss(t);
	const removed = deletePack({ id: "fixture-no-css" });
	const restored = restoreTrash(removed.value.trashId);
	assert.equal(restored.ok, true, JSON.stringify(restored.error));
	assert.deepEqual(restored.value, {
		trashId: removed.value.trashId,
		id: "fixture-no-css",
		restoredTo: "fixture-no-css",
		renamed: false
	});
	assert.deepEqual(listDirs(packsRoot()), ["fixture-no-css"]);
	assert.deepEqual(listDirs(trashRoot()), []);
	assert.deepEqual(listFiles(join(packsRoot(), "fixture-no-css")), ["theme.json"]);
	assert.equal(getPack({ id: "fixture-no-css" }).ok, true);
});

test("恢复撞同名：自动后缀 -2，theme.json.id 同步改写并通过校验", (t) => {
	makeTempHome(t);
	importNoCss(t);
	const removed = deletePack({ id: "fixture-no-css" });
	importNoCss(t); // 新包重新占住 fixture-no-css
	assert.deepEqual(listDirs(packsRoot()), ["fixture-no-css"]);

	const restored = restoreTrash(removed.value.trashId);
	assert.equal(restored.ok, true, JSON.stringify(restored.error));
	assert.equal(restored.value.renamed, true);
	assert.equal(restored.value.id, "fixture-no-css");
	assert.equal(restored.value.restoredTo, "fixture-no-css-2");
	assert.deepEqual(listDirs(packsRoot()), ["fixture-no-css", "fixture-no-css-2"]);
	const stored = JSON.parse(readFileSync(join(packsRoot(), "fixture-no-css-2", "theme.json"), "utf8"));
	assert.equal(stored.id, "fixture-no-css-2");
	assert.equal(validateThemePack(stored).ok, true);
	assert.equal(listFiles(join(packsRoot(), "fixture-no-css-2")).includes(".trash-meta.json"), false);

	const loaded = getPack({ id: "fixture-no-css-2" });
	assert.equal(loaded.ok, true);
	assert.equal(loaded.value.pack.id, "fixture-no-css-2");
});

test("恢复撞内置 id：不覆盖内置包，自动后缀；theme.json.id 同步改写", (t) => {
	makeTempHome(t);
	const trashId = "cocreate-paper-20260101-000000-000";
	craftTrashEntry(trashId, packOf({ id: "cocreate-paper", name: "被删的 cocreate" }));
	const restored = restoreTrash(trashId);
	assert.equal(restored.ok, true, JSON.stringify(restored.error));
	assert.equal(restored.value.restoredTo, "cocreate-paper-2");
	assert.equal(restored.value.renamed, true);
	const stored = JSON.parse(readFileSync(join(packsRoot(), "cocreate-paper-2", "theme.json"), "utf8"));
	assert.equal(stored.id, "cocreate-paper-2");
	assert.equal(validateThemePack(stored).ok, true);
	assert.equal(listFiles(join(trashRoot(), trashId)).length, 0);
});

test("恢复不存在的条目 404 / trashId 非法 400", (t) => {
	makeTempHome(t);
	assert.equal(restoreTrash("nope-20260101-000000-000").status, 404);
	assert.equal(restoreTrash("../evil").status, 400);
	assert.equal(restoreTrash(undefined).status, 400);
	assert.deepEqual(listDirs(packsRoot()), []);
});

test("彻底删除：只删 trash/<trashId>，条目与目录一起消失", (t) => {
	makeTempHome(t);
	importNoCss(t);
	const removed = deletePack({ id: "fixture-no-css" });
	const purged = purgeTrash(removed.value.trashId);
	assert.equal(purged.ok, true);
	assert.deepEqual(purged.value, { trashId: removed.value.trashId, removed: true });
	assert.deepEqual(listDirs(trashRoot()), []);
	assert.equal(listTrash().count, 0);
	assert.equal(purgeTrash(removed.value.trashId).status, 404);
	assert.equal(purgeTrash("../evil").status, 400);
});

test("回收站条目上限 100：满了以后删除返回可读错误且包原样保留", (t) => {
	makeTempHome(t);
	for (let index = 0; index < 100; index++) {
		mkdirSync(join(trashRoot(), `seed-trash-${index}-20260101-000000-000`), { recursive: true });
	}
	importNoCss(t);
	const blocked = deletePack({ id: "fixture-no-css" });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.status, 409);
	assert.equal(blocked.error.code, "trash-full");
	assert.match(blocked.error.message, /回收站已满/);
	assert.deepEqual(listDirs(packsRoot()), ["fixture-no-css"]);
	assert.equal(listFiles(join(packsRoot(), "fixture-no-css")).length, 1);
});

test("恢复时 theme.json 坏掉 → 500 并回滚（条目仍在回收站，不落坏包）", (t) => {
	makeTempHome(t);
	const trashId = "broken-pack-20260101-000000-000";
	const dir = join(trashRoot(), trashId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "theme.json"), "{ not json", "utf8");
	writeFileSync(join(dir, ".trash-meta.json"), JSON.stringify({ id: "broken-pack", name: "Broken", deletedAt: "2026-01-01T00:00:00.000Z", bytes: 1, fileCount: 1, source: "user" }) + "\n", "utf8");
	const restored = restoreTrash(trashId);
	assert.equal(restored.ok, false);
	assert.equal(restored.status, 500);
	assert.equal(restored.error.code, "pack-invalid");
	assert.deepEqual(listDirs(packsRoot()), []);
	assert.deepEqual(listDirs(trashRoot()), [trashId]);
});

test("trash.list 按 deletedAt 倒序；覆盖导入产生的旧包也进回收站", (t) => {
	makeTempHome(t);
	importNoCss(t);
	const firstDelete = deletePack({ id: "fixture-no-css" });
	const changed = { ...packOf({ id: "fixture-no-css" }), name: "第二版" };
	importPack({ source: "folder", files: { "theme.json": base64OfText(JSON.stringify(changed)) } });
	const overwritten = importPack({ source: "folder", files: { "theme.json": base64OfText(JSON.stringify({ ...changed, name: "第三版" })) }, collision: "overwrite" });
	assert.equal(overwritten.ok, true, JSON.stringify(overwritten.error));
	assert.equal(typeof overwritten.value.trashId, "string");
	const entries = listTrash().entries;
	assert.equal(entries.length >= 2, true);
	assert.equal(entries.some((entry) => entry.trashId === firstDelete.value.trashId), true);
	assert.equal(entries.some((entry) => entry.trashId === overwritten.value.trashId), true);
	for (let index = 1; index < entries.length; index++) {
		assert.equal(entries[index - 1].deletedAt >= entries[index].deletedAt, true, "trash.list 必须按 deletedAt 倒序");
	}
});
