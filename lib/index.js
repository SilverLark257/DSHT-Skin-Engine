/**
 * dsh-tavern-skin-engine — host half.
 *
 * Routes:
 *   GET  /dsh-tavern-skin/ping   diagnostic (no secrets)
 *   POST /dsh-tavern-skin/api    fenced JSON API for state.json + built-in packs
 *   GET  /dsh-tavern-skin/assets static pack assets (fonts/images, Range/ETag)
 *
 * Constraints (方案 §7.1): no writes outside the plugin's own data root, no
 * credentials, no touching dream-skin / Tavern / runtime files.
 */
import { readFileSync } from "node:fs";
import { registerApi } from "./host/api.js";
import { registerAssets, ASSETS_ROUTE } from "./host/assets.js";
import { statePath } from "./host/paths.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const name = "dsh-tavern-skin-engine";
export const inject = ["webServer"];

const PING_ROUTE = "/dsh-tavern-skin/ping";

function sendJson(res, status, value) {
	const body = Buffer.from(JSON.stringify(value));
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.length,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(body);
}

export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: PING_ROUTE,
		handler(req, res) {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405, { allow: "GET, HEAD", "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
				return;
			}
			sendJson(res, 200, {
				ok: true,
				plugin: pkg.name,
				version: pkg.version,
				pid: process.pid,
				state: statePath(),
				ts: new Date().toISOString()
			});
		}
	}), "dsh-tavern-skin-engine: /dsh-tavern-skin/ping");

	registerApi(ctx);
	registerAssets(ctx);

	console.info(`[dsh-tavern-skin-engine] host apply v${pkg.version} (routes ${PING_ROUTE}, /dsh-tavern-skin/api, ${ASSETS_ROUTE})`);
}
