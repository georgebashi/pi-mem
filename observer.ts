/**
 * Observation utilities for pi-mem.
 * Privacy filtering helper.
 */

/**
 * Strip <private>...</private> tags from text, replacing with [REDACTED].
 */
export function stripPrivateTags(text: string): string {
	return text.replace(/<private>[\s\S]*?<\/private>/g, "[REDACTED]");
}
