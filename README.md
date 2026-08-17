# minexind.github.io

A Minecraft Datapack IDE inspired by [misode.github.io](https://misode.github.io) and [VSCode](https://code.visualstudio.com/), built with React, TypeScript, and Vite.

## Features

### Visual Editors
- **pack.mcmeta Editor** - Visual editor with legacy/new-style format support, JSON text component descriptions, and version dropdown
- **Recipe Editor** - Form-based recipe editing with type detection
- **Loot Table Editor** - Visual loot table editing
- **Predicate Editor** - Condition editing with form view
- **Advancement Editor** - Advancement tree editing

### VSCode-like IDE Features
- **Command Palette** (Ctrl+Shift+P) - Quick access to all commands
- **Quick Open** (Ctrl+P) - Fuzzy file search and go to line
- **Breadcrumbs** - Navigate file paths easily
- **Terminal Panel** (Ctrl+`) - Integrated terminal output
- **Virtualized File Tree** - Smooth scrolling even with large packs
- **Context Menu** - Right-click for file operations
- **Multiple Tabs** - Open and manage multiple files
- **Split Editor** - Side-by-side editing (coming soon)
- **Problems Panel** - View errors and warnings
- **Status Bar** - File info, cursor position, version

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + S | Export pack |
| Ctrl/Cmd + Shift + A | Analyze pack |
| Ctrl/Cmd + P | Quick Open |
| Ctrl/Cmd + Shift + P | Command Palette |
| Ctrl/Cmd + B | Toggle Sidebar |
| Ctrl/Cmd + W | Close Tab |
| Ctrl/Cmd + N | New File |
| Ctrl/Cmd + J | Toggle Panel |
| Ctrl/Cmd + ` | Toggle Terminal |
| Ctrl/Cmd + O | Open File |
| Escape | Close tab/cancel dialog |

### Performance Optimizations
- Virtual scrolling for file tree (handles 1000+ files smoothly)
- Debounced edits and saves
- Memoized computations
- Efficient React rendering with proper dependency arrays
- Stale closure fixes for real-time updates

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Monaco Editor** - Code editing
- **SpyglassMC** - Minecraft data parsing and validation
- **CSS Modules** - Styling

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
web/src/
├── components/
│   ├── IdePage.tsx          # Main IDE component
│   ├── McmetaEditor.tsx     # pack.mcmeta visual editor
│   ├── McdocEditor.tsx      # Generic mcdoc form editor
│   ├── CommandPalette.tsx   # VSCode-like command palette
│   ├── QuickOpen.tsx        # Quick file open
│   ├── Breadcrumbs.tsx      # Path breadcrumbs
│   ├── TerminalPanel.tsx    # Terminal output panel
│   ├── VirtualizedFileTree.tsx # Virtual scrolling file tree
│   └── ContextMenu.tsx      # Right-click context menu
├── ide/
│   ├── pack-mcmeta-edit.ts  # pack.mcmeta read/write logic
│   ├── mcdoc-edit.ts        # Mcdoc form rendering
│   ├── use-mcdoc-type.ts    # Type resolution hook
│   └── presets.ts           # Recipe presets
├── engine/
│   ├── spyglass-service.ts  # SpyglassMC integration
│   ├── type-bridge.ts       # Type conversion
│   └── engine.ts            # Core engine logic
└── styles/
    ├── ide.css               # Main IDE styles
    ├── CommandPalette.css
    ├── QuickOpen.css
    ├── Breadcrumbs.css
    ├── TerminalPanel.css
    └── VirtualizedFileTree.css
```

## Credits & Acknowledgments

### VSCode
This project draws heavy inspiration from [Visual Studio Code](https://code.visualstudio.com/) (MIT License):
- File tree with virtual scrolling and filtering
- Command palette (Ctrl+Shift+P)
- Quick Open (Ctrl+P)
- Keyboard shortcut system
- Context menus
- Status bar and breadcrumbs
- Problems panel

### misode/misode.github.io
Reference implementation for visual Minecraft datapack editors:
- pack.mcmeta visual editor with legacy/new-style format support
- Recipe, loot table, predicate, and advancement form editors
- JSON text component support for descriptions

### SpyglassMC
Minecraft data parsing and validation powered by [SpyglassMC](https://spyglassmc.com/):
- Type-safe mcdoc schema parsing
- Real-time validation and diagnostics
- Version-aware type resolution

### Monaco Editor
Code editing provided by [Monaco Editor](https://microsoft.github.io/monaco-editor/):
- Syntax highlighting
- IntelliSense
- Multi-cursor editing

### Datapack Studio
The **Datapack Visual Editor** (semantic visual scripting graph that compiles to `.mcfunction`) is adapted from the [Datapack Studio](https://github.com/) project:
- Framework-agnostic Minecraft knowledge / version model (`web/src/visual/core/minecraft`)
- Data-driven node registry, layered validator, and graph compiler (`web/src/visual/core/{graph,compiler,ir,parser,decompiler}`)
- The React Flow graph UI (`web/src/components/VisualEditor.tsx`) wraps this core inside the existing Spyglass-based datapack IDE.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
