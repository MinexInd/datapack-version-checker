# minexind.github.io

A Minecraft Datapack IDE. This repo is the source for the live site at [minexind.github.io](https://minexind.github.io).

## About

Minex Datapack IDE is a browser-based editor for Minecraft datapacks. You can write files as code, fill in forms, or build functions visually with a node editor.

The repo has two main parts:
- `web/` — the React app that runs in your browser
- `src/` — the datapack-version-checker engine (analysis, fixing, validation)

## Features

**Code editing** — Monaco editor with SpyglassMC validation and autocomplete for JSON, mcfunction, and SNBT.

**Form editors** — Friendly forms for pack.mcmeta, recipes, loot tables, predicates, advancements, and tags.

**Visual Editor** — A node-based editor for .mcfunction files. Connect blocks to build logic, then compile to commands. Or paste an existing function and decompile it back to a graph.

**Version checker** — Scan your pack for compatibility issues across Minecraft versions. The tool can auto-fix many common problems.

## Getting Started

You need Node.js 18+ and npm.

```bash
npm install
npm run dev
```

To build everything:

```bash
npm run build
npm test
```

## Project Structure

```
.
├── src/                      # datapack-version-checker engine
│   ├── analyzer.ts  fixer.ts  mcdoc-check.ts  json-check.ts
│   ├── rules.ts  knowledge.ts  resource-knowledge.ts
│   ├── spyglass-analyze.ts  server.ts  mcp-server.ts
│   └── ...
├── web/                      # the IDE
│   └── src/
│       ├── components/       # IdePage, VisualEditor, editors
│       ├── visual/core/      # compiler, decompiler, validator
│       ├── engine/           # Spyglass service, analysis
│       ├── ide/              # pack-mcmeta/mcdoc editing
│       └── styles/
├── tests/  docs/  scripts/
└── package.json
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + S | Export pack |
| Ctrl/Cmd + Shift + A | Analyze pack |
| Ctrl/Cmd + P | Quick Open |
| Ctrl/Cmd + Shift + P | Command Palette |
| Ctrl/Cmd + B | Toggle sidebar |
| Ctrl/Cmd + W | Close tab |
| Ctrl/Cmd + N | New file |
| Ctrl/Cmd + J | Toggle panel |
| Ctrl/Cmd + ` | Toggle terminal |
| Esc | Close tab / cancel |

## Tech Stack

React 18, TypeScript, Vite, Monaco Editor, SpyglassMC, React Flow (@xyflow/react), Playwright.

## Documentation

For more details, see [docs.md](docs.md).

## Credits

- [Visual Studio Code](https://code.visualstudio.com/) (MIT) — IDE UX inspiration
- [misode/misode.github.io](https://github.com/misode/misode.github.io) — reference for visual datapack editors
- [SpyglassMC](https://spyglassmc.com/) — Minecraft data parsing and validation
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — code editing
- [React Flow](https://reactflow.dev/) — node-based Visual Editor canvas

## License

MIT — see [LICENSE.md](LICENSE.md) for details.

## Contributing

Found a bug or have an idea? Pull requests and issues are welcome.
