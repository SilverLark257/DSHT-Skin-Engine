/**
 * Step 6 宿主侧：dream-skin 主题包兼容映射（src/shared/dreamskin-compat.js）。
 *
 * 契约：docs/step6-plan.md §6（调查报告 §1.2 的格式、7 个必填 token、颜色判定、
 * 目标 id 规范化、生成 v1 包必须通过 validateThemePack）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	IMPORTED_ID_PREFIX,
	isDreamSkinPack,
	looksLikeColor,
	mapDreamSkinPack,
	normalizeImportedId
} from "../src/shared/dreamskin-compat.js";
import { validateThemePack } from "../src/shared/pack-schema.js";
import { REQUIRED_TOKENS, fixtureJson } from "./fixtures/step6/helpers.mjs";

const dreamskin = (manifest, envelope = {}) => ({
	format: "dsh-dream-skin/pack",
	version: 1,
	manifest,
	...envelope
});

const minimalManifest = (overrides = {}) => ({
	id: "demo-min",
	name: "Demo Minimal",
	colorScheme: "dark",
	tokens: { ...REQUIRED_TOKENS },
	...overrides
});

test("最小 dream-skin 包映射成通过 v1 校验的包（light/dark 同值 + preview）", () => {
	const input = fixtureJson("dreamskin-min.json");
	const mapped = mapDreamSkinPack(input);
	assert.equal(mapped.ok, true, JSON.stringify(mapped.errors));
	const pack = mapped.pack;
	assert.equal(pack.format, "dshte.theme");
	assert.equal(pack.formatVersion, 1);
	assert.equal(pack.id, "imported-demo-min");
	assert.equal(pack.colorScheme, "dark");
	assert.equal(pack.missingScheme, "mirror");
	assert.deepEqual(pack.tokens.light, pack.tokens.dark);
	assert.equal(pack.tokens.light["--dsw-alias-bg-base"], "#181715");
	assert.deepEqual(pack.preview, { bg: "#181715", fg: "#faf9f5", accent: "#d4896c" });
	const validation = validateThemePack(pack);
	assert.equal(validation.ok, true, JSON.stringify(validation.errors));

	const report = mapped.report;
	assert.equal(report.sourceId, "demo-min");
	assert.equal(report.sourceName, "Demo Minimal");
	assert.equal(report.targetId, "imported-demo-min");
	assert.equal(report.colorScheme, "dark");
	assert.equal(report.mapped.length, 8); // 7 必填 + --dsh-tavern-accent-soft
	assert.equal(report.dropped.length, 2); // --dshte-sidebar-width（非颜色）+ --dsh-sidebar-width（未知前缀）
	const dropped = new Map(report.dropped.map((item) => [item.token, item.reason]));
	assert.match(dropped.get("--dshte-sidebar-width"), /不是颜色/);
	assert.match(dropped.get("--dsh-sidebar-width"), /未知 token 前缀/);
	assert.equal(report.notes.length > 0, true);
});

test("非颜色 token 与未知前缀 token 都丢弃并写进报告（绝不静默）", () => {
	const mapped = mapDreamSkinPack(dreamskin(minimalManifest({
		tokens: {
			...REQUIRED_TOKENS,
			"--dshte-radius-card": "10px",
			"--dsh-tavern-glass": "blur(12px)",
			"--custom-color": "#123456",
			"--dsw-alias-accent": "hsl(20 40% 50%)"
		}
	})));
	assert.equal(mapped.ok, true, JSON.stringify(mapped.errors));
	const byToken = new Map(mapped.report.dropped.map((item) => [item.token, item]));
	assert.equal(byToken.get("--dshte-radius-card").reason.includes("不是颜色"), true);
	assert.equal(byToken.get("--dsh-tavern-glass").reason.includes("不是颜色"), true);
	assert.equal(byToken.get("--custom-color").reason.includes("未知 token 前缀"), true);
	assert.equal(mapped.report.mapped.some((item) => item.token === "--dsw-alias-accent"), true);
});

test("7 个必填 token 缺一 → 可读错误拒绝", () => {
	const tokens = { ...REQUIRED_TOKENS };
	delete tokens["--dsw-alias-border-l2"];
	const mapped = mapDreamSkinPack(dreamskin(minimalManifest({ tokens })));
	assert.equal(mapped.ok, false);
	assert.equal(mapped.pack, null);
	assert.equal(mapped.errors.some((item) => item.code === "missing-required-token" && item.path.includes("--dsw-alias-border-l2")), true);
});

test("必填 token 的值不是颜色 → 可读错误拒绝", () => {
	const mapped = mapDreamSkinPack(fixtureJson("dreamskin-bad-color.json"));
	assert.equal(mapped.ok, false);
	assert.equal(mapped.errors.some((item) => item.code === "invalid-required-token"), true);
});

test("外壳 format / version 不对 → 拒绝", () => {
	const wrongFormat = mapDreamSkinPack({ ...dreamskin(minimalManifest()), format: "dsh-dream-skin/other" });
	assert.equal(wrongFormat.ok, false);
	assert.equal(wrongFormat.errors.some((item) => item.path === "format"), true);
	const wrongVersion = mapDreamSkinPack({ ...dreamskin(minimalManifest()), version: 2 });
	assert.equal(wrongVersion.ok, false);
	assert.equal(wrongVersion.errors.some((item) => item.path === "version"), true);
	assert.equal(mapDreamSkinPack("not-an-object").ok, false);
	assert.equal(mapDreamSkinPack({ format: "dsh-dream-skin/pack", version: 1 }).ok, false);
});

test("manifest 缺 id / name / colorScheme / tokens → 可读错误", () => {
	const mapped = mapDreamSkinPack(dreamskin({}));
	assert.equal(mapped.ok, false);
	const paths = mapped.errors.map((item) => item.path);
	for (const path of ["manifest.id", "manifest.name", "manifest.colorScheme", "manifest.tokens"]) {
		assert.equal(paths.includes(path), true, `缺少 ${path} 的错误`);
	}
});

test("目标 id 规范化：小写 / 非法字符 → - / 去尾 - / ≤47 / 已有 imported- 不重复加", () => {
	assert.equal(normalizeImportedId("demo-min"), "imported-demo-min");
	assert.equal(normalizeImportedId("My Cool Pack!!"), "imported-my-cool-pack");
	assert.equal(normalizeImportedId("  --Weird__Id--  "), "imported-weird-id");
	assert.equal(normalizeImportedId("imported-already"), "imported-already");
	assert.equal(normalizeImportedId(""), "imported-pack");
	assert.equal(normalizeImportedId("light"), "imported-light");
	const longId = normalizeImportedId("a".repeat(120));
	assert.equal(longId.length <= 47, true);
	assert.match(longId, /^[a-z][a-z0-9-]{2,47}$/);
	assert.equal(longId.startsWith(IMPORTED_ID_PREFIX), true);
});

test("元数据映射：nameZh / author / description / release 来自 manifest 且有默认值", () => {
	const withMeta = mapDreamSkinPack(dreamskin(minimalManifest({
		nameZh: "演示最小包",
		author: "tester",
		description: "映射测试",
		version: "2.1.0",
		accent: "#112233"
	})));
	assert.equal(withMeta.ok, true, JSON.stringify(withMeta.errors));
	assert.equal(withMeta.pack.nameZh, "演示最小包");
	assert.equal(withMeta.pack.author, "tester");
	assert.equal(withMeta.pack.description, "映射测试");
	assert.equal(withMeta.pack.release, "2.1.0");
	assert.equal(withMeta.report.notes.some((note) => note.includes("其余字段") || note.includes("丢弃")), true);

	const bare = mapDreamSkinPack(dreamskin(minimalManifest()));
	assert.equal(bare.pack.author, "anonymous");
	assert.equal(bare.pack.release, "1.0.0");
});

test("looksLikeColor 与 isDreamSkinPack 判定", () => {
	for (const value of ["#fff", "#A1b2C3", "rgb(1,2,3)", "rgba(1,2,3,.5)", "hsl(20 40% 50%)", "hsla(20,40%,50%,.5)"]) {
		assert.equal(looksLikeColor(value), true, value);
	}
	for (const value of ["336px", "red", "#ffff", "#12345", "url(x)", "", "var(--x)", null]) {
		assert.equal(looksLikeColor(value), false, String(value));
	}
	assert.equal(isDreamSkinPack({ format: "dsh-dream-skin/pack" }), true);
	assert.equal(isDreamSkinPack({ manifest: {} }), true);
	assert.equal(isDreamSkinPack({ format: "dshte.bundle" }), false);
});
