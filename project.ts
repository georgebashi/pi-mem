/**
 * Project identity detection.
 * Derives a project slug from git remote or cwd basename.
 */

import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * Normalize a git remote URL to a filesystem-safe slug.
 *
 * Examples:
 *   git@github.com:user/repo.git   → github.com-user-repo
 *   https://github.com/user/repo   → github.com-user-repo
 *   ssh://git@github.com/user/repo → github.com-user-repo
 */
export function normalizeRemoteUrl(url: string): string {
	let normalized = url.trim();

	// Remove .git suffix
	normalized = normalized.replace(/\.git$/, "");

	// Handle SSH format: git@host:user/repo
	const sshMatch = normalized.match(/^[\w.-]+@([\w.-]+):(.+)$/);
	if (sshMatch) {
		normalized = `${sshMatch[1]}/${sshMatch[2]}`;
	} else {
		// Handle protocol-based URLs: https://host/path, ssh://git@host/path
		normalized = normalized.replace(/^[a-zA-Z+]+:\/\//, "");
		// Remove user@ prefix
		normalized = normalized.replace(/^[^@]+@/, "");
	}

	// Replace / and : with -
	normalized = normalized.replace(/[/:]/g, "-");

	// Remove leading/trailing dashes
	normalized = normalized.replace(/^-+|-+$/g, "");

	return normalized;
}

/**
 * Get the project slug for the given working directory.
 * Tries git remote first, falls back to directory basename.
 */
export async function getProjectSlug(cwd: string): Promise<string> {
	try {
		const remote = execSync("git remote get-url origin", {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		}).trim();

		if (remote) {
			return normalizeRemoteUrl(remote);
		}
	} catch {
		// Not a git repo or no remote
	}

	return path.basename(cwd);
}
