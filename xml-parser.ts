/**
 * XML parser for observer agent output.
 * Extracts structured observation fields from XML blocks using regex.
 */

import {
	VALID_OBS_TYPES,
	VALID_CONCEPTS,
	DEFAULT_OBS_TYPE,
	type ValidObsType,
	type ValidConcept,
} from "./mode-config.js";

// ─── Types ────────────────────────────────────────────────────

export interface ParsedObservation {
	type: ValidObsType;
	title: string;
	subtitle: string | null;
	facts: string[];
	narrative: string | null;
	concepts: ValidConcept[];
	files_read: string[];
	files_modified: string[];
}

// ─── Parser ───────────────────────────────────────────────────

/**
 * Parse an observation XML block from observer agent output.
 * Returns null if no <observation> block found.
 */
export function parseObservation(text: string): ParsedObservation | null {
	// Match <observation>...</observation> block (non-greedy)
	const obsMatch = /<observation>([\s\S]*?)<\/observation>/.exec(text);
	if (!obsMatch) return null;

	const content = obsMatch[1];

	// Extract type with validation
	const rawType = extractField(content, "type");
	const type = validateObsType(rawType);

	// Extract title (required — but fall back to empty string)
	const title = extractField(content, "title") || "";

	// Skip marker: if title is "skip", return null
	if (title.toLowerCase() === "skip") return null;

	// Extract optional fields
	const subtitle = extractField(content, "subtitle");
	const narrative = extractField(content, "narrative");

	// Extract arrays
	const facts = extractArrayElements(content, "facts", "fact");
	const rawConcepts = extractArrayElements(content, "concepts", "concept");
	const files_read = extractArrayElements(content, "files_read", "file");
	const files_modified = extractArrayElements(content, "files_modified", "file");

	// Validate concepts against taxonomy (drop invalid)
	const validConceptSet = new Set<string>(VALID_CONCEPTS);
	const concepts = rawConcepts.filter((c) => validConceptSet.has(c)) as ValidConcept[];

	return {
		type,
		title,
		subtitle,
		facts,
		narrative,
		concepts,
		files_read,
		files_modified,
	};
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Extract a simple field value from XML content.
 * Returns null for missing or empty/whitespace-only fields.
 */
function extractField(content: string, fieldName: string): string | null {
	const regex = new RegExp(`<${fieldName}>([\\s\\S]*?)</${fieldName}>`);
	const match = regex.exec(content);
	if (!match) return null;

	const trimmed = match[1].trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * Extract array of elements from XML content.
 */
function extractArrayElements(
	content: string,
	arrayName: string,
	elementName: string,
): string[] {
	const elements: string[] = [];

	// Match the array block
	const arrayRegex = new RegExp(`<${arrayName}>([\\s\\S]*?)</${arrayName}>`);
	const arrayMatch = arrayRegex.exec(content);
	if (!arrayMatch) return elements;

	const arrayContent = arrayMatch[1];

	// Extract individual elements
	const elementRegex = new RegExp(
		`<${elementName}>([\\s\\S]*?)</${elementName}>`,
		"g",
	);
	let elementMatch;
	while ((elementMatch = elementRegex.exec(arrayContent)) !== null) {
		const trimmed = elementMatch[1].trim();
		if (trimmed) elements.push(trimmed);
	}

	return elements;
}

/**
 * Validate observation type against fixed taxonomy.
 * Falls back to DEFAULT_OBS_TYPE if unrecognized.
 */
function validateObsType(raw: string | null): ValidObsType {
	if (!raw) return DEFAULT_OBS_TYPE;
	const trimmed = raw.trim().toLowerCase();
	if ((VALID_OBS_TYPES as readonly string[]).includes(trimmed)) {
		return trimmed as ValidObsType;
	}
	return DEFAULT_OBS_TYPE;
}
