import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

import {
	buildCodeBlockInsertion,
	buildLanguageCompletionChanges,
	buildLanguageList,
	filterLanguages,
	findLanguageTrigger,
	planFenceCompletion,
} from "./language-utils";

interface CodeFenceCompleterSettings {
	lastUsedLanguage: string;
	additionalLanguages: string;
}

const DEFAULT_SETTINGS: CodeFenceCompleterSettings = {
	lastUsedLanguage: "",
	additionalLanguages: "",
};

export default class CodeFenceCompleterPlugin extends Plugin {
	suggester: LanguageSuggester;
	settings: CodeFenceCompleterSettings;

	async onload(): Promise<void> {
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

		this.addSettingTab(new CodeFenceCompleterSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class LanguageSuggester extends EditorSuggest<string> {
	private languages: string[] = [];

	constructor(private readonly plugin: CodeFenceCompleterPlugin) {
		super(plugin.app);
		this.updateLanguages();
	}

	updateLanguages(): void {
		this.languages = buildLanguageList(
			this.plugin.settings.additionalLanguages,
		);
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

	getSuggestions(context: EditorSuggestContext): string[] {
		return filterLanguages(
			this.languages,
			context.query,
			this.plugin.settings.lastUsedLanguage,
		);
	}

	renderSuggestion(language: string, element: HTMLElement): void {
		element.setText(language);
	}

	selectSuggestion(
		language: string,
		_event: MouseEvent | KeyboardEvent,
	): void {
		if (!this.context) {
			return;
		}

		const { editor, start, end } = this.context;
		this.plugin.settings.lastUsedLanguage = language;
		void this.plugin.saveSettings();

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

class CodeFenceCompleterSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: CodeFenceCompleterPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Last used language")
			.setDesc("The language shown first in matching suggestions.")
			.addText((text) =>
				text
					.setPlaceholder("No language selected yet")
					.setValue(this.plugin.settings.lastUsedLanguage)
					.onChange(async (value) => {
						this.plugin.settings.lastUsedLanguage = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Additional languages")
			.setDesc("Add language identifiers separated by commas or new lines.")
			.addTextArea((text) =>
				text
					.setPlaceholder("vue, c++, typst")
					.setValue(this.plugin.settings.additionalLanguages)
					.onChange(async (value) => {
						this.plugin.settings.additionalLanguages = value;
						this.plugin.suggester.updateLanguages();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Reset last used language")
			.setDesc("Clear the language suggestion history.")
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					this.plugin.settings.lastUsedLanguage = "";
					await this.plugin.saveSettings();
					this.display();
				}),
			);
	}
}
