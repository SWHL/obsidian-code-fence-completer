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

interface OpenFence {
	character: "`" | "~";
	length: number;
}

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/;

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
			if (character === "`" && suffix.includes("`")) {
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

export function filterLanguages(
	languages: readonly string[],
	query: string,
	lastUsedLanguage: string,
): string[] {
	const normalizedQuery = query.toLowerCase();
	const suggestions = languages.filter((language) =>
		language.toLowerCase().startsWith(normalizedQuery),
	);
	const lastUsedIndex = suggestions.findIndex(
		(language) => language.toLowerCase() === lastUsedLanguage.toLowerCase(),
	);

	if (!lastUsedLanguage || lastUsedIndex <= 0) {
		return suggestions;
	}

	return [
		suggestions[lastUsedIndex],
		...suggestions.filter((_, index) => index !== lastUsedIndex),
	];
}
