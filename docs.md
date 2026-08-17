# minexind.github.io - Documentation

## Overview

minexind.github.io is a comprehensive Minecraft Datapack IDE that combines the visual editing power of misode.github.io with the advanced IDE features of VSCode. It provides a modern, browser-based development environment for creating and editing Minecraft datapacks, resource packs, and data packs.

## Architecture

### Core Components

#### IdePage.tsx
The main IDE component that orchestrates all features:
- File management (create, rename, delete, drag & drop)
- Tab management with multi-file editing
- Monaco Editor integration for raw JSON editing
- Visual editors for pack.mcmeta and mcdoc files
- Problems panel with SpyglassMC diagnostics
- Export functionality (ZIP download)
- Draft persistence with IndexedDB

#### Editors
- **McmetaEditor.tsx**: Visual pack.mcmeta editor with:
  - Legacy vs new-style format switching
  - Version dropdown with correct cutoffs (datapack >= 82, resource pack >= 65)
  - JSON text component support for descriptions
  - Custom format input
  - Real-time validation

- **McdocEditor.tsx**: Generic mcdoc form editor for:
  - Recipes (with preset picker)
  - Loot tables
  - Predicates
  - Advancements
  - Any mcdoc-defined format

### IDE Features

#### Command Palette (Ctrl+Shift+P)
Quick access to all IDE commands:
- Export Pack
- Analyze Pack
- Reset Pack
- New File
- Toggle Sidebar
- Close Tab
- Clear Pack

#### Quick Open (Ctrl+P)
- Fuzzy file search
- Recent files
- Go to line number

#### Virtualized File Tree
- Smooth scrolling with 1000+ files
- File filtering
- Context menu (right-click)
- Drag and drop support
- Inline rename/delete actions

#### Terminal Panel (Ctrl+`)
- Displays log output from IDE operations
- Command history
- Auto-scroll to latest output

#### Keyboard Shortcuts
Full VSCode-inspired keyboard shortcut system:
- **Ctrl/Cmd + S**: Export pack
- **Ctrl/Cmd + Shift + A**: Analyze pack
- **Ctrl/Cmd + P**: Quick Open
- **Ctrl/Cmd + Shift + P**: Command Palette
- **Ctrl/Cmd + B**: Toggle sidebar
- **Ctrl/Cmd + W**: Close tab
- **Ctrl/Cmd + N**: New file
- **Ctrl/Cmd + J**: Toggle bottom panel
- **Ctrl/Cmd + `**: Toggle terminal
- **Escape**: Close tab or cancel dialog

### Performance Optimizations

1. **Virtual Scrolling**: File tree renders only visible rows + overscan buffer
2. **Debounced Edits**: 100ms debounce on Monaco edits, 600ms on draft saves
3. **Memoization**: useMemo for expensive computations (tree building, problem grouping)
4. **Stale Closure Fixes**: Refs track latest state to avoid unnecessary re-subscriptions
5. **Efficient Re-renders**: Proper dependency arrays minimize re-renders

### Data Flow

```
User Input → Local State (debounced) → App State → Monaco/Visual Editor → SpyglassMC → UI Update
```

- Free-text inputs (description, custom format) use local state with debounced commits
- Monaco edits sync to App state via onEditedFilesChange
- Visual editors commit via writeMcmeta/writeMcdoc functions
- SpyglassMC provides real-time validation and type resolution

## Credits

### VSCode (MIT License)
[Visual Studio Code](https://code.visualstudio.com/) by Microsoft Corporation

This project implements several UI/UX patterns inspired by VSCode:
- Command palette UI and interaction model
- Quick Open with fuzzy search
- Keyboard shortcut system architecture
- Context menu design and behavior
- File tree virtualization approach
- Status bar and breadcrumbs layout
- Problems panel grouping

VSCode is licensed under the MIT License. See [VSCode License](https://github.com/microsoft/vscode/blob/main/LICENSE.txt) for details.

### misode/misode.github.io
[misode/misode.github.io](https://github.com/misode/misode.github.io)

Reference implementation for visual Minecraft datapack editors:
- pack.mcmeta editor design with legacy/new-style format support
- Form-based recipe, loot table, predicate, and advancement editors
- JSON text component support in descriptions
- Version dropdown with correct Minecraft version cutoffs
- Preset picker for vanilla recipes

### SpyglassMC
[SpyglassMC](https://spyglassmc.com/) - Minecraft data parsing and validation

Key integrations:
- `@spyglassmc/mcdoc` - Mcdoc type system and parsing
- `@spyglassmc/cli` - CLI utilities (referenced in architecture)
- Type resolution for recipes, loot tables, predicates, and advancements
- Real-time diagnostics and validation

### Monaco Editor
[Monaco Editor](https://microsoft.github.io/monaco-editor/) by Microsoft

- Core code editing component
- Syntax highlighting for JSON, mcfunction, SNBT
- IntelliSense and auto-completion
- Multi-cursor editing
- Minimap and breadcrumbs (when available)

### React & Ecosystem
- [React](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tooling

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires modern JavaScript features (ES2020) and CSS Grid/Flexbox.

## Known Limitations

- Build verification currently blocked by network timeouts (npm install)
- Some Monaco Editor features (minimap, code actions) require additional setup
- Terminal panel is read-only (no actual shell execution)
- Split editor view is planned but not yet implemented
- Large packs (>1000 files) may experience performance issues without virtual scrolling

## Future Enhancements

- [ ] Actual terminal integration (xterm.js)
- [ ] Split editor view
- [ ] Git integration
- [ ] Extension system
- [ ] Theme customization
- [ ] Plugin architecture
- [ ] Offline support with Service Workers
- [ ] Collaborative editing

## License

MIT License - see LICENSE file for details.

---

*This project is not affiliated with Mojang Studios, Microsoft, or the VSCode team. It is an independent implementation inspired by their work.*
