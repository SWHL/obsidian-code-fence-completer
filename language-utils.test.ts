import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";

import {
	buildCodeBlockInsertion,
	buildLanguageAliases,
	buildLanguageCompletionChanges,
	buildLanguageList,
	findCodeFenceAtLine,
	findConflictingPluginIds,
	findLanguageTrigger,
	planFenceCompletion,
	rankLanguageSuggestions,
	updateRecentLanguages,
} from "./language-utils";

function triggerFor(lines: string[], line = lines.length - 1) {
	return findLanguageTrigger(line, lines[line].length, (index) => lines[index]);
}

test("finds backtick and tilde language triggers", () => {
	deepEqual(triggerFor(["```type-script"]), {
		query: "type-script",
		startCh: 3,
		endCh: 14,
		fence: "```",
		indent: "",
	});
	equal(triggerFor(["  ~~~~c++"])?.query, "c++");
	equal(triggerFor(["```c#"])?.query, "c#");
});

test("replaces the complete language identifier when the cursor is in it", () => {
	deepEqual(findLanguageTrigger(0, 7, () => "```javascript"), {
		query: "java",
		startCh: 3,
		endCh: 13,
		fence: "```",
		indent: "",
	});
});

test("preserves info string attributes after the language identifier", () => {
	deepEqual(findLanguageTrigger(0, 5, () => "```py title=demo linenums"), {
		query: "py",
		startCh: 3,
		endCh: 5,
		fence: "```",
		indent: "",
	});
});

test("rejects invalid or non-fence lines", () => {
	equal(triggerFor(["text ```js"]), null);
	equal(triggerFor(["    ```js"]), null);
	equal(triggerFor(["```java script"]), null);
	equal(triggerFor(["``js"]), null);
});

test("does not trigger on a closing fence", () => {
	equal(triggerFor(["```js", "const value = 1;", "```"]), null);
	equal(triggerFor(["~~~js", "value", "~~~~"]), null);
});

test("triggers again after a fenced block has closed", () => {
	equal(triggerFor(["```js", "value", "```", "```py"])?.query, "py");
});

test("builds a case-insensitive, comma-or-line-separated language list", () => {
	const languages = buildLanguageList("Vue\nC++, javascript, vue");
	deepEqual(languages.slice(0, 3), ["Vue", "C++", "javascript"]);
	equal(languages.filter((language) => language === "javascript").length, 1);
});

test("builds aliases with custom entries overriding defaults", () => {
	const aliases = buildLanguageAliases("py=python3\nrb = ruby, invalid");
	equal(aliases.get("py"), "python3");
	equal(aliases.get("rb"), "ruby");
	equal(aliases.get("js"), "javascript");
});

test("ranks exact aliases, prefixes, fuzzy matches, and recent languages", () => {
	const aliases = buildLanguageAliases("");
	deepEqual(
		rankLanguageSuggestions(
			["java", "javascript", "python", "typescript"],
			aliases,
			"py",
			[],
		).slice(0, 1),
		[{ language: "python", matchedAlias: "py" }],
	);
	deepEqual(
		rankLanguageSuggestions(
			["java", "javascript", "python", "typescript"],
			aliases,
			"jvs",
			[],
		).slice(0, 1),
		[{ language: "javascript", matchedAlias: undefined }],
	);
	deepEqual(
		rankLanguageSuggestions(
			["java", "javascript", "python"],
			aliases,
			"",
			["python", "javascript"],
		).map((suggestion) => suggestion.language),
		["python", "javascript", "java", "csharp", "markdown", "bash", "typescript", "yaml"],
	);
});

test("updates recent languages without case-insensitive duplicates", () => {
	deepEqual(updateRecentLanguages(["Python", "javascript", "bash"], "python", 3), [
		"python",
		"javascript",
		"bash",
	]);
});

test("finds the current code fence and its language range", () => {
	const lines = [
		"Text",
		"  ```python title=demo linenums",
		"value",
		"  ```",
		"After",
	];
	deepEqual(findCodeFenceAtLine(2, 4, (line) => lines[line]), {
		openingLine: 1,
		closingLine: 3,
		fence: "```",
		indent: "  ",
		infoStartCh: 5,
		languageStartCh: 5,
		languageEndCh: 11,
		language: "python",
	});
});

test("finds unclosed and language-less code fences", () => {
	const lines = ["Text", "~~~~", "value"];
	deepEqual(findCodeFenceAtLine(2, 2, (line) => lines[line]), {
		openingLine: 1,
		closingLine: null,
		fence: "~~~~",
		indent: "",
		infoStartCh: 4,
		languageStartCh: 4,
		languageEndCh: 4,
		language: "",
	});
});

test("detects only enabled conflicting plugins", () => {
	deepEqual(
		findConflictingPluginIds(["codeblock-completer", "obsidian-linter"]),
		["codeblock-completer"],
	);
});

test("builds standalone code blocks on empty and non-empty lines", () => {
	deepEqual(buildCodeBlockInsertion("", "", ""), {
		text: "```\n\n```",
		lineOffset: 0,
		cursorCh: 3,
	});
	deepEqual(buildCodeBlockInsertion("before", "after", "selected"), {
		text: "\n```\nselected\n```\n",
		lineOffset: 1,
		cursorCh: 3,
	});
	deepEqual(buildCodeBlockInsertion("  ", "", "value"), {
		text: "```\nvalue\n  ```",
		lineOffset: 0,
		cursorCh: 5,
	});
});

test("uses an existing closing fence and creates a content line", () => {
	const lines = ["```typescript", "```"];
	deepEqual(
		planFenceCompletion(0, lines[0], 1, (line) => lines[line], "```", ""),
		{
			insertion: { line: 1, ch: 0, text: "\n" },
			cursor: { line: 1, ch: 0 },
		},
	);
});

test("does not duplicate a later closing fence", () => {
	const lines = ["```typescript", "const value = 1;", "```"];
	deepEqual(
		planFenceCompletion(0, lines[0], 2, (line) => lines[line], "```", ""),
		{ insertion: null, cursor: { line: 1, ch: 0 } },
	);
});

test("inserts a closing fence before following document content", () => {
	const lines = ["  ~~~~typescript", "Following paragraph"];
	deepEqual(
		planFenceCompletion(0, lines[0], 1, (line) => lines[line], "~~~~", "  "),
		{
			insertion: { line: 0, ch: 16, text: "\n\n  ~~~~" },
			cursor: { line: 1, ch: 0 },
		},
	);
});

test("reuses an existing blank line even when later fences exist", () => {
	const lines = ["```typescript", "", "Text", "```python", "value", "```"];
	deepEqual(
		planFenceCompletion(0, lines[0], 5, (line) => lines[line], "```", ""),
		{
			insertion: { line: 1, ch: 0, text: "\n```" },
			cursor: { line: 1, ch: 0 },
		},
	);
});

test("keeps an existing empty fenced block unchanged", () => {
	const lines = ["```typescript", "", "```"];
	deepEqual(
		planFenceCompletion(0, lines[0], 2, (line) => lines[line], "```", ""),
		{ insertion: null, cursor: { line: 1, ch: 0 } },
	);
});

test("does not treat a later code block's close as the current close", () => {
	const lines = [
		"```typescript",
		"Following paragraph",
		"```python",
		"value",
		"```",
	];
	deepEqual(
		planFenceCompletion(0, lines[0], 4, (line) => lines[line], "```", ""),
		{
			insertion: { line: 0, ch: 13, text: "\n\n```" },
			cursor: { line: 1, ch: 0 },
		},
	);
});

test("applies the language and closing fence in one editor transaction", () => {
	const lines = [
		"Text before",
		"```",
		"Text after",
		"```text",
		"value",
		"```",
	];
	const plan = planFenceCompletion(
		1,
		"```python",
		5,
		(line) => lines[line],
		"```",
		"",
	);

	deepEqual(
		buildLanguageCompletionChanges(
			"python",
			{ line: 1, ch: 3 },
			{ line: 1, ch: 3 },
			plan,
		),
		[
			{
				from: { line: 1, ch: 3 },
				to: { line: 1, ch: 3 },
				text: "python\n\n```",
			},
		],
	);
});

test("keeps multi-line completion changes in one transaction", () => {
	const plan = {
		insertion: { line: 2, ch: 0, text: "\n```" },
		cursor: { line: 2, ch: 0 },
	};
	deepEqual(
		buildLanguageCompletionChanges(
			"python",
			{ line: 1, ch: 3 },
			{ line: 1, ch: 5 },
			plan,
		),
		[
			{
				from: { line: 1, ch: 3 },
				to: { line: 1, ch: 5 },
				text: "python",
			},
			{ from: { line: 2, ch: 0 }, text: "\n```" },
		],
	);
});

test("preserves info string attributes while completing and closing", () => {
	const lines = ["```py title=demo", "Following paragraph"];
	const plan = planFenceCompletion(
		0,
		"```python title=demo",
		1,
		(line) => lines[line],
		"```",
		"",
	);
	deepEqual(
		buildLanguageCompletionChanges(
			"python",
			{ line: 0, ch: 3 },
			{ line: 0, ch: 5 },
			plan,
		),
		[
			{
				from: { line: 0, ch: 3 },
				to: { line: 0, ch: 5 },
				text: "python",
			},
			{ from: { line: 0, ch: 16 }, text: "\n\n```" },
		],
	);
});
