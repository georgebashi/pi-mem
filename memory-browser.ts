/**
 * Interactive memory browser TUI component for pi-mem.
 *
 * Provides a full-screen browser for exploring the agent's memory:
 * - Injected Context view (home): what the agent sees
 * - Summaries view: session summaries with preview
 * - Timeline view: chronological context around an anchor
 * - All Memories view: flat list with type filtering
 *
 * Supports FTS and vector search, edit with re-embedding, and delete.
 */

import type {
	ObservationStore,
	IndexResult,
	FullResult,
	ListOptions,
} from "./observation-store.js";
import type { PiMemConfig } from "./config.js";
import {
	getRecentSummaries,
	semanticSearch,
	ftsSearch,
	timelineSearch,
	getObservationById,
	getSessionObservations,
	listObservations,
	countObservations,
} from "./observation-store.js";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import { buildInjectedContext } from "./context-injection.js";

// ─── Types ────────────────────────────────────────────────────

type View = "context" | "summaries" | "session" | "timeline" | "allMemories";
type InputMode = "none" | "ftsSearch" | "vectorSearch" | "testPrompt";

export interface BrowserOptions {
	store: ObservationStore;
	projectSlug: string;
	config: PiMemConfig;
	/** Theme from pi's TUI */
	theme: any;
	/** TUI instance for requestRender */
	tui: any;
	/** Called when browser should close */
	onClose: () => void;
	/** Called when user wants to edit — exits custom UI, handler does the edit */
	onEdit: (id: string, title: string, narrative: string) => void;
	/** Called when user wants to delete — exits custom UI, handler does the confirm */
	onDelete: (id: string, title: string) => void;
}

interface ListItem {
	index: IndexResult;
	/** For vector search results */
	score?: number;
	/** Whether this is the timeline anchor */
	isAnchor?: boolean;
}

// ─── Component ────────────────────────────────────────────────

export class MemoryBrowser {
	private opts: BrowserOptions;

	// View state
	private currentView: View = "context";
	private previousView: View = "summaries";

	// List state (shared across list-based views)
	private items: ListItem[] = [];
	private selectedIndex = 0;
	private scrollOffset = 0;

	// Preview state
	private previewItem: FullResult | null = null;
	private previewScrollOffset = 0;

	// Context view state
	private injectedContext: string | null = null;
	private testPromptText = "";
	private testPromptContext: string | null = null;

	// Session drill-down state
	private sessionId: string | null = null;
	private summariesSelectedIndex = 0;

	// Timeline state
	private timelineAnchorId: string | null = null;
	private timelineDepth = 5;

	// All memories state
	private typeFilter: string | null = null;
	private totalCount = 0;

	// Search state
	private inputMode: InputMode = "none";
	private searchText = "";
	private searchQuery: string | null = null;
	private vectorQuery: string | null = null;

	// Pagination
	private loadedOffset = 0;
	private hasMore = false;

	// Render cache
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(opts: BrowserOptions) {
		this.opts = opts;
	}

	async init(): Promise<void> {
		await this.loadContextView();
	}

	// ─── Data Loading ─────────────────────────────────────────

	private async loadContextView(): Promise<void> {
		this.injectedContext = await buildInjectedContext(
			this.opts.store,
			this.opts.projectSlug,
			this.opts.config,
		);
		this.testPromptContext = null;
		this.testPromptText = "";
		this.invalidate();
	}

	private async loadTestPrompt(): Promise<void> {
		if (!this.testPromptText.trim()) {
			this.testPromptContext = null;
			this.invalidate();
			return;
		}
		this.testPromptContext = await buildInjectedContext(
			this.opts.store,
			this.opts.projectSlug,
			this.opts.config,
			this.testPromptText.trim(),
		);
		this.invalidate();
	}

	private async loadSummaries(): Promise<void> {
		const results = await getRecentSummaries(
			this.opts.store,
			this.opts.projectSlug,
			100,
		);
		this.items = results.map((r) => ({ index: r }));
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.previewItem = null;
		this.previewScrollOffset = 0;
		await this.loadPreview();
		this.invalidate();
	}

	private async loadSession(sessionId: string): Promise<void> {
		this.sessionId = sessionId;
		const observations = await getSessionObservations(this.opts.store, sessionId);
		this.items = observations.map((r) => ({
			index: {
				id: r.id,
				session_id: r.session_id,
				project: r.project,
				type: r.type,
				obs_type: r.obs_type,
				timestamp: r.timestamp,
				tool_name: r.tool_name,
				title: r.title,
				subtitle: r.subtitle,
			},
		}));
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.previewItem = null;
		this.previewScrollOffset = 0;
		await this.loadPreview();
		this.invalidate();
	}

	private async loadTimeline(anchorId: string): Promise<void> {
		this.timelineAnchorId = anchorId;
		const results = await timelineSearch(this.opts.store, {
			anchorId,
			depthBefore: this.timelineDepth,
			depthAfter: this.timelineDepth,
			project: this.opts.projectSlug,
		});
		this.items = results.map((r) => ({
			index: {
				id: r.id,
				session_id: r.session_id,
				project: r.project,
				type: r.type,
				obs_type: r.obs_type,
				timestamp: r.timestamp,
				tool_name: r.tool_name,
				title: r.title,
				subtitle: r.subtitle,
			},
			isAnchor: r.id === anchorId,
		}));
		// Select the anchor item
		const anchorIdx = this.items.findIndex((i) => i.isAnchor);
		this.selectedIndex = anchorIdx >= 0 ? anchorIdx : 0;
		this.scrollOffset = 0;
		this.previewItem = null;
		this.previewScrollOffset = 0;
		await this.loadPreview();
		this.invalidate();
	}

	private async loadAllMemories(): Promise<void> {
		this.totalCount = await countObservations(this.opts.store, {
			project: this.opts.projectSlug,
			type: this.typeFilter ?? undefined,
		});
		const results = await listObservations(this.opts.store, {
			project: this.opts.projectSlug,
			type: this.typeFilter ?? undefined,
			limit: 100,
			offset: 0,
			order: "desc",
		});
		this.items = results.map((r) => ({ index: r }));
		this.loadedOffset = results.length;
		this.hasMore = results.length < this.totalCount;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.previewItem = null;
		this.previewScrollOffset = 0;
		await this.loadPreview();
		this.invalidate();
	}

	private async loadMore(): Promise<void> {
		if (!this.hasMore || this.currentView !== "allMemories") return;
		const results = await listObservations(this.opts.store, {
			project: this.opts.projectSlug,
			type: this.typeFilter ?? undefined,
			limit: 100,
			offset: this.loadedOffset,
			order: "desc",
		});
		for (const r of results) {
			this.items.push({ index: r });
		}
		this.loadedOffset += results.length;
		this.hasMore = this.loadedOffset < this.totalCount;
		this.invalidate();
	}

	private async loadFtsSearch(query: string): Promise<void> {
		const results = await ftsSearch(
			this.opts.store,
			query,
			{ project: this.opts.projectSlug },
			100,
		);
		this.items = results.map((r) => ({ index: r }));
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.previewItem = null;
		this.previewScrollOffset = 0;
		await this.loadPreview();
		this.invalidate();
	}

	private async loadVectorSearch(query: string): Promise<void> {
		const results = await semanticSearch(
			this.opts.store,
			query,
			this.opts.projectSlug,
			20,
		);
		this.items = results.map((r, i) => ({
			index: {
				id: r.id,
				session_id: r.session_id,
				project: r.project,
				type: r.type,
				obs_type: r.obs_type,
				timestamp: r.timestamp,
				tool_name: r.tool_name,
				title: r.title,
				subtitle: r.subtitle,
			},
			score: 1 - i * 0.05, // Approximate ranking score
		}));
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.previewItem = null;
		this.previewScrollOffset = 0;
		await this.loadPreview();
		this.invalidate();
	}

	private async loadPreview(): Promise<void> {
		if (this.items.length === 0) {
			this.previewItem = null;
			return;
		}
		const item = this.items[this.selectedIndex];
		if (item) {
			this.previewItem = await getObservationById(this.opts.store, item.index.id);
			this.previewScrollOffset = 0;
		}
	}

	// ─── Input Handling ───────────────────────────────────────

	async handleInput(data: string): Promise<void> {
		// In text input mode, handle typing
		if (this.inputMode !== "none") {
			await this.handleInputMode(data);
			return;
		}

		// Global keys
		if (data === "q") {
			this.opts.onClose();
			return;
		}

		// View switching
		if (data === "1") {
			this.switchView("context");
			return;
		}
		if (data === "2") {
			this.switchView("summaries");
			return;
		}
		if (data === "3") {
			// Timeline needs an anchor — only switch if we have one
			if (this.timelineAnchorId) {
				this.switchView("timeline");
			}
			return;
		}
		if (data === "4") {
			this.switchView("allMemories");
			return;
		}

		// Context view specific
		if (this.currentView === "context") {
			await this.handleContextInput(data);
			return;
		}

		// List-based view keys
		await this.handleListInput(data);
	}

	private async handleInputMode(data: string): Promise<void> {
		const isEnter = data === "\r" || data === "\n";
		const isEscape = data === "\x1b";
		const isBackspace = data === "\x7f" || data === "\b";

		if (isEscape) {
			if (this.inputMode === "testPrompt") {
				this.testPromptText = "";
				this.testPromptContext = null;
			}
			this.inputMode = "none";
			this.searchText = "";
			this.searchQuery = null;
			this.vectorQuery = null;
			// Reload the current view to clear search
			await this.reloadCurrentView();
			this.invalidate();
			return;
		}

		if (isEnter) {
			if (this.inputMode === "testPrompt") {
				await this.loadTestPrompt();
				this.inputMode = "none";
			} else if (this.inputMode === "ftsSearch") {
				this.searchQuery = this.searchText;
				this.inputMode = "none";
				if (this.searchText.trim()) {
					await this.loadFtsSearch(this.searchText.trim());
				}
			} else if (this.inputMode === "vectorSearch") {
				this.vectorQuery = this.searchText;
				this.inputMode = "none";
				if (this.searchText.trim()) {
					await this.loadVectorSearch(this.searchText.trim());
				}
			}
			this.invalidate();
			return;
		}

		if (isBackspace) {
			if (this.inputMode === "testPrompt") {
				this.testPromptText = this.testPromptText.slice(0, -1);
			} else {
				this.searchText = this.searchText.slice(0, -1);
			}
			this.invalidate();
			return;
		}

		// Printable character
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			if (this.inputMode === "testPrompt") {
				this.testPromptText += data;
			} else {
				this.searchText += data;
			}
			this.invalidate();
			return;
		}
	}

	private async handleContextInput(data: string): Promise<void> {
		const isEscape = data === "\x1b";

		if (isEscape) {
			this.opts.onClose();
			return;
		}

		// Start test prompt input
		if (data === "\r" || data === "\n" || data === "p") {
			this.inputMode = "testPrompt";
			this.invalidate();
			return;
		}
	}

	private async handleListInput(data: string): Promise<void> {
		const isEscape = data === "\x1b";
		const isEnter = data === "\r" || data === "\n";
		const isUp = data === "\x1b[A";
		const isDown = data === "\x1b[B";
		const isPageUp = data === "\x1b[5~";
		const isPageDown = data === "\x1b[6~";
		const isShiftUp = data === "\x1b[1;2A";
		const isShiftDown = data === "\x1b[1;2B";
		const isBackspace = data === "\x7f" || data === "\b";

		// Navigation
		if (isUp) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.previewScrollOffset = 0;
				await this.loadPreview();
			}
			this.ensureVisible();
			this.invalidate();
			return;
		}

		if (isDown) {
			if (this.selectedIndex < this.items.length - 1) {
				this.selectedIndex++;
				this.previewScrollOffset = 0;
				await this.loadPreview();
				// Pagination trigger
				if (this.hasMore && this.selectedIndex >= this.items.length - 10) {
					await this.loadMore();
				}
			}
			this.ensureVisible();
			this.invalidate();
			return;
		}

		if (isPageUp) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 20);
			this.previewScrollOffset = 0;
			await this.loadPreview();
			this.ensureVisible();
			this.invalidate();
			return;
		}

		if (isPageDown) {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 20);
			this.previewScrollOffset = 0;
			await this.loadPreview();
			if (this.hasMore && this.selectedIndex >= this.items.length - 10) {
				await this.loadMore();
			}
			this.ensureVisible();
			this.invalidate();
			return;
		}

		// Preview scrolling
		if (isShiftUp) {
			if (this.previewScrollOffset > 0) this.previewScrollOffset--;
			this.invalidate();
			return;
		}

		if (isShiftDown) {
			this.previewScrollOffset++;
			this.invalidate();
			return;
		}

		// Escape / back
		if (isEscape || isBackspace) {
			if (this.currentView === "session") {
				this.currentView = "summaries";
				this.selectedIndex = this.summariesSelectedIndex;
				await this.loadSummaries();
				this.selectedIndex = this.summariesSelectedIndex;
				await this.loadPreview();
				this.invalidate();
				return;
			}
			if (this.currentView === "timeline") {
				this.switchView(this.previousView);
				return;
			}
			if (this.searchQuery || this.vectorQuery) {
				this.searchQuery = null;
				this.vectorQuery = null;
				await this.reloadCurrentView();
				this.invalidate();
				return;
			}
			this.opts.onClose();
			return;
		}

		// Enter: drill down from summaries into session
		if (isEnter && this.currentView === "summaries" && this.items.length > 0) {
			const item = this.items[this.selectedIndex];
			if (item) {
				this.summariesSelectedIndex = this.selectedIndex;
				this.currentView = "session";
				await this.loadSession(item.index.session_id);
			}
			return;
		}

		// T: open timeline
		if (data === "T" && this.items.length > 0) {
			const item = this.items[this.selectedIndex];
			if (item) {
				this.previousView = this.currentView === "session" ? "summaries" : this.currentView;
				this.currentView = "timeline";
				await this.loadTimeline(item.index.id);
			}
			return;
		}

		// +/- depth in timeline
		if (data === "+" && this.currentView === "timeline") {
			this.timelineDepth = Math.min(50, this.timelineDepth + 5);
			if (this.timelineAnchorId) await this.loadTimeline(this.timelineAnchorId);
			return;
		}
		if (data === "-" && this.currentView === "timeline") {
			this.timelineDepth = Math.max(1, this.timelineDepth - 5);
			if (this.timelineAnchorId) await this.loadTimeline(this.timelineAnchorId);
			return;
		}

		// / : FTS search
		if (data === "/") {
			this.inputMode = "ftsSearch";
			this.searchText = "";
			this.invalidate();
			return;
		}

		// v : vector search
		if (data === "v") {
			if (!this.opts.store.embed) {
				// No embeddings configured — can't do vector search
				// Just flash a message via invalidate
				this.invalidate();
				return;
			}
			this.inputMode = "vectorSearch";
			this.searchText = "";
			this.invalidate();
			return;
		}

		// t : cycle type filter (all memories view only)
		if (data === "t" && this.currentView === "allMemories") {
			const types = [null, "observation", "summary", "prompt", "manual"];
			const currentIdx = types.indexOf(this.typeFilter);
			this.typeFilter = types[(currentIdx + 1) % types.length];
			await this.loadAllMemories();
			return;
		}

		// e : edit
		if (data === "e" && this.items.length > 0) {
			await this.editSelected();
			return;
		}

		// d : delete
		if (data === "d" && this.items.length > 0) {
			await this.deleteSelected();
			return;
		}
	}

	// ─── Edit / Delete ────────────────────────────────────────

	private async editSelected(): Promise<void> {
		const item = this.items[this.selectedIndex];
		if (!item) return;

		const full = await getObservationById(this.opts.store, item.index.id);
		if (!full) return;

		// Exit custom UI — the command handler will show the editor and re-enter
		this.opts.onEdit(full.id, full.title, full.narrative);
	}

	private async deleteSelected(): Promise<void> {
		const item = this.items[this.selectedIndex];
		if (!item) return;

		// Exit custom UI — the command handler will show confirm dialog and re-enter
		this.opts.onDelete(item.index.id, item.index.title);
	}

	/** Called by command handler after a successful delete to update local state */
	removeItem(id: string): void {
		const idx = this.items.findIndex((i) => i.index.id === id);
		if (idx >= 0) {
			this.items.splice(idx, 1);
			if (this.selectedIndex >= this.items.length) {
				this.selectedIndex = Math.max(0, this.items.length - 1);
			}
			this.previewItem = null;
		}
	}

	/** Called by command handler after a successful edit to update local state */
	updateItem(id: string, fields: { title?: string; narrative?: string }): void {
		const item = this.items.find((i) => i.index.id === id);
		if (item && fields.title) {
			item.index.title = fields.title;
		}
		// Preview will reload on next render
		this.previewItem = null;
	}

	// ─── View Switching ───────────────────────────────────────

	private switchView(view: View): void {
		if (view === this.currentView) return;
		this.previousView = this.currentView;
		this.currentView = view;
		this.searchQuery = null;
		this.vectorQuery = null;
		this.inputMode = "none";
		this.searchText = "";

		switch (view) {
			case "context":
				this.loadContextView();
				break;
			case "summaries":
				this.loadSummaries();
				break;
			case "timeline":
				if (this.timelineAnchorId) {
					this.loadTimeline(this.timelineAnchorId);
				}
				break;
			case "allMemories":
				this.loadAllMemories();
				break;
		}
	}

	private async reloadCurrentView(): Promise<void> {
		switch (this.currentView) {
			case "context":
				await this.loadContextView();
				break;
			case "summaries":
				await this.loadSummaries();
				break;
			case "session":
				if (this.sessionId) await this.loadSession(this.sessionId);
				break;
			case "timeline":
				if (this.timelineAnchorId) await this.loadTimeline(this.timelineAnchorId);
				break;
			case "allMemories":
				await this.loadAllMemories();
				break;
		}
	}

	private ensureVisible(): void {
		// Will be applied during render based on visible height
	}

	// ─── Rendering ────────────────────────────────────────────

	render(width: number): string[] {
		const theme = this.opts.theme;
		const lines: string[] = [];

		// Tab bar
		lines.push(this.renderTabBar(width, theme));
		lines.push(this.renderSeparator(width, theme));

		// Estimate available height (terminal height not available, use remaining space)
		// We'll render as many lines as needed; the TUI handles scrolling
		const contentHeight = 30; // Reasonable default

		if (this.currentView === "context") {
			lines.push(...this.renderContextView(width, contentHeight, theme));
		} else {
			lines.push(...this.renderListView(width, contentHeight, theme));
		}

		// Separator
		lines.push(this.renderSeparator(width, theme));

		// Help bar
		lines.push(this.renderHelpBar(width, theme));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderTabBar(width: number, theme: any): string {
		const views: { key: string; label: string; view: View }[] = [
			{ key: "1", label: "Context", view: "context" },
			{ key: "2", label: "Summaries", view: "summaries" },
			{ key: "3", label: "Timeline", view: "timeline" },
			{ key: "4", label: "All Memories", view: "allMemories" },
		];

		let tabText = " ";
		for (const v of views) {
			const isActive = this.currentView === v.view ||
				(this.currentView === "session" && v.view === "summaries");
			const label = `${v.key} ${v.label}`;
			if (isActive) {
				tabText += theme.fg("accent", `[${label}]`);
			} else {
				tabText += theme.fg("dim", ` ${label} `);
			}
			tabText += "  ";
		}

		// Session breadcrumb
		if (this.currentView === "session" && this.sessionId) {
			tabText += theme.fg("muted", `▸ `) + theme.fg("accent", `[Session ${this.sessionId}]`);
		}

		// Right-aligned info
		const rightInfo = this.getRightInfo(theme);
		const padding = Math.max(0, width - visibleWidth(tabText) - visibleWidth(rightInfo) - 1);
		return truncateToWidth(tabText + " ".repeat(padding) + rightInfo, width);
	}

	private getRightInfo(theme: any): string {
		if (this.currentView === "timeline") {
			return theme.fg("dim", `depth: ${this.timelineDepth}  anchor: ${this.timelineAnchorId?.slice(0, 6) ?? "?"}`);
		}
		if (this.currentView === "allMemories") {
			const filter = this.typeFilter ?? "all";
			return theme.fg("dim", `Filter: ${filter}  Total: ${this.totalCount}`);
		}
		if (this.vectorQuery) {
			return theme.fg("dim", `Vector: "${this.vectorQuery}"  Results: ${this.items.length}`);
		}
		if (this.searchQuery) {
			return theme.fg("dim", `Search: "${this.searchQuery}"  Results: ${this.items.length}`);
		}
		return theme.fg("dim", this.opts.projectSlug);
	}

	private renderSeparator(width: number, theme: any): string {
		return theme.fg("border", "─".repeat(width));
	}

	// ─── Context View Rendering ───────────────────────────────

	private renderContextView(width: number, height: number, theme: any): string[] {
		const lines: string[] = [];
		const pad = " ";

		lines.push("");
		lines.push(pad + theme.fg("accent", theme.bold("What the agent sees")));
		lines.push(pad + theme.fg("dim", "───────────────────"));
		lines.push("");

		// Show injected context or test prompt context
		const context = this.testPromptContext ?? this.injectedContext;
		if (context) {
			for (const line of context.split("\n")) {
				lines.push(pad + truncateToWidth(line, width - 2));
			}
		} else {
			lines.push(pad + theme.fg("muted", "No memories yet for this project."));
		}

		lines.push("");
		lines.push(truncateToWidth(pad + theme.fg("border", "─── Test semantic search " + "─".repeat(Math.max(0, width - 28))), width));

		if (this.inputMode === "testPrompt") {
			lines.push(pad + "Prompt: " + this.testPromptText + theme.fg("accent", "█"));
		} else {
			lines.push(pad + theme.fg("dim", "Press ") + theme.fg("accent", "p") + theme.fg("dim", " to type a test prompt"));
		}

		if (this.testPromptContext && this.testPromptText) {
			lines.push(pad + theme.fg("muted", `↑ Showing results for "${this.testPromptText}"`));
		}

		if (!this.opts.store.embed) {
			lines.push("");
			lines.push(pad + theme.fg("warning", "⚠ Embeddings not configured — semantic search unavailable"));
		}

		lines.push("");
		return lines;
	}

	// ─── List View Rendering ──────────────────────────────────

	private renderListView(width: number, height: number, theme: any): string[] {
		const isWide = width >= 100;
		const lines: string[] = [];

		if (isWide) {
			// Side-by-side layout
			const listWidth = Math.floor(width * 0.4);
			const previewWidth = width - listWidth - 1; // -1 for divider

			const listLines = this.renderList(listWidth, height, theme);
			const previewLines = this.renderPreview(previewWidth, height, theme);

			// Combine side-by-side
			const maxLines = Math.max(listLines.length, previewLines.length);
			for (let i = 0; i < maxLines; i++) {
				const left = padRight(listLines[i] ?? "", listWidth);
				const divider = theme.fg("border", "│");
				const right = previewLines[i] ?? "";
				lines.push(truncateToWidth(left + divider + right, width));
			}
		} else {
			// Stacked layout
			const halfHeight = Math.floor(height / 2);
			lines.push(...this.renderList(width, halfHeight, theme));
			lines.push(this.renderSeparator(width, theme));
			lines.push(...this.renderPreview(width, halfHeight, theme));
		}

		// Search input bar
		if (this.inputMode === "ftsSearch") {
			lines.push(theme.fg("accent", " / ") + this.searchText + theme.fg("accent", "█"));
		} else if (this.inputMode === "vectorSearch") {
			lines.push(theme.fg("accent", " v ") + this.searchText + theme.fg("accent", "█"));
		}

		return lines;
	}

	private renderList(width: number, height: number, theme: any): string[] {
		const lines: string[] = [];
		const pad = " ";

		// Header
		let header = pad;
		if (this.currentView === "session" && this.sessionId) {
			header += `Session ${this.sessionId} observations (${this.items.length})`;
		} else if (this.currentView === "summaries") {
			header += `Summaries (${this.items.length})`;
		} else if (this.currentView === "timeline") {
			const anchor = this.items.find((i) => i.isAnchor);
			header += `Timeline around "${(anchor?.index.title ?? "?").slice(0, 30)}"`;
		} else if (this.currentView === "allMemories") {
			const label = this.typeFilter ? `${capitalize(this.typeFilter)}s only` : "All memories";
			header += `${label} (${this.items.length})`;
		}
		if (this.searchQuery) header = pad + `FTS: "${this.searchQuery}" (${this.items.length})`;
		if (this.vectorQuery) header = pad + `Vector: "${this.vectorQuery}" (${this.items.length})`;

		lines.push(theme.fg("muted", truncateToWidth(header, width)));
		lines.push("");

		if (this.items.length === 0) {
			lines.push(pad + theme.fg("dim", "No items."));
			return lines;
		}

		// Ensure selected item is visible
		const visibleCount = height - 2;
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + visibleCount) {
			this.scrollOffset = this.selectedIndex - visibleCount + 1;
		}

		const end = Math.min(this.items.length, this.scrollOffset + visibleCount);
		for (let i = this.scrollOffset; i < end; i++) {
			const item = this.items[i];
			const isSelected = i === this.selectedIndex;

			// Build line: marker + badge + date + title + id/score
			let marker = "  ";
			if (isSelected && item.isAnchor) marker = theme.fg("accent", "▶ ");
			else if (item.isAnchor) marker = theme.fg("muted", "▶ ");
			else if (isSelected) marker = theme.fg("accent", "▸ ");

			const badge = this.typeBadge(item.index.type, theme);
			const date = item.index.timestamp.slice(5, 10); // MM-DD
			const maxTitleLen = width - 20;
			const title = truncateToWidth(item.index.title, maxTitleLen);

			let suffix = "";
			if (item.score !== undefined) {
				suffix = theme.fg("dim", ` ${item.score.toFixed(2)}`);
			} else {
				suffix = theme.fg("dim", ` [${item.index.id.slice(0, 3)}…`);
			}

			let line = `${marker}${badge}  ${theme.fg("dim", date)}  `;
			if (isSelected) {
				line += theme.fg("accent", title);
			} else {
				line += title;
			}
			line += suffix;

			lines.push(truncateToWidth(line, width));
		}

		return lines;
	}

	private renderPreview(width: number, height: number, theme: any): string[] {
		const lines: string[] = [];
		const pad = " ";

		if (!this.previewItem) {
			lines.push(pad + theme.fg("dim", "No item selected."));
			return lines;
		}

		const item = this.previewItem;
		const allLines: string[] = [];

		allLines.push(truncateToWidth(pad + theme.fg("accent", theme.bold(`## ${item.title}`)), width));
		allLines.push("");
		allLines.push(truncateToWidth(pad + theme.fg("muted", `**Type:** ${item.type}${item.obs_type ? ` (${item.obs_type})` : ""}`), width));
		if (item.tool_name) allLines.push(truncateToWidth(pad + theme.fg("muted", `**Tool:** ${item.tool_name}`), width));
		allLines.push(truncateToWidth(pad + theme.fg("muted", `**Timestamp:** ${item.timestamp}`), width));
		allLines.push(truncateToWidth(pad + theme.fg("muted", `**Session:** ${item.session_id}`), width));

		if (item.concepts.length > 0) {
			allLines.push(truncateToWidth(pad + theme.fg("muted", `**Concepts:** ${item.concepts.join(", ")}`), width));
		}
		if (item.files_read.length > 0) {
			allLines.push(truncateToWidth(pad + theme.fg("muted", `**Files Read:** ${item.files_read.join(", ")}`), width));
		}
		if (item.files_modified.length > 0) {
			allLines.push(truncateToWidth(pad + theme.fg("muted", `**Files Modified:** ${item.files_modified.join(", ")}`), width));
		}
		if (item.facts.length > 0) {
			allLines.push("");
			allLines.push(truncateToWidth(pad + theme.fg("muted", "**Facts:**"), width));
			for (const fact of item.facts) {
				allLines.push(truncateToWidth(pad + theme.fg("dim", `- ${fact}`), width));
			}
		}

		allLines.push("");
		// Wrap narrative
		if (item.narrative) {
			for (const line of item.narrative.split("\n")) {
				allLines.push(pad + truncateToWidth(line, width - 2));
			}
		}

		// Apply scroll offset
		const visible = allLines.slice(this.previewScrollOffset, this.previewScrollOffset + height);
		lines.push(...visible);

		return lines;
	}

	// ─── Help Bar ─────────────────────────────────────────────

	private renderHelpBar(width: number, theme: any): string {
		let help = " ";

		if (this.currentView === "context") {
			help += [
				kh("1-4", "views", theme),
				kh("p", "test prompt", theme),
				kh("q", "quit", theme),
			].join("  ");
		} else if (this.currentView === "session") {
			help += [
				kh("↑↓", "navigate", theme),
				kh("T", "timeline", theme),
				kh("esc", "back", theme),
				kh("e", "edit", theme),
				kh("d", "delete", theme),
				kh("q", "quit", theme),
			].join("  ");
		} else if (this.currentView === "timeline") {
			help += [
				kh("↑↓", "navigate", theme),
				kh("T", "re-anchor", theme),
				kh("+/-", "depth", theme),
				kh("/", "search", theme),
				kh("e", "edit", theme),
				kh("d", "delete", theme),
				kh("esc", "back", theme),
				kh("q", "quit", theme),
			].join("  ");
		} else if (this.currentView === "summaries") {
			help += [
				kh("↑↓", "navigate", theme),
				kh("enter", "session", theme),
				kh("T", "timeline", theme),
				kh("/", "search", theme),
				kh("v", "vector", theme),
				kh("e", "edit", theme),
				kh("d", "delete", theme),
				kh("q", "quit", theme),
			].join("  ");
		} else {
			help += [
				kh("↑↓", "navigate", theme),
				kh("t", "filter type", theme),
				kh("T", "timeline", theme),
				kh("/", "search", theme),
				kh("v", "vector", theme),
				kh("e", "edit", theme),
				kh("d", "delete", theme),
				kh("q", "quit", theme),
			].join("  ");
		}

		return truncateToWidth(help, width);
	}

	private typeBadge(type: string, theme: any): string {
		switch (type) {
			case "observation": return theme.fg("muted", "obs");
			case "summary": return theme.fg("accent", "sum");
			case "prompt": return theme.fg("dim", "prm");
			case "manual": return theme.fg("success", "mem");
			default: return theme.fg("dim", "???");
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.opts.tui?.requestRender?.();
	}
}

// ─── Utilities ────────────────────────────────────────────────

/** Pad a string (which may contain ANSI codes) to a visible width */
function padRight(str: string, len: number): string {
	const visible = visibleWidth(str);
	if (visible >= len) return truncateToWidth(str, len);
	return str + " ".repeat(len - visible);
}

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function kh(key: string, desc: string, theme: any): string {
	return theme.fg("accent", key) + " " + theme.fg("dim", desc);
}
