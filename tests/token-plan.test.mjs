/**
 * Unit tests for src/shared/token-plan.js — the pure core of the variable layer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	HOST_TOKEN_PREFIXES,
	REQUIRED_HOST_TOKENS,
	buildTokenPlan,
	diffComposedTokens,
	expectedHostValue,
	isEngineToken,
	isHostToken,
	isSafeCssValue,
	normalizeOverrides,
	renderVarsCss
} from "../src/shared/token-plan.js";

const pack = (extra = {}) => ({
	format: "dshte.theme",
	formatVersion: 1,
	id: "plan-pack",
	name: "Plan Pack",
	colorScheme: "light",
	missingScheme: "mirror",
	tokens: {
		light: {
			"--dsw-alias-bg-base": "#EFE8E0",
			"--dsw-alias-brand-primary": "#7557A8",
			"--dshte-fg-body": "#35322C",
			"--dshte-font-sans": "\"PingFang SC\", sans-serif"
		},
		...(extra.tokens || {})
	},
	...(extra.pack || {})
});

test("classification helpers", () => {
	assert.ok(HOST_TOKEN_PREFIXES.includes("--dsw-"));
	assert.equal(isHostToken("--dsw-alias-bg-base"), true);
	assert.equal(isHostToken("--dsh-tavern-accent"), true);
	assert.equal(isHostToken("--dshte-x"), false);
	assert.equal(isEngineToken("--dshte-x"), true);
	assert.equal(isSafeCssValue("#fff"), true);
	assert.equal(isSafeCssValue("#fff; } body{display:none"), false);
	assert.equal(isSafeCssValue("url(https://evil.example/x.png)"), false);
	assert.equal(isSafeCssValue("url(assets/images/x.png)"), true);
});

test("mirror resolves both host modes to the same value", () => {
	const plan = buildTokenPlan(pack());
	assert.equal(plan.policy, "mirror");
	assert.equal(plan.host["--dsw-alias-bg-base"].light, "#EFE8E0");
	assert.equal(plan.host["--dsw-alias-bg-base"].dark, "#EFE8E0");
	assert.equal(plan.engine.light["--dshte-fg-body"], "#35322C");
	assert.equal(plan.engine.dark["--dshte-fg-body"], "#35322C");
	assert.equal(plan.hostTokenCount, 2);
	assert.equal(plan.engineTokenCount, 4);
});

test("a pack with a dark block keeps both modes and dark engine vars", () => {
	const plan = buildTokenPlan(pack({ tokens: { dark: { "--dsw-alias-bg-base": "#101010", "--dshte-fg-body": "#dddddd" } } }));
	assert.equal(plan.host["--dsw-alias-bg-base"].light, "#EFE8E0");
	assert.equal(plan.host["--dsw-alias-bg-base"].dark, "#101010");
	assert.equal(plan.engine.dark["--dshte-fg-body"], "#dddddd");
});

test("user overrides win per scheme", () => {
	const plan = buildTokenPlan(pack(), { overrides: { light: { "--dsw-alias-bg-base": "#111111" }, dark: { "--dsw-alias-bg-base": "#222222" } } });
	assert.equal(plan.host["--dsw-alias-bg-base"].light, "#111111");
	assert.equal(plan.host["--dsw-alias-bg-base"].dark, "#222222");
});

test("inherit policy keeps the layer self-consistent (gating happens in the engine)", () => {
	const plan = buildTokenPlan(pack({ pack: { missingScheme: "inherit" } }), { schemePolicy: "inherit" });
	assert.equal(plan.policy, "inherit");
	assert.equal(plan.host["--dsw-alias-bg-base"].light, "#EFE8E0");
	assert.equal(plan.host["--dsw-alias-bg-base"].dark, "#EFE8E0");
});

test("unsafe values are rejected, never rendered", () => {
	const dirty = pack({ tokens: { light: { "--dsw-alias-bg-base": "#fff; } body{display:none", "--dshte-bad": "url(https://x/y.png)" } } });
	const plan = buildTokenPlan(dirty);
	assert.equal(plan.host["--dsw-alias-bg-base"], undefined);
	assert.equal(plan.engine.light["--dshte-bad"], undefined);
	assert.ok(plan.rejected.some((item) => item.name === "--dsw-alias-bg-base" && item.reason === "unsafe-value"));
	assert.ok(plan.rejected.some((item) => item.name === "--dshte-bad"));
});

test("unknown token prefixes are reported", () => {
	const plan = buildTokenPlan(pack({ tokens: { light: { "--mystery": "1" } } }));
	assert.ok(plan.rejected.some((item) => item.name === "--mystery" && item.reason === "unknown-prefix"));
});

test("renderVarsCss emits :root light vars, dark selector and !important fallback", () => {
	const plan = buildTokenPlan(pack({ tokens: { dark: { "--dsw-alias-bg-base": "#101010", "--dshte-fg-body": "#dddddd" } } }));
	const css = renderVarsCss(plan, { fallback: { light: { "--dsw-alias-bg-base": "#EFE8E0" }, dark: { "--dsw-alias-bg-base": "#101010" } } });
	assert.match(css, /:root \{/);
	assert.match(css, /--dshte-fg-body: #35322C;/);
	assert.match(css, /body\[data-ds-dark-theme\] \{/);
	assert.match(css, /--dsw-alias-bg-base: #EFE8E0 !important;/);
	assert.match(css, /--dsw-alias-bg-base: #101010 !important;/);
});

test("diffComposedTokens compares hex case-insensitively and reports mismatch/missing", () => {
	const plan = buildTokenPlan(pack());
	const values = { "--dsw-alias-bg-base": "#efe8e0", "--dsw-alias-brand-primary": "#000000" };
	const diff = diffComposedTokens(plan, "light", (name) => values[name]);
	assert.equal(diff.mismatched.length, 1);
	assert.equal(diff.mismatched[0].name, "--dsw-alias-brand-primary");
	assert.equal(diff.missing.length, 0);
	assert.equal(expectedHostValue(plan, "dark", "--dsw-alias-bg-base"), "#EFE8E0");
});

test("non-hex expected values are reported as unverifiable, not as conflicts", () => {
	const plan = buildTokenPlan(pack({ tokens: { light: { "--dsw-alias-interactive-bg-hover": "color-mix(in srgb, #7557A8 10%, transparent)" } } }));
	const diff = diffComposedTokens(plan, "light", () => "color-mix(in srgb, #7557A8 10%, transparent)");
	assert.equal(diff.mismatched.length, 0);
	assert.ok(diff.unverifiable.some((item) => item.name === "--dsw-alias-interactive-bg-hover"));
});

test("normalizeOverrides drops unsafe and non-string entries", () => {
	const normalized = normalizeOverrides({ light: { "--dsw-alias-bg-base": "#111", "--dshte-x": 42 }, dark: { "--dshte-y": "url(https://x)" } });
	assert.deepEqual(normalized.light, { "--dsw-alias-bg-base": "#111" });
	assert.deepEqual(normalized.dark, {});
});

test("the 7 required host tokens are exported for diagnostics", () => {
	assert.equal(REQUIRED_HOST_TOKENS.length, 7);
	assert.ok(REQUIRED_HOST_TOKENS.includes("--dsw-alias-bg-base"));
});
