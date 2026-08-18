# 🛠️ Minex Datapack IDE

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node >=18](https://img.shields.io/badge/Node-%3E%3D18-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Vite](https://img.shields.io/badge/Vite-6.x-purple)

> **A free, browser-based editor for Minecraft datapacks — nothing to install.**
> Live site: [minexind.github.io](https://minexind.github.io)

<details>
<summary><strong>Table of contents</strong></summary>

- [What is it?](#what-is-it)
- [Features](#features)
  - [1. Smart editor](#1-smart-editor)
  - [2. Visual form editors](#2-visual-form-editors)
  - [3. Datapack Visual Editor](#3-datapack-visual-editor)
  - [4. Version compatibility checker](#4-version-compatibility-checker)
- [How to use it](#how-to-use-it)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Running it yourself](#running-it-yourself)
- [Tech stack](#tech-stack)
- [Credits](#credits)
- [License](#license)
- [Contributing](#contributing)

</details>

---

## What is it?

A **datapack** is a folder of files (mostly JSON and `.mcfunction` command scripts) that changes how Minecraft behaves — new recipes, custom loot, functions, tags, and more. Writing one by hand means memorising exact formats, getting the brackets right, and debugging why nothing runs.

**Minex Datapack IDE** takes the pain away. It gives you:

1. A proper code editor with **live error checking**.
2. **Visual form editors** for the common file types.
3. A **node-based visual builder** that turns blocks of logic into `.mcfunction` files.
4. A **version-checker** that warns you if your pack will break on a different Minecraft version — and can often fix it automatically.

This repository contains two parts:

| Path | What it is |
|------|-----------|
| `web/` | The React app you see in the browser (this is what runs minexind.github.io). |
| `src/` | The `datapack-version-checker` engine — analysis, auto-fixes, and validation, plus a CLI and an MCP server. |

---

## Features

### 1. Smart editor

Open any datapack file and you get a proper code editor (the same kind used in professional tools):

- **Live error checking** powered by SpyglassMC, so mistakes are caught as you type.
- **Autocomplete** for commands and JSON.
- Syntax highlighting for JSON, `.mcfunction`, and SNBT.

![IDE overview](docs/screenshots/ide-overview.png)

### 2. Visual form editors

Not everyone wants to hand-write JSON. For the common file types there are friendly forms:

- **pack.mcmeta** — the settings file every pack needs.
- **Recipes, Loot Tables, Predicates, Advancements, and Tags** — fill in the fields and the correct JSON is written for you.

### 3. Datapack Visual Editor

This is the fun part. Instead of writing a list of commands, you build your function as a **graph of blocks**:

- **Nodes** are the blocks. Each does one thing: run a command, check a condition, call another function, give an effect, summon an entity, and so on.
- **Ports** are the little connectors. *Flow* ports (colour-coded by category) show the order things happen; *data* ports carry values — like a selector or a number — between nodes.
- **Compile** turns your graph into a real `.mcfunction` file.
- **Decompile** does the reverse: paste an existing `.mcfunction` and get an editable graph back.

![Visual Editor](docs/screenshots/visual-editor.png)

> 💡 **Tip:** Start with a *trigger* node, connect it to actions with *flow* ports, and use *data* ports to feed values into those actions.

The editor ships with a large library of node types:

| Category | Examples |
|----------|----------|
| Flow | trigger (`function_entry`), sequence, branch (condition), function call, return |
| Execute | `execute as/at/positioned/facing/condition/...` |
| Scoreboard | set score, add score, create objective, score condition |
| Entity | summon, kill, teleport, effect, tags, damage |
| World | particle, playsound, setblock, fill, clone, weather, time |
| Data | set, get, modify, remove |
| Values | selectors, numbers, positions, objectives |
| Utility | custom command (escape hatch), comment |

Invalid setups are flagged before you compile, so you won't waste time writing broken files.

### 4. Version compatibility checker

Datapacks sometimes break when Minecraft updates. Press **Ctrl/Cmd + Shift + A** and the tool scans your pack for things that might not work in a chosen version — and can often **fix them for you automatically**.

---

## How to use it

1. Go to **minexind.github.io**.
2. Use the file tree on the left to create or open a file in your datapack.
3. Edit it with the code editor, a form, or the Visual Editor.
4. Press **Ctrl/Cmd + Shift + A** to analyze your pack, and **Ctrl/Cmd + S** to export it as a `.zip` you can drop into your `saves/<world>/datapacks` folder.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Export pack (ZIP) |
| `Ctrl/Cmd + Shift + A` | Analyze pack |
| `Ctrl/Cmd + P` | Quick Open (find a file) |
| `Ctrl/Cmd + Shift + P` | Command Palette |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `Ctrl/Cmd + W` | Close tab |
| `Ctrl/Cmd + N` | New file |
| `Ctrl/Cmd + J` | Toggle bottom panel |
| `Ctrl/Cmd + `` ` | Toggle terminal / log |
| `Esc` | Close tab / cancel |

---

## Running it yourself

**Prerequisites:** Node.js 18+ and npm.

```bash
npm install
npm run dev          # start the web app
npm run build        # build the engine + web app
npm test             # run the engine's tests
```

> **Note:** The IDE and Visual Editor need the SpyglassMC data service at runtime (internet access). Build the web app with `cd web && npm install && npm run build`.

---

## Tech stack

| Layer | Tools |
|-------|-------|
| UI / Framework | React 18, TypeScript |
| Build | Vite |
| Editor | Monaco Editor |
| Visual Editor | React Flow (`@xyflow/react`) |
| Validation | SpyglassMC (`@spyglassmc/*`) |
| Testing | Playwright (e2e), Vitest (unit) |

---

## Credits

This project stands on the shoulders of some excellent open-source work:

| Project | What it provides | License |
|---------|------------------|---------|
| [Visual Studio Code](https://code.visualstudio.com/) | IDE UX inspiration (command palette, quick open, breadcrumbs, problems panel) | MIT |
| [misode / misode.github.io](https://github.com/misode/misode.github.io) | Reference for visual datapack editors | MIT |
| [SpyglassMC](https://spyglassmc.com/) | Minecraft data parsing, validation, and autocomplete | MIT |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) (Microsoft) | Code editing component | MIT |
| [React Flow / @xyflow/react](https://reactflow.dev/) | Node-based Visual Editor canvas | MIT |
| [React](https://react.dev/) | UI framework | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Type safety | Apache-2.0 |
| [Vite](https://vitejs.dev/) | Build tooling | MIT |
| [Playwright](https://playwright.dev/) | End-to-end testing | Apache-2.0 |

*Minecraft is a trademark of Mojang Studios. This project is not affiliated with Mojang or Microsoft.*

---

## License

Released under the [MIT License](LICENSE.md).

## Contributing

Found a bug or have an idea? Pull requests and issues are welcome.
