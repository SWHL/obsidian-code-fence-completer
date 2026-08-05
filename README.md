# Code Fence Completer

Code Fence Completer provides reliable language suggestions when writing Markdown code fences in Obsidian.

## Features

- Suggests common language identifiers after opening backtick or tilde fences.
- Prioritizes the most recently selected language.
- Supports custom identifiers separated by commas or new lines.
- Supports identifiers such as `c++`, `c#`, `foo-bar`, and `foo.bar`.
- Avoids opening suggestions on closing fences.
- Inserts an empty code block, or wraps the current selection, with the **Insert code block** command.
- Works on desktop and mobile.

## Usage

Type an opening fence and start entering a language:

````markdown
```type
````

Choose a suggestion with the keyboard or pointer. The cursor moves into the code block. If there is no matching closing fence, the plugin adds one before the following document content.

You can also assign a hotkey to **Code Fence Completer: Insert code block** in Obsidian's Hotkeys settings.

## Manual installation

1. Download `main.js` and `manifest.json` from the latest release.
2. Put them in `<vault>/.obsidian/plugins/code-fence-completer/`.
3. Reload Obsidian and enable **Code Fence Completer** in Community plugins.

## Development

```bash
npm install
npm run check
```

Run `npm run dev` to rebuild while editing.

## Release

1. Run `npm version patch`, `npm version minor`, or `npm version major`.
2. Push the commit and version tag with `git push --follow-tags`.
3. The release workflow builds the plugin and attaches `main.js` and `manifest.json` to a GitHub release.

## Acknowledgements

This plugin is based on [stanley-910/obsidian-code-language-completer](https://github.com/stanley-910/obsidian-code-language-completer), originally released under the MIT License. This fork includes substantial reliability, usability, testing, and release-tooling updates.
