/**
 * Host-side paths for the skin engine data root.
 * Data lives beside dream-skin's stores but in its own directory:
 *   <DSH_HOME>/profile-data/tavern/data/skin-engine/
 */
import { join } from "node:path";
import { homedir } from "node:os";

export function dshHome() {
	const value = process.env.DSH_HOME;
	return value && value.trim().length > 0 ? value.trim() : join(homedir(), ".dsh");
}

export function skinEngineDataDir() {
	return join(dshHome(), "profile-data", "tavern", "data", "skin-engine");
}

export function statePath() {
	return join(skinEngineDataDir(), "state.json");
}

export function backupsDir() {
	return join(skinEngineDataDir(), "backups");
}

/** 用户导入包根目录：`skin-engine/packs/<id>/`（只读语义，只由 packs.import 写入）。 */
export function packsDir() {
	return join(skinEngineDataDir(), "packs");
}

/** 回收站根目录：`skin-engine/trash/<trashId>/`（删除只进这里，不硬删）。 */
export function trashDir() {
	return join(skinEngineDataDir(), "trash");
}
