import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal,
	TFile,
} from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

import {
	buildCodeBlockInsertion,
	buildLanguageAliases,
	buildLanguageCompletionChanges,
	buildLanguageList,
	CodeFenceLocation,
	findCodeFenceAtLine,
	findConflictingPluginIds,
	findLanguageTrigger,
	LanguageSuggestion,
	planFenceCompletion,
	rankLanguageSuggestions,
	updateRecentLanguages,
} from "./language-utils";

interface CodeFenceCompleterSettings {
	lastUsedLanguage: string;
	recentLanguages: string[];
	additionalLanguages: string;
	languageAliases: string;
}

const DEFAULT_SETTINGS: CodeFenceCompleterSettings = {
	lastUsedLanguage: "",
	recentLanguages: [],
	additionalLanguages: "",
	languageAliases: "",
};

const CONFLICTING_PLUGIN_NAMES: Record<string, string> = {
	"codeblock-completer": "Codeblock Completer",
	"code-language-completer": "Code Language Completer",
};

interface AppWithPluginManager extends App {
	plugins?: {
		enabledPlugins?: Iterable<string>;
	};
}

export default class CodeFenceCompleterPlugin extends Plugin {
	suggester: LanguageSuggester;
	settings: CodeFenceCompleterSettings = { ...DEFAULT_SETTINGS };
	conflictingPluginIds: string[] = [];

	onload(): void {
		void this.initialize().catch((error: unknown) => {
			console.error("Failed to initialize Code Fence Completer", error);
		});
	}

	private async initialize(): Promise<void> {
		await this.loadSettings();

		this.suggester = new LanguageSuggester(this);
		this.registerEditorSuggest(this.suggester);

		this.addCommand({
			id: "insert-code-block",
			name: "Insert code block",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const from = editor.getCursor("from");
				const to = editor.getCursor("to");
				const selection = editor.getSelection();
				const insertion = buildCodeBlockInsertion(
					editor.getLine(from.line).slice(0, from.ch),
					editor.getLine(to.line).slice(to.ch),
					selection,
				);
				editor.replaceSelection(insertion.text);
				editor.setCursor({
					line: from.line + insertion.lineOffset,
					ch: insertion.cursorCh,
				});
			},
		});

		this.addCommand({
			id: "change-code-block-language",
			name: "Change code block language",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const fence = findCodeFenceAtLine(
					editor.getCursor().line,
					editor.lastLine(),
					(line) => editor.getLine(line),
				);
				if (!fence) {
					new Notice("The cursor is not inside a fenced code block.");
					return;
				}
				new LanguageSelectionModal(this, editor, fence).open();
			},
		});

		this.addSettingTab(new CodeFenceCompleterSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => {
			this.refreshConflicts();
			if (this.conflictingPluginIds.length > 0) {
				const names = this.conflictingPluginIds.map(
					(pluginId) => CONFLICTING_PLUGIN_NAMES[pluginId] ?? pluginId,
				);
				new Notice(
					`Code Fence Completer conflicts with: ${names.join(", ")}. Disable the other completer to avoid duplicate suggestions.`,
					10000,
				);
			}
		});
	}

	async loadSettings(): Promise<void> {
		const loadedData: unknown = await this.loadData();
		const data = isRecord(loadedData) ? loadedData : {};
		const lastUsedLanguage =
			typeof data.lastUsedLanguage === "string"
				? data.lastUsedLanguage
				: DEFAULT_SETTINGS.lastUsedLanguage;
		const recentLanguages = Array.isArray(data.recentLanguages)
			? data.recentLanguages
					.filter(
						(language): language is string =>
							typeof language === "string" && language.trim().length > 0,
					)
					.slice(0, 5)
			: DEFAULT_SETTINGS.recentLanguages;

		this.settings = {
			lastUsedLanguage,
			recentLanguages:
				recentLanguages.length === 0 && lastUsedLanguage
					? [lastUsedLanguage]
					: recentLanguages,
			additionalLanguages:
				typeof data.additionalLanguages === "string"
					? data.additionalLanguages
					: DEFAULT_SETTINGS.additionalLanguages,
			languageAliases:
				typeof data.languageAliases === "string"
					? data.languageAliases
					: DEFAULT_SETTINGS.languageAliases,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getLanguageSuggestions(query: string): LanguageSuggestion[] {
		return rankLanguageSuggestions(
			buildLanguageList(this.settings.additionalLanguages),
			buildLanguageAliases(this.settings.languageAliases),
			query,
			this.settings.recentLanguages,
		);
	}

	recordLanguage(language: string): void {
		this.settings.lastUsedLanguage = language;
		this.settings.recentLanguages = updateRecentLanguages(
			this.settings.recentLanguages,
			language,
		);
		void this.saveSettings();
	}

	refreshConflicts(): void {
		const enabledPlugins = (this.app as AppWithPluginManager).plugins
			?.enabledPlugins;
		this.conflictingPluginIds = enabledPlugins
			? findConflictingPluginIds(enabledPlugins)
			: [];
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

class LanguageSuggester extends EditorSuggest<LanguageSuggestion> {
	constructor(private readonly plugin: CodeFenceCompleterPlugin) {
		super(plugin.app);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile,
	): EditorSuggestTriggerInfo | null {
		const trigger = findLanguageTrigger(
			cursor.line,
			cursor.ch,
			(line) => editor.getLine(line),
		);
		if (!trigger) {
			return null;
		}

		return {
			start: { line: cursor.line, ch: trigger.startCh },
			end: { line: cursor.line, ch: trigger.endCh },
			query: trigger.query,
		};
	}

	getSuggestions(context: EditorSuggestContext): LanguageSuggestion[] {
		return this.plugin.getLanguageSuggestions(context.query);
	}

	renderSuggestion(suggestion: LanguageSuggestion, element: HTMLElement): void {
		renderLanguageSuggestion(suggestion, element);
	}

	selectSuggestion(
		suggestion: LanguageSuggestion,
		_event: MouseEvent | KeyboardEvent,
	): void {
		if (!this.context) {
			return;
		}

		const { editor, start, end } = this.context;
		const { language } = suggestion;
		this.plugin.recordLanguage(language);

		const originalOpeningLine = editor.getLine(end.line);
		const openingLine =
			originalOpeningLine.slice(0, start.ch) +
			language +
			originalOpeningLine.slice(end.ch);
		const fenceMatch = openingLine.match(/^( {0,3})(`{3,}|~{3,})/);
		const indent = fenceMatch?.[1] ?? "";
		const fence = fenceMatch?.[2] ?? "```";
		const plan = planFenceCompletion(
			end.line,
			openingLine,
			editor.lastLine(),
			(line) => editor.getLine(line),
			fence,
			indent,
		);
		editor.transaction({
			changes: buildLanguageCompletionChanges(language, start, end, plan),
			selection: { from: plan.cursor },
		});
	}
}

interface LanguageModalChoice extends LanguageSuggestion {
	clear?: boolean;
}

class LanguageSelectionModal extends SuggestModal<LanguageModalChoice> {
	constructor(
		private readonly plugin: CodeFenceCompleterPlugin,
		private readonly editor: Editor,
		private readonly fence: CodeFenceLocation,
	) {
		super(plugin.app);
		this.setPlaceholder("Search languages or aliases");
	}

	getSuggestions(query: string): LanguageModalChoice[] {
		const normalizedQuery = query.trim().toLowerCase();
		const clearChoice: LanguageModalChoice = { language: "", clear: true };
		const includeClear =
			!normalizedQuery ||
			"clear".startsWith(normalizedQuery) ||
			"none".startsWith(normalizedQuery);
		return [
			...(includeClear ? [clearChoice] : []),
			...this.plugin.getLanguageSuggestions(query),
		];
	}

	renderSuggestion(choice: LanguageModalChoice, element: HTMLElement): void {
		if (choice.clear) {
			element.setText("No language (clear info string)");
			return;
		}
		renderLanguageSuggestion(choice, element);
	}

	onChooseSuggestion(choice: LanguageModalChoice): void {
		if (choice.clear) {
			this.editor.replaceRange(
				"",
				{ line: this.fence.openingLine, ch: this.fence.infoStartCh },
				{
					line: this.fence.openingLine,
					ch: this.editor.getLine(this.fence.openingLine).length,
				},
			);
			return;
		}

		this.editor.replaceRange(
			choice.language,
			{
				line: this.fence.openingLine,
				ch: this.fence.languageStartCh,
			},
			{ line: this.fence.openingLine, ch: this.fence.languageEndCh },
		);
		this.plugin.recordLanguage(choice.language);
	}
}

function renderLanguageSuggestion(
	suggestion: LanguageSuggestion,
	element: HTMLElement,
): void {
	element.createSpan({ text: suggestion.language });
	if (suggestion.matchedAlias) {
		element.createEl("small", { text: ` (${suggestion.matchedAlias})` });
	}
}

class CodeFenceCompleterSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: CodeFenceCompleterPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		this.plugin.refreshConflicts();
		const definitions: SettingDefinitionItem[] = [];

		if (this.plugin.conflictingPluginIds.length > 0) {
			const names = this.plugin.conflictingPluginIds.map(
				(pluginId) => CONFLICTING_PLUGIN_NAMES[pluginId] ?? pluginId,
			);
			definitions.push({
				name: "Plugin conflict detected",
				desc: `Disable ${names.join(", ")} to prevent duplicate language suggestions.`,
			});
		}

		definitions.push(
			{
				name: "Additional languages",
				desc: "Add language identifiers separated by commas or new lines.",
				control: {
					type: "textarea",
					key: "additionalLanguages",
					placeholder: "vue, c++, typst",
				},
			},
			{
				name: "Language aliases",
				desc: "Add alias=language mappings separated by commas or new lines. Built-ins include py, js, ts, sh, md, yml, and cs.",
				control: {
					type: "textarea",
					key: "languageAliases",
					placeholder: "rb=ruby\nkt=kotlin",
				},
			},
			{
				name: "Recent languages",
				desc:
					this.plugin.settings.recentLanguages.length > 0
						? this.plugin.settings.recentLanguages.join(", ")
						: "No recently used languages.",
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText("Clear").onClick(() => {
							this.plugin.settings.lastUsedLanguage = "";
							this.plugin.settings.recentLanguages = [];
							void this.plugin.saveSettings();
							this.update();
						}),
					);
				},
			},
		);

		return definitions;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.plugin.refreshConflicts();

		if (this.plugin.conflictingPluginIds.length > 0) {
			const names = this.plugin.conflictingPluginIds.map(
				(pluginId) => CONFLICTING_PLUGIN_NAMES[pluginId] ?? pluginId,
			);
			new Setting(containerEl)
				.setName("Plugin conflict detected")
				.setDesc(
					`Disable ${names.join(", ")} to prevent duplicate language suggestions.`,
				);
		}

		new Setting(containerEl)
			.setName("Additional languages")
			.setDesc("Add language identifiers separated by commas or new lines.")
			.addTextArea((text) =>
				text
					.setPlaceholder("vue, c++, typst")
					.setValue(this.plugin.settings.additionalLanguages)
					.onChange(async (value) => {
						this.plugin.settings.additionalLanguages = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Language aliases")
			.setDesc(
				"Add alias=language mappings separated by commas or new lines. Built-ins include py, js, ts, sh, md, yml, and cs.",
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("rb=ruby\nkt=kotlin")
					.setValue(this.plugin.settings.languageAliases)
					.onChange(async (value) => {
						this.plugin.settings.languageAliases = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Recent languages")
			.setDesc(
				this.plugin.settings.recentLanguages.length > 0
					? this.plugin.settings.recentLanguages.join(", ")
					: "No recently used languages.",
			)
			.addButton((button) =>
				button.setButtonText("Clear").onClick(async () => {
					this.plugin.settings.lastUsedLanguage = "";
					this.plugin.settings.recentLanguages = [];
					await this.plugin.saveSettings();
					this.display();
				}),
			);
	}
}
