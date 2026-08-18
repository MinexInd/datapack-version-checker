# Documentation

This is the documentation for minexind.github.io. For a quick overview, see [README.md](README.md).

## About

Minex Datapack IDE is a browser-based toolkit for Minecraft datapacks. The repo contains the IDE (`web/`) and the version-checker engine (`src/`).

## Features

### Code Editor
Monaco-based editing with SpyglassMC IntelliSense, syntax highlighting, and real-time diagnostics for JSON, mcfunction, and SNBT.

### Form Editors
Form-based editing for pack.mcmeta, recipes, loot tables, predicates, advancements, and tags.

### Visual Editor
Node-based .mcfunction editor using React Flow. Build logic by connecting nodes, then compile to commands. Decompile existing functions to edit them visually.

### Version Checker
Analyze datapacks for cross-version compatibility. Rule-based diagnostics with auto-fix.

## Usage

### Files
Use the file tree on the left to navigate your datapack. Right-click to create, rename, or delete files.

### Editing
Open any file to edit it. JSON and mcfunction files open in the code editor. Some files have form editors. .mcfunction files can also open in the Visual Editor.

### Export
Press Ctrl/Cmd + S to export your pack as a ZIP file.

## Development

```bash
npm install
npm run dev
npm run build
npm test
```

End-to-end tests are in `web/e2e/` using Playwright.

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

## Browser Support

Chrome/Edge 90+, Firefox 88+, Safari 14+.

## Known Limitations

- Terminal panel is read-only
- SpyglassMC needs network access
- Visual Editor compiles one function at a time

## Roadmap

- Multi-function visual editing
- Real terminal (xterm.js)
- Git integration
- Theme customization

## Credits

- [Visual Studio Code](https://code.visualstudio.com/) (MIT)
- [misode/misode.github.io](https://github.com/misode/misode.github.io)
- [SpyglassMC](https://spyglassmc.com/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [React Flow](https://reactflow.dev/)

## License

MIT — see [LICENSE.md](LICENSE.md).
