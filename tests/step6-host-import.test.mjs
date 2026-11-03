/**
 * Step 6 宿主侧：packs.import / packs.export / packs.list / packs.get。
 *
 * 契约：docs/step6-plan.md §1 / §2.2 / §2.3 / §6 —— 三种导入来源、失败不落盘、
 * 自定义 CSS 确认、内置保护、冲突策略、上限、往返一致性。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	IMPORT_MAX_BUNDLE_BYTES,
	MAX_BODY_BYTES,
	PACK_COUNT_MAX,
	diagCaps,
	exportPack,
	getPack,
	importPack,
	packsList
} from "../lib/host/packs-io.js";
import { parseBundle } from "../src/shared/bundle-format.js";
import { validateThemePack } from "../src/shared/pack-schema.js";
import {
	base64OfText,
	fixtureJson,
	fixtureText,
	folderFiles,
	listDirs,
	listFiles,
	makeTempHome,
	packOf,
	packsRoot,
	trashRoot
} from "./fixtures/step6/helpers.mjs";

const basicFiles = () => folderFiles("valid-basic");
const noCssFiles = () => folderFiles("valid-no-css");

function snapshotDisk() {
	return { packs: listFiles(packsRoot()), trash: listFiles(trashRoot()), packDirs: listDirs(packsRoot()), trashDirs: listDirs(trashRoot()) };
}

function assertDiskUnchanged(t, fn) {
	const before = snapshotDisk();
	const result = fn();
	assert.equal(result.ok, false, "期望被拒绝，但导入成功了");
	assert.equal(result.status, 400, JSON.stringify(result.error));
	assert.equal(typeof result.error.message, "string");
	assert.equal(result.error.message.length > 0, true);
	assert.deepEqual(snapshotDisk(), before, "失败导入不允许在 packs/ 或 trash/ 留下任何文件");
	return result;
}

const readStoredPack = (id) => JSON.parse(readFileSync(join(packsRoot(), id, "theme.json"), "utf8"));

test("diag.caps 常量与契约 §2.1 / §2.3 一致", () => {
	assert.deepEqual(diagCaps(), {
		apiMaxBodyBytes: 48 * 1024 * 1024,
		importMaxBundleBytes: 24 * 1024 * 1024,
		packMaxBytes: 16 * 1024 * 1024,
		fileMaxBytes: 8 * 1024 * 1024,
		packCountMax: 100,
		trashCountMax: 100
	});
	assert.equal(MAX_BODY_BYTES, 48 * 1024 * 1024);
	assert.equal(IMPORT_MAX_BUNDLE_BYTES, 24 * 1024 * 1024);
	assert.equal(PACK_COUNT_MAX, 100);
});

test("folder 导入成功：目录名 = theme.json 的 id，CSS 与资源都落盘", (t) => {
	makeTempHome(t);
	const result = importPack({ source: "folder", files: basicFiles(), confirmCustomCss: true });
	assert.equal(result.ok, true, JSON.stringify(result.error));
	assert.equal(result.status, 200);
	assert.equal(result.value.id, "fixture-basic");
	assert.equal(result.value.collision, "none");
	assert.equal(result.value.source, "folder");
	assert.equal(result.value.pack.id, "fixture-basic");
	assert.equal(result.value.pack.nameZh, "夹具基础包");
	assert.equal(result.value.stats.fileCount, 3);
	assert.equal(result.value.stats.assetCount, 1);
	assert.equal(result.value.stats.bytes > 0, true);
	assert.equal(result.value.report, null);

	assert.deepEqual(listFiles(join(packsRoot(), "fixture-basic")), [
		"assets/images/dot.png",
		"theme.css",
		"theme.json"
	]);
	const stored = readStoredPack("fixture-basic");
	assert.equal(validateThemePack(stored).ok, true);
	assert.deepEqual(stored.tokens, fixtureJson("valid-basic/theme.json").tokens);
	const png = readFileSync(join(packsRoot(), "fixture-basic", "assets", "images", "dot.png"));
	assert.equal(png.length, 70);
});

test("含 theme.css 但未确认 → 400 needs-confirmation 且不落盘", (t) => {
	makeTempHome(t);
	const result = assertDiskUnchanged(t, () => importPack({ source: "folder", files: basicFiles() }));
	assert.equal(result.error.code, "needs-confirmation");
	assert.equal(result.error.details[0].code, "contains-custom-css");
});

test("内置 id 冲突：overwrite 永久禁止；reject / rename / 缺省都自动另存 <id>-2", (t) => {
	makeTempHome(t);
	const cocreate = { ...fixtureJson("valid-no-css/theme.json"), id: "cocreate-paper" };
	const files = { "theme.json": base64OfText(JSON.stringify(cocreate)) };

	const blocked = importPack({ source: "folder", files, collision: "overwrite" });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.status, 400);
	assert.equal(blocked.error.code, "builtin-protected");
	assert.deepEqual(listDirs(packsRoot()), []);

	const auto = importPack({ source: "folder", files, collision: "reject" });
	assert.equal(auto.ok, true, JSON.stringify(auto.error));
	assert.equal(auto.value.id, "cocreate-paper-2");
	assert.equal(auto.value.collision, "renamed");
	assert.equal(auto.value.renamedFrom, "cocreate-paper");
	assert.equal(readStoredPack("cocreate-paper-2").id, "cocreate-paper-2");
	assert.equal(validateThemePack(readStoredPack("cocreate-paper-2")).ok, true);
	assert.deepEqual(listDirs(packsRoot()), ["cocreate-paper-2"]);

	const defaultCollision = importPack({ source: "folder", files });
	assert.equal(defaultCollision.ok, true, JSON.stringify(defaultCollision.error));
	assert.equal(defaultCollision.value.id, "cocreate-paper-3");
});

test("用户包冲突：缺省/reject → 409；rename → -2；overwrite → 旧包进 trash 且内容换新", (t) => {
	makeTempHome(t);
	assert.equal(importPack({ source: "folder", files: noCssFiles() }).value.id, "fixture-no-css");
	const before = snapshotDisk();

	const conflict = importPack({ source: "folder", files: noCssFiles() });
	assert.equal(conflict.ok, false);
	assert.equal(conflict.status, 409);
	assert.equal(conflict.error.code, "conflict");
	assert.deepEqual(snapshotDisk(), before);

	const renamed = importPack({ source: "folder", files: noCssFiles(), collision: "rename" });
	assert.equal(renamed.ok, true, JSON.stringify(renamed.error));
	assert.equal(renamed.value.id, "fixture-no-css-2");
	assert.equal(renamed.value.collision, "renamed");
	assert.equal(renamed.value.renamedFrom, "fixture-no-css");

	const changed = { ...fixtureJson("valid-no-css/theme.json"), name: "Overwritten Name" };
	const overwritten = importPack({
		source: "folder",
		files: { "theme.json": base64OfText(JSON.stringify(changed)) },
		collision: "overwrite"
	});
	assert.equal(overwritten.ok, true, JSON.stringify(overwritten.error));
	assert.equal(overwritten.value.id, "fixture-no-css");
	assert.equal(overwritten.value.collision, "overwritten");
	assert.equal(typeof overwritten.value.trashId, "string");
	assert.equal(readStoredPack("fixture-no-css").name, "Overwritten Name");
	assert.deepEqual(listDirs(trashRoot()), [overwritten.value.trashId]);
	assert.equal(listDirs(packsRoot()).includes("fixture-no-css-2"), true);
});

test("导出→bundle 再导入：token 与资源逐项一致（往返硬指标）", (t) => {
	makeTempHome(t);
	const first = importPack({ source: "folder", files: basicFiles(), confirmCustomCss: true });
	assert.equal(first.ok, true, JSON.stringify(first.error));

	const exported = exportPack({ id: "fixture-basic" });
	assert.equal(exported.ok, true, JSON.stringify(exported.error));
	assert.equal(exported.value.fileName, "fixture-basic-2.3.4.dshte.json");
	assert.equal(exported.value.bytes > 0, true);
	assert.equal(exported.value.fileCount, 2);
	const bundle = exported.value.bundle;
	assert.equal(bundle.format, "dshte.bundle");
	assert.equal(bundle.formatVersion, 1);
	assert.equal(bundle.files["theme.json"], undefined);
	assert.equal(typeof bundle.files["theme.css"], "string");
	assert.match(bundle.files["assets/images/dot.png"], /^data:image\/png;base64,/);
	assert.equal(parseBundle(bundle).ok, true);

	const second = importPack({ source: "bundle", bundle, collision: "rename", confirmCustomCss: true });
	assert.equal(second.ok, true, JSON.stringify(second.error));
	assert.equal(second.value.id, "fixture-basic-2");
	assert.deepEqual(readStoredPack("fixture-basic-2").tokens, readStoredPack("fixture-basic").tokens);
	assert.deepEqual(
		readFileSync(join(packsRoot(), "fixture-basic-2", "assets", "images", "dot.png")),
		readFileSync(join(packsRoot(), "fixture-basic", "assets", "images", "dot.png"))
	);
	assert.equal(
		readFileSync(join(packsRoot(), "fixture-basic-2", "theme.css"), "utf8"),
		fixtureText("valid-basic/theme.css")
	);
});

test("内置包导出→导入（验收 A）：得到 cocreate-paper-2，pack.id 与目录名一致", (t) => {
	makeTempHome(t);
	const exported = exportPack({ id: "cocreate-paper" });
	assert.equal(exported.ok, true, JSON.stringify(exported.error));
	assert.equal(exported.value.fileName, "cocreate-paper-1.0.0.dshte.json");
	assert.equal(exported.value.fileCount, Object.keys(exported.value.bundle.files).length);
	assert.equal(exported.value.fileCount >= 1, true);
	assert.equal(typeof exported.value.bundle.files["theme.css"], "string");

	const imported = importPack({ source: "bundle", bundle: exported.value.bundle, confirmCustomCss: true });
	assert.equal(imported.ok, true, JSON.stringify(imported.error));
	assert.equal(imported.value.id, "cocreate-paper-2");
	assert.equal(imported.value.collision, "renamed");
	assert.equal(imported.value.renamedFrom, "cocreate-paper");
	assert.equal(readStoredPack("cocreate-paper-2").id, "cocreate-paper-2");
	assert.equal(validateThemePack(readStoredPack("cocreate-paper-2")).ok, true);
	assert.deepEqual(
		readStoredPack("cocreate-paper-2").tokens,
		exported.value.bundle.pack.tokens
	);
	// 再导一次 → cocreate-paper-3；导出文件名用最终 id。
	const again = importPack({ source: "bundle", bundle: exported.value.bundle, confirmCustomCss: true });
	assert.equal(again.value.id, "cocreate-paper-3");
	assert.equal(exportPack({ id: "cocreate-paper-3" }).value.fileName, "cocreate-paper-3-1.0.0.dshte.json");
});

test("dreamskin 导入：imported-* 目标 id + 映射报告 + 落盘包 token = 源颜色", (t) => {
	makeTempHome(t);
	const json = fixtureJson("dreamskin-min.json");
	const result = importPack({ source: "dreamskin", json });
	assert.equal(result.ok, true, JSON.stringify(result.error));
	assert.equal(result.value.id, "imported-demo-min");
	assert.equal(result.value.collision, "none");
	assert.equal(result.value.source, "dreamskin");
	assert.equal(result.value.report.targetId, "imported-demo-min");
	assert.equal(result.value.report.mapped.length, 8);
	assert.equal(result.value.report.dropped.length, 2);

	const loaded = getPack({ id: "imported-demo-min" });
	assert.equal(loaded.ok, true, JSON.stringify(loaded.error));
	assert.equal(loaded.value.source, "user");
	assert.equal(loaded.value.builtin, false);
	assert.equal(loaded.value.css, null);
	assert.equal(loaded.value.pack.tokens.light["--dsw-alias-bg-base"], "#181715");
	assert.deepEqual(loaded.value.pack.tokens.light, loaded.value.pack.tokens.dark);

	const conflict = importPack({ source: "dreamskin", json });
	assert.equal(conflict.ok, false);
	assert.equal(conflict.status, 409);
	const renamed = importPack({ source: "dreamskin", json, collision: "rename" });
	assert.equal(renamed.value.id, "imported-demo-min-2");

	const broken = importPack({ source: "dreamskin", json: fixtureJson("dreamskin-missing-token.json") });
	assert.equal(broken.ok, false);
	assert.equal(broken.status, 400);
	assert.equal(broken.error.code, "invalid-dreamskin");
});

test("5 类坏样本全部 400 + 可读拒绝，且 packs/ 与 trash/ 无新增", (t) => {
	makeTempHome(t);

	const truncated = assertDiskUnchanged(t, () => importPack({
		source: "folder",
		files: { "theme.json": base64OfText(fixtureText("bad-truncated-theme.json")) }
	}));
	assert.equal(truncated.error.code, "invalid-pack");
	assert.match(truncated.error.message, /JSON/);

	const badToken = assertDiskUnchanged(t, () => importPack({ source: "folder", files: folderFiles("bad-token-value") }));
	assert.equal(badToken.error.details[0].code, "unsafe-value");

	const layout = assertDiskUnchanged(t, () => importPack({ source: "folder", files: folderFiles("bad-layout-region") }));
	assert.equal(layout.error.details.some((item) => item.code === "layout-forbidden"), true);

	const traversalFiles = assertDiskUnchanged(t, () => importPack({
		source: "folder",
		files: { ...noCssFiles(), "../evil.txt": base64OfText("boom") }
	}));
	assert.equal(traversalFiles.error.details.some((item) => item.code === "unsafe-path"), true);

	const traversalBundle = assertDiskUnchanged(t, () => importPack({
		source: "bundle",
		bundle: fixtureJson("bad-traversal-bundle.json")
	}));
	assert.equal(traversalBundle.error.details.some((item) => item.code === "unsafe-path"), true);

	// 超 16 MB / 超单文件：用 limits 注入小上限，避免测试生成 17 MB 数据（契约 §7）
	const packTooLarge = assertDiskUnchanged(t, () => importPack({ source: "folder", files: noCssFiles() }, { limits: { packBytes: 100 } }));
	assert.equal(packTooLarge.error.code, "pack-too-large");
	const fileTooLarge = assertDiskUnchanged(t, () => importPack({ source: "folder", files: basicFiles(), confirmCustomCss: true }, { limits: { fileBytes: 10 } }));
	assert.equal(fileTooLarge.error.details.some((item) => item.code === "file-too-large"), true);
	const tooManyFiles = assertDiskUnchanged(t, () => importPack({ source: "folder", files: basicFiles(), confirmCustomCss: true }, { limits: { fileCount: 2 } }));
	assert.equal(tooManyFiles.error.code, "too-many-files");
	const bundleTooLarge = assertDiskUnchanged(t, () => importPack({
		source: "bundle",
		bundle: { format: "dshte.bundle", formatVersion: 1, pack: packOf(), files: {} }
	}, { maxBundleBytes: 10 }));
	assert.equal(bundleTooLarge.error.code, "bundle-too-large");
	const bundlePackTooLarge = assertDiskUnchanged(t, () => importPack({
		source: "bundle",
		bundle: {
			format: "dshte.bundle",
			formatVersion: 1,
			pack: packOf(),
			files: { "assets/images/big.png": `data:image/png;base64,${Buffer.alloc(200, 7).toString("base64")}` }
		}
	}, { limits: { packBytes: 100 } }));
	assert.equal(bundlePackTooLarge.error.code, "pack-too-large");

	// assets.preview 路径穿越（JSON 通道）
	const previewTraversal = assertDiskUnchanged(t, () => importPack({
		source: "folder",
		files: { "theme.json": base64OfText(JSON.stringify(packOf({ assets: { preview: "../evil.png" } }))) }
	}));
	assert.equal(previewTraversal.error.details.some((item) => item.code === "unsafe-path"), true);
});

test("folder base64 非法 / 带 data: 前缀 / 非对象参数 → 400 可读错误", (t) => {
	makeTempHome(t);
	const bad = assertDiskUnchanged(t, () => importPack({ source: "folder", files: { "theme.json": "!!!not-base64!!!" } }));
	assert.equal(bad.error.details.some((item) => item.code === "base64"), true);

	const dataUrl = assertDiskUnchanged(t, () => importPack({
		source: "folder",
		files: { "theme.json": "data:application/json;base64,eyJmb3JtYXQiOiJkc2h0ZS50aGVtZSJ9" }
	}));
	assert.equal(dataUrl.error.details.some((item) => item.code === "base64"), true);

	for (const args of [
		{ source: "nope", files: {} },
		{ source: "folder", files: {} },
		{ source: "folder", files: noCssFiles(), collision: "explode" },
		null
	]) {
		const result = importPack(args);
		assert.equal(result.ok, false);
		assert.equal(result.status, 400);
		assert.equal(result.error.code, "bad-request");
	}
});

test("未声明的 theme.css：导入成功但给出 theme-css-undeclared 警告", (t) => {
	makeTempHome(t);
	const result = importPack({
		source: "folder",
		files: folderFiles("valid-no-css", { "theme.css": "body { color: red; }\n" }),
		confirmCustomCss: true
	});
	assert.equal(result.ok, true, JSON.stringify(result.error));
	assert.equal(result.value.warnings.some((item) => item.code === "theme-css-undeclared"), true);
});

test("packs.list / packs.get 形状 + 内置元数据 + 404 / 400", (t) => {
	makeTempHome(t);
	importPack({ source: "folder", files: noCssFiles() });
	const listed = packsList();
	assert.equal(listed.ok, true);
	const value = listed.value;
	assert.deepEqual(Object.keys(value.counts).sort(), ["builtin", "total", "trash", "user"]);
	assert.deepEqual(value.counts, { builtin: 1, user: 1, trash: 0, total: 2 });
	assert.deepEqual(value.limits, {
		packCount: 100,
		packBytes: 16 * 1024 * 1024,
		fileBytes: 8 * 1024 * 1024
	});

	const builtinMeta = value.builtin[0];
	assert.equal(builtinMeta.id, "cocreate-paper");
	assert.equal(builtinMeta.source, "builtin");
	assert.equal(typeof builtinMeta.description, "string");
	assert.equal(typeof builtinMeta.author, "object");
	assert.equal(builtinMeta.release, "1.0.0");

	const userMeta = value.user[0];
	assert.equal(userMeta.id, "fixture-no-css");
	assert.equal(userMeta.source, "user");
	assert.equal(userMeta.fileCount, 1);
	assert.equal(userMeta.bytes > 0, true);
	assert.match(userMeta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

	const builtin = getPack({ id: "cocreate-paper" });
	assert.equal(builtin.ok, true);
	assert.equal(builtin.value.builtin, true);
	assert.equal(builtin.value.source, "builtin");
	assert.equal(typeof builtin.value.css, "string");
	assert.equal(builtin.value.pack.id, "cocreate-paper");

	const user = getPack({ id: "fixture-no-css" });
	assert.equal(user.ok, true);
	assert.equal(user.value.builtin, false);
	assert.equal(user.value.source, "user");
	assert.equal(user.value.css, null);
	assert.equal(user.value.pack.id, "fixture-no-css");

	const missing = getPack({ id: "no-such-pack" });
	assert.equal(missing.ok, false);
	assert.equal(missing.status, 404);
	assert.equal(missing.error.code, "pack-not-found");
	assert.equal(getPack({}).status, 400);
});

test("数量上限：用户包已达 100 个时新导入被拒；覆盖已有包仍然允许", (t) => {
	makeTempHome(t);
	for (let index = 0; index < PACK_COUNT_MAX; index++) {
		const id = `seed-pack-${index}`;
		const dir = join(packsRoot(), id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "theme.json"), JSON.stringify(packOf({ id }), null, 2) + "\n", "utf8");
	}
	const before = snapshotDisk();
	const rejected = importPack({ source: "folder", files: noCssFiles() });
	assert.equal(rejected.ok, false);
	assert.equal(rejected.status, 400);
	assert.equal(rejected.error.code, "pack-limit-reached");
	assert.deepEqual(snapshotDisk(), before);

	const overwrite = importPack({
		source: "folder",
		files: { "theme.json": base64OfText(JSON.stringify({ ...packOf({ id: "seed-pack-5" }), name: "Seed Overwritten" })) },
		collision: "overwrite"
	});
	assert.equal(overwrite.ok, true, JSON.stringify(overwrite.error));
	assert.equal(overwrite.value.id, "seed-pack-5");
	assert.equal(readStoredPack("seed-pack-5").name, "Seed Overwritten");
	assert.equal(listDirs(packsRoot()).length, PACK_COUNT_MAX);
});

test("用户包目录名与 theme.json.id 不一致 → packs.get 500，list 跳过坏包", (t) => {
	makeTempHome(t);
	const dir = join(packsRoot(), "wrong-dir-id");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "theme.json"), JSON.stringify(packOf({ id: "other-pack-id" }), null, 2) + "\n", "utf8");
	const loaded = getPack({ id: "wrong-dir-id" });
	assert.equal(loaded.ok, false);
	assert.equal(loaded.status, 500);
	assert.equal(loaded.error.code, "pack-invalid");
	assert.match(loaded.error.message, /目录名/);
	assert.equal(packsList().value.counts.user, 0);
});

test("导出不存在的包 → 404；内置包导出允许", (t) => {
	makeTempHome(t);
	const missing = exportPack({ id: "no-such-pack" });
	assert.equal(missing.ok, false);
	assert.equal(missing.status, 404);
	const builtin = exportPack({ id: "cocreate-paper" });
	assert.equal(builtin.ok, true);
	assert.deepEqual(Object.keys(builtin.value).sort(), ["bundle", "bytes", "fileCount", "fileName"]);
});
