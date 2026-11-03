/** Skeleton identity + logging (build replaces __VERSION__ / __MARKER__). */
const VERSION = "__VERSION__";
const MARKER = "__MARKER__";
const TAG = "[dsh-tavern-skin-engine]";

function log() {
	try {
		console.info.apply(console, [TAG].concat(Array.prototype.slice.call(arguments)));
	} catch { /* logging must never break apply */ }
}
