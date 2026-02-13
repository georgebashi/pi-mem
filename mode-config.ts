/**
 * Mode configuration for pi-mem observer agent.
 * Defines observation types, concept categories, and prompt templates.
 */

// ─── Types ────────────────────────────────────────────────────

export interface ObservationType {
	id: string;
	label: string;
	description: string;
}

export interface ObservationConcept {
	id: string;
	label: string;
	description: string;
}

export interface ModePrompts {
	system_identity: string;
	observer_role: string;
	recording_focus: string;
	skip_guidance: string;
	type_guidance: string;
	concept_guidance: string;
	field_guidance: string;
	xml_format: string;
	footer: string;
}

export interface ModeConfig {
	name: string;
	observation_types: ObservationType[];
	observation_concepts: ObservationConcept[];
	prompts: ModePrompts;
}

// ─── Taxonomy Constants ───────────────────────────────────────

export const VALID_OBS_TYPES = [
	"bugfix",
	"feature",
	"refactor",
	"change",
	"discovery",
	"decision",
] as const;

export type ValidObsType = (typeof VALID_OBS_TYPES)[number];

export const VALID_CONCEPTS = [
	"how-it-works",
	"why-it-exists",
	"what-changed",
	"problem-solution",
	"gotcha",
	"pattern",
	"trade-off",
] as const;

export type ValidConcept = (typeof VALID_CONCEPTS)[number];

export const DEFAULT_OBS_TYPE: ValidObsType = "change";

// ─── Code Mode Configuration ─────────────────────────────────

export const CODE_MODE: ModeConfig = {
	name: "Code Development",
	observation_types: [
		{ id: "bugfix", label: "Bug Fix", description: "Something was broken, now fixed" },
		{ id: "feature", label: "Feature", description: "New capability or functionality added" },
		{ id: "refactor", label: "Refactor", description: "Code restructured, behavior unchanged" },
		{ id: "change", label: "Change", description: "Generic modification (docs, config, misc)" },
		{ id: "discovery", label: "Discovery", description: "Learning about existing system" },
		{ id: "decision", label: "Decision", description: "Architectural/design choice with rationale" },
	],
	observation_concepts: [
		{ id: "how-it-works", label: "How It Works", description: "Understanding mechanisms" },
		{ id: "why-it-exists", label: "Why It Exists", description: "Purpose or rationale" },
		{ id: "what-changed", label: "What Changed", description: "Modifications made" },
		{ id: "problem-solution", label: "Problem-Solution", description: "Issues and their fixes" },
		{ id: "gotcha", label: "Gotcha", description: "Traps or edge cases" },
		{ id: "pattern", label: "Pattern", description: "Reusable approach" },
		{ id: "trade-off", label: "Trade-Off", description: "Pros/cons of a decision" },
	],
	prompts: {
		system_identity: `You are a memory observer agent. You watch tool executions from a coding session and produce structured observations for future recall.

CRITICAL: Record what was LEARNED/BUILT/FIXED/DEPLOYED/CONFIGURED, not what you are doing.
You do not have access to tools. All information is provided in <observed_from_primary_session> messages.`,

		observer_role: `Your job is to observe a tool execution and extract a structured observation capturing what happened, what was learned, and what changed. Focus on facts that would be useful to recall in a future session.`,

		recording_focus: `WHAT TO RECORD
Focus on deliverables and capabilities:
- What the system NOW DOES differently (new capabilities)
- What was built, fixed, deployed, or configured
- Key decisions and their rationale
- How things work (mechanisms, patterns, gotchas)

Use action verbs: implemented, fixed, deployed, configured, migrated, optimized, added, refactored

GOOD: "Authentication now supports OAuth2 with PKCE flow"
BAD: "Analyzed authentication implementation and stored findings"`,

		skip_guidance: `WHEN TO SKIP (output empty <observation> with just <type>change</type> and <title>skip</title>):
- Empty status checks or trivial outputs
- Simple file listings with no meaningful content
- Package installations with no errors
- Repetitive operations already documented`,

		type_guidance: `**type**: MUST be exactly one of:
- bugfix: something was broken, now fixed
- feature: new capability or functionality added
- refactor: code restructured, behavior unchanged
- change: generic modification (docs, config, misc)
- discovery: learning about existing system
- decision: architectural/design choice with rationale`,

		concept_guidance: `**concepts**: 1-3 knowledge categories. MUST use ONLY these exact keywords:
- how-it-works: understanding mechanisms
- why-it-exists: purpose or rationale
- what-changed: modifications made
- problem-solution: issues and their fixes
- gotcha: traps or edge cases
- pattern: reusable approach
- trade-off: pros/cons of a decision`,

		field_guidance: `**facts**: Concise, self-contained statements. Each fact is ONE piece of information. No pronouns - each fact must stand alone. Include specific details: filenames, functions, values.
**files**: All files touched (full paths from project root).`,

		xml_format: `Output ONE observation using this XML structure:

\`\`\`xml
<observation>
  <type>[ bugfix | feature | refactor | change | discovery | decision ]</type>
  <title>[Short title capturing the core action or topic]</title>
  <subtitle>[One sentence explanation, max 24 words]</subtitle>
  <facts>
    <fact>[Concise, self-contained statement]</fact>
    <fact>[Another specific fact]</fact>
  </facts>
  <narrative>[Full context: what was done, how it works, why it matters. 2-4 sentences.]</narrative>
  <concepts>
    <concept>[knowledge-type-category]</concept>
  </concepts>
  <files_read>
    <file>[path/to/file]</file>
  </files_read>
  <files_modified>
    <file>[path/to/file]</file>
  </files_modified>
</observation>
\`\`\``,

		footer: `Output ONLY the XML observation block. No other text. Spend tokens wisely on useful observations.`,
	},
};
