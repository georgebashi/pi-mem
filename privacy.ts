/**
 * Privacy filtering for pi-mem.
 * Loads .pi-mem-ignore patterns and checks file paths.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PI_MEM_DIR } from "./config.js";

/**
 * Load ignore patterns from .pi-mem-ignore files.
 * Checks project root and ~/.pi-mem/ for patterns.
 */
export function loadIgnorePatterns(cwd: string): string[] {
	const patterns: string[] = [];

	const locations = [
		path.join(cwd, ".pi-mem-ignore"),
		path.join(PI_MEM_DIR, ".pi-mem-ignore"),
	];

	for (const loc of locations) {
		try {
			if (fs.existsSync(loc)) {
				const content = fs.readFileSync(loc, "utf-8");
				const lines = content.split("\n")
					.map((l) => l.trim())
					.filter((l) => l && !l.startsWith("#"));
				patterns.push(...lines);
			}
		} catch {
			// Ignore read errors
		}
	}

	return patterns;
}

/**
 * Check if a file path matches any ignore patterns.
 * Uses simple glob-style matching (*.ext, exact names).
 */
export function shouldIgnorePath(filePath: string, patterns: string[]): boolean {
	if (patterns.length === 0) return false;

	const basename = path.basename(filePath);

	for (const pattern of patterns) {
		// Exact match
		if (basename === pattern || filePath === pattern) return true;

		// Glob match: *.ext
		if (pattern.startsWith("*.")) {
			const ext = pattern.slice(1); // ".ext"
			if (basename.endsWith(ext)) return true;
		}

		// Directory match: dir/
		if (pattern.endsWith("/")) {
			const dir = pattern.slice(0, -1);
			if (filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`)) return true;
		}

		// Contains match
		if (filePath.includes(pattern)) return true;
	}

	return false;
}
