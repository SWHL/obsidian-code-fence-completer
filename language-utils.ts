export interface LanguageTrigger {
	query: string;
	startCh: number;
	endCh: number;
	fence: string;
	indent: string;
}

export interface EditorInsertion {
	text: string;
	lineOffset: number;
	cursorCh: number;
}

export interface FenceCompletionPlan {
	insertion: { line: number; ch: number; text: string } | null;
	cursor: { line: number; ch: number };
}

export interface EditorTextChange {
	from: { line: number; ch: number };
	to?: { line: number; ch: number };
	text: string;
}

export interface LanguageSuggestion {
	language: string;
	matchedAlias?: string;
}

export interface CodeFenceLocation {
	openingLine: number;
	closingLine: number | null;
	fence: string;
	indent: string;
	infoStartCh: number;
	languageStartCh: number;
	languageEndCh: number;
	language: string;
}

export const DEFAULT_LANGUAGES = [
	"bash",
	"c",
	"cpp",
	"csharp",
	"css",
	"go",
	"html",
	"java",
	"javascript",
	"json",
	"kotlin",
	"markdown",
	"ocaml",
	"php",
	"powershell",
	"python",
	"ruby",
	"rust",
	"sql",
	"swift",
	"typescript",
	"xml",
	"yaml",
];

export const DEFAULT_LANGUAGE_ALIASES = [
	["cs", "csharp"],
	["js", "javascript"],
	["md", "markdown"],
	["py", "python"],
	["sh", "bash"],
	["ts", "typescript"],
	["yml", "yaml"],
] as const;

export const CONFLICTING_PLUGIN_IDS = [
	"codeblock-completer",
	"code-language-completer",
] as const;

interface OpenFence {
	character: "`" | "~";
	length: number;
}

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/;

function isValidOpeningFence(
	fenceCharacter: string,
	suffix: string,
): boolean {
	return fenceCharacter !== "`" || !suffix.includes("`");
}

function getOpenFenceBeforeLine(
	lineNumber: number,
	getLine: (line: number) => string,
): OpenFence | null {
	let openFence: OpenFence | null = null;

	for (let line = 0; line < lineNumber; line += 1) {
		const match = getLine(line).match(OPENING_FENCE);
		if (!match) {
			continue;
		}

		const fence = match[2];
		const character = fence[0] as "`" | "~";
		const suffix = match[3];

		if (!openFence) {
			// Backticks are not allowed in an opening backtick fence's info string.
			if (!isValidOpeningFence(character, suffix)) {
				continue;
			}
			openFence = { character, length: fence.length };
			continue;
		}

		const isClosingFence =
			character === openFence.character &&
			fence.length >= openFence.length &&
			suffix.trim().length === 0;
		if (isClosingFence) {
			openFence = null;
		}
	}

	return openFence;
}

export function findCodeFenceAtLine(
	lineNumber: number,
	lastLine: number,
	getLine: (line: number) => string,
): CodeFenceLocation | null {
	let openFence: CodeFenceLocation | null = null;

	for (let line = 0; line <= lastLine; line += 1) {
		const lineText = getLine(line);
		const match = lineText.match(OPENING_FENCE);
		if (!match) {
			continue;
		}

		const fence = match[2];
		const character = fence[0];
		const suffix = match[3];
		if (openFence) {
			const isClosingFence =
				character === openFence.fence[0] &&
				fence.length >= openFence.fence.length &&
				suffix.trim().length === 0;
			if (isClosingFence) {
				if (lineNumber >= openFence.openingLine && lineNumber <= line) {
					return { ...openFence, closingLine: line };
				}
				openFence = null;
			}
			continue;
		}

		if (!isValidOpeningFence(character, suffix)) {
			continue;
		}

		const infoStartCh = match[1].length + fence.length;
		let languageStartCh = infoStartCh;
		while (/\s/.test(lineText[languageStartCh] ?? "")) {
			languageStartCh += 1;
		}
		let languageEndCh = languageStartCh;
		while (
			languageEndCh < lineText.length &&
			!/\s/.test(lineText[languageEndCh])
		) {
			languageEndCh += 1;
		}

		openFence = {
			openingLine: line,
			closingLine: null,
			fence,
			indent: match[1],
			infoStartCh,
			languageStartCh,
			languageEndCh,
			language: lineText.slice(languageStartCh, languageEndCh),
		};
	}

	if (openFence && lineNumber >= openFence.openingLine) {
		return openFence;
	}
	return null;
}

export function findLanguageTrigger(
	lineNumber: number,
	ch: number,
	getLine: (line: number) => string,
): LanguageTrigger | null {
	const currentLine = getLine(lineNumber);
	const beforeCursor = currentLine.slice(0, ch);
	const match = beforeCursor.match(OPENING_FENCE);
	if (!match || getOpenFenceBeforeLine(lineNumber, getLine)) {
		return null;
	}

	const query = match[3];
	if (/\s/.test(query) || (match[2][0] === "`" && query.includes("`"))) {
		return null;
	}

	return {
		query,
		startCh: ch - query.length,
		endCh: findLanguageEnd(currentLine, ch, match[2][0]),
		fence: match[2],
		indent: match[1],
	};
}

function findLanguageEnd(line: string, ch: number, fenceCharacter: string): number {
	let endCh = ch;
	while (endCh < line.length && !/\s/.test(line[endCh])) {
		if (fenceCharacter === "`" && line[endCh] === "`") {
			break;
		}
		endCh += 1;
	}
	return endCh;
}

export function buildCodeBlockInsertion(
	prefix: string,
	suffix: string,
	selection: string,
): EditorInsertion {
	const canUseExistingIndent = /^ {0,3}$/.test(prefix);
	const indent = canUseExistingIndent ? prefix : "";
	const leadingNewline = prefix.length > 0 && !canUseExistingIndent ? "\n" : "";
	const trailingNewline = suffix.length > 0 && suffix.trim().length > 0 ? "\n" : "";
	const body = selection ? `\n${selection}\n` : "\n\n";

	return {
		text: `${leadingNewline}\`\`\`${body}${indent}\`\`\`${trailingNewline}`,
		lineOffset: leadingNewline ? 1 : 0,
		cursorCh: indent.length + 3,
	};
}

export function planFenceCompletion(
	openingLine: number,
	openingLineText: string,
	lastLine: number,
	getLine: (line: number) => string,
	fence: string,
	indent: string,
): FenceCompletionPlan {
	const nextLine = openingLine + 1;
	let closingLine: number | null = null;
	const isMatchingClosingFence = (line: string): boolean => {
		const match = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
		return Boolean(
			match &&
			match[2][0] === fence[0] &&
			match[2].length >= fence.length,
		);
	};

	if (nextLine <= lastLine && getLine(nextLine).length === 0) {
		const followingLine = nextLine + 1;
		if (
			followingLine <= lastLine &&
			isMatchingClosingFence(getLine(followingLine))
		) {
			return { insertion: null, cursor: { line: nextLine, ch: 0 } };
		}

		return {
			insertion: {
				line: nextLine,
				ch: 0,
				text: `\n${indent}${fence}`,
			},
			cursor: { line: nextLine, ch: 0 },
		};
	}

	for (let line = nextLine; line <= lastLine; line += 1) {
		const lineText = getLine(line);
		if (isMatchingClosingFence(lineText)) {
			closingLine = line;
			break;
		}

		const possibleOpeningFence = lineText.match(OPENING_FENCE);
		if (
			possibleOpeningFence &&
			possibleOpeningFence[2][0] === fence[0] &&
			possibleOpeningFence[3].trim().length > 0
		) {
			break;
		}
	}

	if (closingLine === nextLine) {
		return {
			insertion: { line: nextLine, ch: 0, text: "\n" },
			cursor: { line: nextLine, ch: 0 },
		};
	}

	if (closingLine !== null) {
		return { insertion: null, cursor: { line: nextLine, ch: 0 } };
	}

	return {
		insertion: {
			line: openingLine,
			ch: openingLineText.length,
			text: `\n\n${indent}${fence}`,
		},
		cursor: { line: nextLine, ch: 0 },
	};
}

export function buildLanguageCompletionChanges(
	language: string,
	start: { line: number; ch: number },
	end: { line: number; ch: number },
	plan: FenceCompletionPlan,
): EditorTextChange[] {
	const languageChange: EditorTextChange = {
		from: start,
		to: end,
		text: language,
	};
	if (!plan.insertion) {
		return [languageChange];
	}

	if (plan.insertion.line === end.line) {
		const originalInsertionCh =
			plan.insertion.ch - language.length + (end.ch - start.ch);
		if (originalInsertionCh === end.ch) {
			return [
				{
					...languageChange,
					text: language + plan.insertion.text,
				},
			];
		}

		return [
			languageChange,
			{
				from: { line: plan.insertion.line, ch: originalInsertionCh },
				text: plan.insertion.text,
			},
		];
	}

	return [
		languageChange,
		{
			from: { line: plan.insertion.line, ch: plan.insertion.ch },
			text: plan.insertion.text,
		},
	];
}

export function buildLanguageList(additionalLanguages: string): string[] {
	const seen = new Set<string>();
	return additionalLanguages
		.split(/[,\n]/)
		.map((language) => language.trim())
		.filter(Boolean)
		.concat(DEFAULT_LANGUAGES)
		.filter((language) => {
			const key = language.toLowerCase();
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
}

export function buildLanguageAliases(
	customAliases: string,
): ReadonlyMap<string, string> {
	const aliases = new Map<string, string>(DEFAULT_LANGUAGE_ALIASES);
	for (const entry of customAliases.split(/[,\n]/)) {
		const separator = entry.indexOf("=");
		if (separator < 1) {
			continue;
		}
		const alias = entry.slice(0, separator).trim().toLowerCase();
		const language = entry.slice(separator + 1).trim();
		if (alias && language && !/\s/.test(alias) && !/\s/.test(language)) {
			aliases.set(alias, language);
		}
	}
	return aliases;
}

function subsequenceDistance(value: string, query: string): number | null {
	let queryIndex = 0;
	let firstMatch = -1;
	let lastMatch = -1;
	for (let index = 0; index < value.length && queryIndex < query.length; index += 1) {
		if (value[index] === query[queryIndex]) {
			if (firstMatch < 0) {
				firstMatch = index;
			}
			lastMatch = index;
			queryIndex += 1;
		}
	}
	if (queryIndex !== query.length) {
		return null;
	}
	return lastMatch - firstMatch + 1 - query.length;
}

export function rankLanguageSuggestions(
	languages: readonly string[],
	aliases: ReadonlyMap<string, string>,
	query: string,
	recentLanguages: readonly string[],
): LanguageSuggestion[] {
	const candidates = [...languages];
	const seen = new Set(candidates.map((language) => language.toLowerCase()));
	for (const language of aliases.values()) {
		if (!seen.has(language.toLowerCase())) {
			seen.add(language.toLowerCase());
			candidates.push(language);
		}
	}

	const normalizedQuery = query.trim().toLowerCase();
	const recentRanks = new Map(
		recentLanguages.map((language, index) => [language.toLowerCase(), index]),
	);
	const aliasesByLanguage = new Map<string, string[]>();
	for (const [alias, language] of aliases) {
		const key = language.toLowerCase();
		aliasesByLanguage.set(key, [...(aliasesByLanguage.get(key) ?? []), alias]);
	}

	return candidates
		.map((language, originalIndex) => {
			const normalizedLanguage = language.toLowerCase();
			const languageAliases = aliasesByLanguage.get(normalizedLanguage) ?? [];
			let score = normalizedQuery ? Number.POSITIVE_INFINITY : 100;
			let matchedAlias: string | undefined;

			if (normalizedLanguage === normalizedQuery) {
				score = 0;
			} else {
				const exactAlias = languageAliases.find((alias) => alias === normalizedQuery);
				if (exactAlias) {
					score = 1;
					matchedAlias = exactAlias;
				} else if (normalizedLanguage.startsWith(normalizedQuery)) {
					score = 10;
				} else {
					const prefixAlias = languageAliases.find((alias) =>
						alias.startsWith(normalizedQuery),
					);
					if (prefixAlias) {
						score = 11;
						matchedAlias = prefixAlias;
					} else if (normalizedLanguage.includes(normalizedQuery)) {
						score = 20;
					} else {
						const substringAlias = languageAliases.find((alias) =>
							alias.includes(normalizedQuery),
						);
						if (substringAlias) {
							score = 21;
							matchedAlias = substringAlias;
						} else {
							const languageDistance = subsequenceDistance(
								normalizedLanguage,
								normalizedQuery,
							);
							const aliasMatches = languageAliases
								.map((alias) => ({
									alias,
									distance: subsequenceDistance(alias, normalizedQuery),
								}))
								.filter(
									(match): match is { alias: string; distance: number } =>
										match.distance !== null,
								)
								.sort((left, right) => left.distance - right.distance);
							if (languageDistance !== null) {
								score = 30 + languageDistance;
							} else if (aliasMatches[0]) {
								score = 40 + aliasMatches[0].distance;
								matchedAlias = aliasMatches[0].alias;
							}
						}
					}
				}
			}

			return {
				language,
				matchedAlias,
				score,
				recentRank: recentRanks.get(normalizedLanguage) ?? Number.MAX_SAFE_INTEGER,
				originalIndex,
			};
		})
		.filter((suggestion) => Number.isFinite(suggestion.score))
		.sort(
			(left, right) =>
				left.score - right.score ||
				left.recentRank - right.recentRank ||
				left.originalIndex - right.originalIndex,
		)
		.map(({ language, matchedAlias }) => ({ language, matchedAlias }));
}

export function updateRecentLanguages(
	recentLanguages: readonly string[],
	language: string,
	limit = 5,
): string[] {
	return [
		language,
		...recentLanguages.filter(
			(recent) => recent.toLowerCase() !== language.toLowerCase(),
		),
	].slice(0, limit);
}

export function findConflictingPluginIds(
	enabledPluginIds: Iterable<string>,
): string[] {
	const enabled = new Set(enabledPluginIds);
	return CONFLICTING_PLUGIN_IDS.filter((pluginId) => enabled.has(pluginId));
}
