# Antigravity Session Preview

A lightweight, real-time editorial **Session & Markdown Previewer** plugin for **Google Antigravity CLI (`agy`)** and **Antigravity 2.0**.

Transform dense terminal streams, 1,000+ step agent trajectories, LaTeX math, wide benchmark tables, and local Markdown documentation into a calm, customizable reading workspace.

![Session Preview & 2x8 Theme Menu](docs/screenshots/session-themes-lavender.png)

## Highlights

- **Unified `Preferences` Menu, Multi-Candidate Custom RGB Palettes & Multilingual Typography**:
  - Single persistent **`Preferences ▾`** dropdown placed directly to the left of `↻ Sync`, consolidating **Language (`English` default / `简体中文`)**, **Font Size (`− / 15px / + / ↺ Reset` proportional stage scaling)**, **Collapsible Font Picker** (`Sans`, `Serif`, `Times New Roman` in `English`, and split **English Font × Chinese Font** (`默认黑体`, `华文宋体`, `楷体`, `仿宋`) pairing in `简体中文` mode), **Layout (`Width: Normal / Wide`, `Tables: Fit / Expand`)**, **2 Appearance Modes (`Light` / `Dark`)**, **8 Curated Color Palettes**, and **Multiple Named Custom RGB Palettes** (`+ New Custom RGB`, inline `✎` rename, and live `Background` + `Accent` RGB studio persisted across windows).
- **Server Password Protection (Optional, Disabled by Default)**:
  - Secure remote or shared server deployments (`--host 0.0.0.0`) via `agy-preview password <set | cancel | disable | activate | print>` or `/preview password ...`, backed by `HttpOnly` HMAC-signed session cookies and rate-limited login.
- **Auto-Folded Execution, Live Steps Checklist & Three-State Session Status**:
  - Star (`☆ / ★`) important conversations in the Preview topbar to keep them in a dedicated **`★ Pinned`** shelf above all workspace projects. **`⊟ Collapse all`** (`折叠项目&会话`) folds every project folder and hides sessions older than three days; **`⊞ Expand`** opens the folders again and leaves those older sessions collapsed.
  - **Calm Session & Decision Indicators**: neutral Apple-style 12-spoke activity spinner while a session is running (with live command output tailing), **`⏳ Awaiting Decision`** alerts + inline `ask_question` / `exit_plan_mode` option cards when CLI awaits your input, clean **`interrupted`** state when a turn is canceled, and an accent **`Unread`** dot only for sessions you can already see. Reading the open session, or watching it until it stops, clears that highlight.
  - Renders live `update_steps` progress checklists above each turn's **`Execution process`** fold without collapsing open inspection cards mid-turn, and jumps straight to your **latest user prompt** on open.
  - Each turn has **`Save` / `Copy prompt` / `Copy response`** (`收藏` / `复制提问` / `复制回复`). Save stores the whole turn, including tool calls, under the preview data directory. Open it again from **`Saved Turns`** in the top-left source menu. Prompts longer than 8 lines or 480 characters fold to 6 lines. Heading-less replies still get an Outline jump target from their opening words. The right file sidebar and `/btw` · `/context` · `/usage` stay independent per conversation.
  - Each `/schedule` wakeup is its own turn, titled **`定时巡检 #N`** on the card and in the Outline, so earlier checks stay visible. User-turn numbers still count only user messages.
  - Full-text search across project names, session titles, and **all historical user prompts** (powered by `node:sqlite` FTS5).
- **Built-in `/btw` · `/context` · `/usage` Inspector**:
  - **`/context`**: 10×10 proportional context-window grid, token breakdown by category (`System`, `User`, `Agent`, `Tools`, `Free`, `Checkpoints`), prompt cache hit rate, and tracked session artifacts.
  - **`/usage`**: Rolling **5-Hour** & **7-Day** local token usage grouped by model family (`Gemini` vs `Claude / GPT`) alongside per-model session tables.
  - **`/btw`**: Surfaces CLI `/btw` side questions from `history.jsonl` and lets you pin `/copy btw` Markdown answers directly to the conversation. Each card can be saved, including the answer and the fork’s tool calls when that transcript is still on disk.
- **Theme-Native `PDF.js` & Office Suite (`Word`, `Excel`, `PowerPoint`) + Rich Media Previews**:
  - Custom offline **`PDF.js` Viewer** matching all `2 × 8 + Custom RGB` themes (HiDPI canvas, selectable text layer, collapsible thumbnails, `#page=N`, `Fit Width / Page`, 90° rotate, and **`◐ Tint` dark-paper filter**), **Word (`.docx` / `.doc`)** paper layout, **Excel (`.xlsx` / `.xls` / `.ods`)** multi-sheet sticky-header viewer with instant row filtering, and **PowerPoint (`.pptx` / `.ppt`)** hybrid slide deck viewer (local Office/LibreOffice vector PDF cache + built-in pure-JS OOXML slide fallback), alongside HTTP `206` **Video**, **Audio**, **CSV/TSV**, **Images**, and **Code** (`#L16-L20` line-range highlighting) + foreground **`📂 Folder`**.
  - Dedicated **`Docs / Clips`** workspace persisted in OS user data (`%APPDATA%/agy-session-preview` on Windows, `~/Library/Application Support/agy-session-preview` on macOS, `~/.local/share/agy-session-preview` on Linux; legacy `agy-markdown-preview` data is automatically migrated) featuring pointer-hover previews, drag-and-drop sorting, inline renaming, and cross-platform native file picking.
- **Publication-Grade Offline Markdown & Adaptive Mermaid v12 ELK**:
  - Zero-CDN offline `marked` + `highlight.js` + `KaTeX` (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) + **Mermaid v12 (`ELK` orthogonal port routing, rounded 90° elbows, multi-stage pastel pills, adaptive horizontal-fill inline sizing + `↔ Expand` full-viewport toggle, interactive pan/zoom, edge/corner user-resizable fullscreen modal with `↔ Fit Width` & `100%` full-window toggle, and vector SVG export)**.
  - Accurate GitHub & Obsidian Alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), CJK bold punctuation fix, and **wide tables**: `Tables: Fit` sizes each column inside the reading pane so one long cell wraps instead of setting the width, and `Tables: Expand` still grows naturally up to `30vw` per column.

## Screenshots

### Mermaid v12 + ELK Orthogonal Pastel Renderer & Fullscreen Interactive Canvas

![Mermaid v12 ELK Fullscreen Canvas](docs/screenshots/mermaid-elk-fullscreen.png)

### Dark Mode & `/context` Window Visualization

![Dark Mode and /context Inspector](docs/screenshots/context-dark.png)

### `Docs / Clips` Workspace & Split Code Preview (`#L16-L20`, Blush Sakura Palette)

![Docs / Clips and Split Code Preview](docs/screenshots/docs-split-sakura.png)

---

## Installation

### Option 1 — One-Command Install via `agy` (Recommended)

Because offline vendor assets (`KaTeX`, `Mermaid`, `highlight.js`, `marked`) are pre-bundled in `public/vendor/`, you can install directly from GitHub with zero build steps:

```bash
agy plugin install https://github.com/ChengzhuUwU/antigravity-session-preview
```

### Option 2 — Local Clone & Global `agy-preview` CLI Shim

```bash
git clone https://github.com/ChengzhuUwU/antigravity-session-preview.git
cd antigravity-session-preview

# Installs plugin to ~/.gemini/config/plugins/agy-session-preview
# and registers the `agy-preview` command into ~/.local/bin
npm run install-plugin
```

Verify installation:

```bash
agy plugin validate --strict ~/.gemini/config/plugins/agy-session-preview
agy plugin list
```

---

## Usage

### 1. Standalone CLI (`agy-preview`)

```bash
# Open or focus the standalone desktop preview window
agy-preview

# Preview a specific conversation ID (add --focus to switch an already-open window immediately)
agy-preview --conv <CONVERSATION_ID> --focus

# Preview and live-watch any local Markdown or JSONL file
agy-preview README.md

# Pipe `agy -p --output-format stream-json` directly into the previewer
agy -p "Audit this module" --output-format stream-json | agy-preview --stdin

# Check background server status, restart in-place, or stop it
agy-preview --status
agy-preview --restart
agy-preview --stop

# Replace the installed plugin with the latest GitHub release (user data stays put)
agy-preview update

# Manage optional frontend password (for remote servers, disabled by default)
agy-preview password set <PASSWORD>
agy-preview password print
agy-preview password disable
agy-preview password activate
agy-preview password cancel
```

### 2. Inside Antigravity CLI (`agy`) or Antigravity 2.0

- Run `/preview` (or `/agy-session-preview:preview`) to launch/focus the live preview window for the active conversation.
- In Antigravity 2.0 Desktop, open the native Side Pane (`sidecar://agy-session-preview/preview/`).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `R` | Sync active session or document immediately |
| `Ctrl+B` / `Cmd+B` | Toggle left project & docs sidebar |
| `O` | Toggle right Outline (TOC) drawer |
| `T` | Toggle `Light` / `Dark` brightness mode (keep active color palette) |
| `W` | Toggle reading column width (`Normal` / `Wide`) |
| `F` | Toggle prose typography (`Sans` / `Serif`) |
| `P` | Open local file / paste Markdown or `stream-json` modal |
| `Ctrl+K` or `/` | Find across user prompts and rendered Markdown |
| `Esc` | Close theme menu, preview modal, search bar, or split sidebar |

---

## Development & Packaging

```bash
# Run unit & integration test suite (Node >= 22.5 built-in test runner + SQLite)
npm test

# Re-sync vendor assets from node_modules (optional when upgrading libraries)
npm install && npm run sync-vendor

# Package distributable plugin archive -> dist/agy-session-preview.zip
npm run pack-plugin
agy plugin validate --strict dist/agy-session-preview.zip
```

## License

Released under the [MIT License](LICENSE).
