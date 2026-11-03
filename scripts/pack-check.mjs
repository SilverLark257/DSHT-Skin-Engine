#!/usr/bin/env node
/**
 * Theme pack CLI checker.
 *
 *   node scripts/pack-check.mjs themes/cocreate-paper
 *   node scripts/pack-check.mjs --bundle some-pack.dshte.json
 *   node scripts/pack-check.mjs themes/cocreate-paper --json
 *   node scripts/pack-check.mjs themes/cocreate-paper --max-pack-bytes 100   # size-limit test
 *
 * Exit code: 0 = no errors (warnings allowed), 1 = errors, 2 = usage/IO error.
 * Prints every issue with its field path + a readable reason — no silent drops.
 */
import { readFile, readdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
import {
	LIMITS,
	parseThemeJson,
	validateThemePack,
	validateFileManifest,
	validateThemeCss
} from "../src/shared/pack-schema.js";
import { parseBundle, formatBytes } from "../src/shared/bundle-format.js";

const argv = process.argv.slice(2);
const flags = { json: false, bundle: null, limits: {} };
const positional = [];
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === "--json") flags.json = true;
	else if (arg === "--bundle") flags.bundle = argv[++i];
	else if (arg === "--max-pack-bytes") flags.limits.packBytes = Number(argv[++i]);
	else if (arg === "--max-file-bytes") flags.limits.fileBytes = Number(argv[++i]);
	else if (arg === "--max-css-bytes") flags.limits.cssBytes = Number(argv[++i]);
	else if (arg.startsWith("-")) { usage(`unknown option: ${arg}`); }
	else positional.push(arg);
}

function usage(message) {
	if (message) console.error(`pack-check: ${message}`);
	console.error("usage: node scripts/pack-check.mjs <pack-dir> [--json] [--max-pack-bytes N] [--max-file-bytes N] [--max-css-bytes N]");
	console.error("       node scripts/pack-check.mjs --bundle <file.dshte.json> [--json]");
	process.exit(2);
}

const out = { mode: null, target: null, ok: false, errors: [], warnings: [], stats: null, pack: null };

function emit() {
	if (flags.json) {
		console.log(JSON.stringify(out, null, 2));
		return;
	}
	const lines = [];
	if (out.pack) lines.push(`pack: ${out.pack.id} — ${out.pack.nameZh || out.pack.name} (release ${out.pack.release || "1.0.0"}, ${out.pack.colorScheme})`);
	if (out.stats) lines.push(`stats: ${JSON.stringify(out.stats)}`);
	if (out.errors.length) {
		lines.push(`errors (${out.errors.length}):`);
		for (const item of out.errors) lines.push(`  ✗ ${item.path}  [${item.code}]  ${item.message}`);
	}
	if (out.warnings.length) {
		lines.push(`warnings (${out.warnings.length}):`);
		for (const item of out.warnings) lines.push(`  ! ${item.path}  [${item.code}]  ${item.message}`);
	}
	lines.push(out.ok ? "RESULT: OK" : "RESULT: FAILED");
	console.log(lines.join("\n"));
}

async function walkFiles(root) {
	const files = [];
	const visit = async (dir) => {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name.startsWith(".")) continue; // generated guard/status files never belong to a pack
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await visit(full);
			else if (entry.isFile()) {
				const info = await stat(full);
				files.push({ path: path.relative(root, full).split(path.sep).join("/"), size: info.size, full });
			}
		}
	};
	await visit(root);
	// theme.json is the manifest itself, not a payload file for the pack-size budget;
	// keep it in the list (it is part of the pack) but note the CLI reports it.
	return files;
}

async function checkDirectory(directory) {
	const root = await realpath(directory);
	const errors = [];
	const warnings = [];
	const themePath = path.join(root, "theme.json");
	let themeText;
	try { themeText = await readFile(themePath, "utf8"); }
	catch { out.errors = [{ path: "theme.json", code: "missing-manifest", message: `找不到 ${themePath}` }]; out.ok = false; return; }

	const parsed = parseThemeJson(themeText);
	if (!parsed.ok) { out.errors = parsed.errors; out.ok = false; return; }
	const result = validateThemePack(parsed.pack, { engineVersion: undefined });
	errors.push(...result.errors);
	warnings.push(...result.warnings);
	out.pack = parsed.pack;

	const files = await walkFiles(root);
	const manifest = files.map((file) => ({ path: file.path, size: file.size }));
	const limits = { ...LIMITS, ...flags.limits };
	const fileResult = validateFileManifest(manifest, { limits });
	errors.push(...fileResult.errors);
	warnings.push(...fileResult.warnings);
	// undeclared root files worth mentioning (not fatal)
	const declared = new Set(["theme.json"]);
	if (typeof parsed.pack.css === "string") declared.add(parsed.pack.css);
	if (parsed.pack.assets && typeof parsed.pack.assets.preview === "string") declared.add(parsed.pack.assets.preview);
	for (const font of parsed.pack.typography?.fonts || []) if (font && typeof font.file === "string") declared.add(font.file);
	for (const file of files) {
		if (!declared.has(file.path) && !file.path.startsWith("assets/") && !["README.md", "LICENSE", "preview.png"].includes(file.path)) {
			warnings.push({ path: `files["${file.path}"]`, code: "undeclared-file", message: `文件「${file.path}」没有被 theme.json 引用，会被当作额外资源（不阻止装载）` });
		}
	}

	if (typeof parsed.pack.css === "string") {
		const cssFile = files.find((file) => file.path === parsed.pack.css);
		if (cssFile) {
			try {
				const cssText = await readFile(cssFile.full, "utf8");
				const cssResult = validateThemeCss(cssText, { filename: parsed.pack.css, limits });
				errors.push(...cssResult.errors);
				warnings.push(...cssResult.warnings);
			} catch (error) {
				errors.push({ path: parsed.pack.css, code: "io", message: `读取 CSS 失败：${error.message}` });
			}
		}
	}

	out.mode = "directory";
	out.target = root;
	out.errors = errors;
	out.warnings = warnings;
	out.stats = { files: files.length, bytes: manifest.reduce((total, file) => total + file.size, 0), pack: result.stats };
	out.ok = errors.length === 0;
}

async function checkBundle(file) {
	const errors = [];
	const warnings = [];
	let text;
	try { text = await readFile(file, "utf8"); }
	catch { out.errors = [{ path: file, code: "io", message: `读取 bundle 失败：${file}` }]; out.ok = false; return; }
	const result = parseBundle(text, { limits: flags.limits });
	errors.push(...result.errors);
	warnings.push(...result.warnings);
	out.mode = "bundle";
	out.target = path.resolve(file);
	out.pack = result.pack;
	out.stats = result.stats;
	out.errors = errors;
	out.warnings = warnings;
	out.ok = errors.length === 0;
}

if (flags.bundle) {
	if (positional.length) usage("--bundle 不能与 pack 目录同时使用");
	await checkBundle(flags.bundle);
} else {
	const directory = positional[0];
	if (!directory) usage("缺少主题包目录");
	await checkDirectory(directory);
}
emit();
process.exit(out.ok ? 0 : 1);
