/**
 * Tests for project slug normalization.
 * Run with: node --experimental-strip-types project.test.ts
 */

import { normalizeRemoteUrl } from "./project.ts";

const tests: Array<{ input: string; expected: string; label: string }> = [
	// SSH remotes
	{ input: "git@github.com:user/repo.git", expected: "github.com-user-repo", label: "SSH remote with .git" },
	{ input: "git@github.com:user/repo", expected: "github.com-user-repo", label: "SSH remote without .git" },
	{ input: "git@github.com:acme/widget.git", expected: "github.com-acme-widget", label: "SSH remote org/repo" },
	{ input: "git@gitlab.com:org/sub/repo.git", expected: "gitlab.com-org-sub-repo", label: "SSH remote with subgroup" },

	// HTTPS remotes
	{ input: "https://github.com/user/repo", expected: "github.com-user-repo", label: "HTTPS remote" },
	{ input: "https://github.com/user/repo.git", expected: "github.com-user-repo", label: "HTTPS remote with .git" },
	{ input: "https://github.com/acme/widget", expected: "github.com-acme-widget", label: "HTTPS remote org/repo" },

	// SSH protocol URLs
	{ input: "ssh://git@github.com/user/repo.git", expected: "github.com-user-repo", label: "SSH URL with protocol" },

	// Edge cases
	{ input: "https://gitlab.example.com/team/project.git", expected: "gitlab.example.com-team-project", label: "Custom host" },
];

let passed = 0;
let failed = 0;

for (const { input, expected, label } of tests) {
	const actual = normalizeRemoteUrl(input);
	if (actual === expected) {
		console.log(`  ✓ ${label}`);
		passed++;
	} else {
		console.error(`  ✗ ${label}: expected "${expected}", got "${actual}"`);
		failed++;
	}
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
