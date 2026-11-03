// Step 6 — host state store schema v2 (Lead-owned lib/host/store.js).
// Runs against a throwaway DSH_HOME so the real skin-engine data is never touched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home;
let store;
let paths;

before(async () => {
	home = mkdtempSync(join(tmpdir(), "dshte-step6-store-"));
	process.env.DSH_HOME = home;
	store = await import("../lib/host/store.js");
	paths = await import("../lib/host/paths.js");
});

after(() => {
	rmSync(home, { recursive: true, force: true });
});

function fontEntry(id, payload) {
	return {
		id,
		family: `dshte-user-${id}`,
		weight: 400,
		style: "normal",
		fileName: `${id}.woff2`,
		mime: "font/woff2",
		dataUrl: `data:font/woff2;base64,${Buffer.from(payload).toString("base64")}`,
		bytes: Buffer.byteLength(payload)
	};
}

test("v1 state upgrades to v2 with default ui", () => {
	const result = store.sanitizeState({ format: "dshte.state", version: 1, activePackId: "cocreate-paper", enabled: true, overrides: { light: {}, dark: {} } });
	assert.equal(result.ok, true);
	assert.equal(result.state.version, 2);
	assert.deepEqual(result.state.ui, { previewLive: true, userCss: { text: "", savedAt: null }, userFonts: [] });
});

test("v2 ui round-trips userCss + userFonts", () => {
	const input = {
		format: "dshte.state",
		version: 2,
		activePackId: "cocreate-paper",
		enabled: true,
		overrides: { light: { "--dsw-alias-brand-primary": "#7557A8" }, dark: {} },
		ui: {
			previewLive: false,
			userCss: { text: "body { color: red; }", savedAt: "2026-11-03T00:00:00.000Z" },
			userFonts: [fontEntry("uabc", "hello-font")]
		}
	};
	const result = store.sanitizeState(input);
	assert.equal(result.ok, true);
	assert.equal(result.state.ui.previewLive, false);
	assert.equal(result.state.ui.userCss.text, "body { color: red; }");
	assert.equal(result.state.ui.userFonts.length, 1);
	assert.equal(result.state.ui.userFonts[0].bytes, 10);
});

test("ui validation rejects bad font bytes / oversized css / bad font family", () => {
	const base = { format: "dshte.state", version: 2, ui: { previewLive: true, userCss: { text: "" }, userFonts: [] } };
	const badBytes = structuredClone(base);
	badBytes.ui.userFonts = [fontEntry("u1", "abc")];
	badBytes.ui.userFonts[0].bytes = 99;
	assert.equal(store.sanitizeState(badBytes).ok, false);

	const bigCss = structuredClone(base);
	bigCss.ui.userCss.text = "x".repeat(1024 * 1024 + 1);
	assert.equal(store.sanitizeState(bigCss).ok, false);

	const badFamily = structuredClone(base);
	badFamily.ui.userFonts = [fontEntry("u2", "abc")];
	badFamily.ui.userFonts[0].family = "not-a-user-font";
	assert.equal(store.sanitizeState(badFamily).ok, false);
});

test("writeState keeps disk ui unless includeUi:true (small overrides writes cannot wipe fonts/css)", () => {
	mkdirSync(paths.skinEngineDataDir(), { recursive: true });
	const withUi = {
		format: "dshte.state",
		version: 2,
		activePackId: "cocreate-paper",
		enabled: true,
		overrides: { light: {}, dark: {} },
		ui: { previewLive: true, userCss: { text: "/* keep me */", savedAt: "2026-11-03T00:00:00.000Z" }, userFonts: [fontEntry("ukeep", "keep-font")] }
	};
	assert.equal(store.writeState(withUi, { includeUi: true }).ok, true);
	assert.equal(store.readState().state.ui.userCss.text, "/* keep me */");

	// Ordinary override write: no ui in payload → host preserves the disk ui.
	const small = { format: "dshte.state", version: 2, activePackId: "cocreate-paper", enabled: true, overrides: { light: { "--dsw-alias-bg-base": "#EFE8E0" }, dark: {} } };
	assert.equal(store.writeState(small).ok, true);
	const after = store.readState();
	assert.equal(after.ok, true);
	assert.equal(after.state.ui.userCss.text, "/* keep me */");
	assert.equal(after.state.ui.userFonts.length, 1);
	assert.equal(after.state.overrides.light["--dsw-alias-bg-base"], "#EFE8E0");

	// includeUi:true with a changed payload actually replaces it.
	const cleared = structuredClone(withUi);
	cleared.ui = { previewLive: false, userCss: { text: "", savedAt: null }, userFonts: [] };
	assert.equal(store.writeState(cleared, { includeUi: true }).ok, true);
	assert.equal(store.readState().state.ui.userCss.text, "");
	assert.equal(store.readState().state.ui.previewLive, false);
});

test("writeState creates a backup of the previous file and refuses invalid state", () => {
	const before = readdirSync(paths.backupsDir()).length;
	assert.equal(store.writeState({ format: "dshte.state", version: 2, activePackId: "cocreate-paper", overrides: { light: {}, dark: {} } }).ok, true);
	assert.ok(readdirSync(paths.backupsDir()).length >= Math.min(5, before + 1));
	assert.ok(existsSync(paths.statePath()));

	const invalid = store.writeState({ format: "dshte.state", version: 2, overrides: { light: { "not-a-token": "x" }, dark: {} } });
	assert.equal(invalid.ok, false);
	assert.match(invalid.error, /token 名不合法/);

	const raw = JSON.parse(readFileSync(paths.statePath(), "utf8"));
	assert.equal(raw.format, "dshte.state");
	assert.equal(raw.version, 2);
});

test("writeState works when no state file exists yet (fresh host)", () => {
	// Remove the current file to simulate a brand new data root.
	rmSync(paths.statePath(), { force: true });
	const result = store.writeState({
		format: "dshte.state",
		version: 2,
		activePackId: "cocreate-paper",
		enabled: true,
		overrides: { light: {}, dark: {} },
		ui: { previewLive: true, userCss: { text: "css", savedAt: null }, userFonts: [] }
	}, { includeUi: true });
	assert.equal(result.ok, true);
	assert.equal(store.readState().fresh, false);
	assert.equal(store.readState().state.ui.userCss.text, "css");
});

test("state.json is written as v2 and a corrupt file falls back to defaults without throwing", () => {
	writeFileSync(paths.statePath(), "{not json", "utf8");
	const result = store.readState();
	assert.equal(result.ok, false);
	assert.equal(result.state.version, 2);
	assert.deepEqual(result.state.ui.userFonts, []);
});
