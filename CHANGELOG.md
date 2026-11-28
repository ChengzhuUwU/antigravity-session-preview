# Changelog

All notable changes to **Antigravity Session Preview (`agy-session-preview`)** will be documented in this file.

## [Unreleased]

## [0.4.3] - 2026-11-29

### Added
- **Saved turns**: `收藏` / `Save`, to the left of `复制提问` / `Copy prompt`, stores that turn’s full interaction, including tool calls, under the preview data directory (`saved-turns/`). The same button on a `/btw` card stores that side question, its answer, and the fork’s tool calls when that transcript is still on disk. The top-left source menu gains `Saved Turns` for reading them back. Saving tells you to open that menu.

### Changed
- **Collapse projects & sessions**: `折叠项目&会话` folds every project folder and hides sessions older than 3 days inside them. `展开项目` opens the folders again and leaves those older sessions collapsed.
- **Tables: Fit column widths**: Fit now sizes each column from its own text. One long cell wraps instead of setting the column, leftover pane width goes to columns that are still wrapping, and a cell that still runs past five lines can be expanded. `Tables: Expand` is unchanged, including the `30vw` column cap.

### Fixed
- **Stale project unread dot**: Opening a session, or watching it while it runs, keeps that step count as read. A run that then stops without new steps no longer lights the project again. The project dot follows sessions you can already see. A collapsed subagent or a session behind "older" keeps its own dot instead of leaving the project highlighted after those visible sessions are read.

## [0.4.2] - 2026-11-28

### Added
- **Cross-Platform Native File Dialog**: `POST /api/pick-file` uses the dialog that ships with the OS — Windows PowerShell, macOS `osascript`, and on Linux the first of `zenity`, `kdialog`, `qarma`, or `yad`. `GET /api/file-picker` reports whether one is available. When none is, `📂 Browse…` is hidden and the Docs empty hints no longer point at it.
- **Frozen Sidebar Order for the Open Window**: After the preview window opens, project folders and the sessions inside them keep their order while messages arrive. A project that appears later is inserted at the top. A new session inside an existing project is appended. `Unassigned` stays last. The order resets when the window is opened again. Pinned sessions still follow star order.
- **Markdown Source View**: Markdown documents, the right file pane, and the popup preview can switch between `Rendered` / `Source` (`预览` / `源文`). The choice is remembered. Switching keeps the text at the center of the viewport aligned to the same passage.
- **Outline Fallback for Heading-less Replies**: When a final assistant message or a Docs/Clips page has no `#`–`######` heading, the right Outline still shows one jump target taken from the opening words (`outlineLeadLabel`; CJK characters count as one unit, Latin words stay whole). Real headings, including `h4`–`h6` clamped to outline level 3, still take priority.
- **Per-Turn `Copy prompt` / `Copy response` and Long-Prompt Fold**: Each user card can copy the plain-text user prompt and the final model response separately (`复制提问` / `复制回复`). The response copy includes the visible reply and decision plan/questions, and excludes intermediate execution-process chatter. Prompts longer than 8 lines or 480 characters collapse to 6 lines with `Show more` / `Show less` (`展开` / `收起`).
- **Per-Conversation File Sidebar and Tools Panel**: Switching sessions stashes and restores that conversation’s right split pane (open file or folder, plus back/forward history) and its `/btw` · `/context` · `/usage` tab. A session that never opened them stays closed, and the previous session’s tool content is hidden immediately so it cannot flash on the next conversation. Memory lasts for the current page only.
- **Scheduled Checks as Their Own Turns**: A `/schedule` wakeup is its own prompt-and-reply section instead of being folded into the previous user turn. The card and Outline title are `定时巡检 #N` when the prompt already names one, otherwise `定时巡检` plus the wakeup order. User-turn numbers (`You · Turn #` / `你 · 第 # 轮`) still count only user messages. Task-finished and “still running” notices stay inside `Execution process`.

### Fixed
- **Lone Approximation Tildes**: A single `~` (as in `~17 ep`) is shown literally. Marked otherwise pairs two of them as strikethrough and draws a line through the text between them. Real strikethrough remains `~~text~~`.
- **Rewritten Session Logs**: `TranscriptReader` treats a changed file head, or a same-length rewrite, as a new transcript and drops the cached steps. A `/rewind` that replaces the log no longer leaves the removed messages appended after the new text.

### Changed
- **Expanded Table Columns**: `Tables: Expand` still sizes columns from their content, and one column now stops at `30vw` (previously `50vw`). `Tables: Fit` is unchanged. A per-column Fit width was tried and reverted; the requirement is kept in `HANDOFF.md`.

## [0.4.1] - 2026-11-26

### Added
- **Interactive User Decision Prompts (`ask_question` & `exit_plan_mode`)**:
  - Detects pending user decisions (`activeStatus: 'waiting_decision'`) instead of leaving sessions in a generic `Thinking…` / `Working…` state.
  - Renders structured inline **Decision Required / Plan Review Required** cards (single-choice & multi-select badges, `(Recommended)` highlights, proposed plan Markdown preview, and answered option summaries with decision wait duration), keeps accompanying lead-in Markdown visible outside `Execution process`, and surfaces **`⏳ Awaiting Decision` (`⏳ 等待你的决策`)** across topbar, sidebar session/folder rows, and jump/switch toast alerts.
- **Explicit `--focus` Flag & Responsive Left-Sidebar Collapse Button**:
  - Added `agy-preview --focus` (`force: true`) to switch an already-open Preview window on explicit user command while converting background CLI/hook notifications (`force: false`) into a non-intrusive switch prompt toast.
  - Replaced the static `S` badge in the left sidebar header with `#sidebar-collapse-btn`, paired at the exact same top-left coordinates with `#sidebar-toggle-btn` when collapsed so narrow windows (`<= 860px`) never hide the sidebar toggle.

### Fixed
- **Interrupted / Canceled Turn State & Execution Copy**:
  - Combined Hook `Stop` (`terminationReason: "USER_CANCELED"`) and SQLite `conversation_summaries.db` run-state checks (`getConversationRunState`) with `TranscriptReader` cache invalidation so turns interrupted via `Esc` / `Ctrl+C` (which do not append a new JSONL line) immediately stop spinning, mark unexecuted queued tool calls as `interrupted` (`已中断`), and display a clear interrupted notice when no final response was generated.
  - Preserved real-time live command output tailing (`6400`-byte window, `Live Command Output` / `实时命令输出`) while replacing conflicting "Streaming live / 实时流式传输中" labels with accurate tool/execution status indicators.
- **Session & Document Navigation Stability**:
  - Isolated SSE `hook` events to `sessions` mode so active `Docs / Clips` views are never overwritten by background session hooks, persisted per-tab navigation targets (`sessionStorage` + `amp-last-conv` + Sidecar reload preservation), guarded async view/preview fetches with request sequence counters, froze sidebar DOM re-renders while hovered/clicked, and updated `agy-preview --restart` to reload existing clients in-place without spawning duplicate `--app` windows.

## [0.4.0] - 2026-11-26

### Added
- **Theme-Native Custom `PDF.js` & Offline Office Suite (`Word`, `Excel`, `PowerPoint`) Previews (`public/js/doc-viewers.js`, `server/office-convert.mjs`)**:
  - Replaced native browser `<iframe>` PDF rendering with an offline, lazy-loaded **`PDF.js v4`** viewer matching all `2 × 8 + Custom RGB` themes, supporting HiDPI canvas rendering, selectable `TextLayer`, collapsible page thumbnails, `#page=N` deep links, `↔ Width` / `⊡ Page` fit modes, 90° rotation, and eye-comfort **`◐ Tint` dark-paper filter**.
  - **Word (`.docx` / `.doc`)**: Offline `docx-preview` + `JSZip` paper layout viewer with zoom, width fit, and `◐ Tint` dark-paper filter (with local Word/LibreOffice -> PDF conversion fallback for legacy binary `.doc`).
  - **Excel (`.xlsx` / `.xls` / `.ods`)**: Offline `SheetJS` multi-worksheet viewer featuring sheet tabs, merged cells (`!merges`), sticky `A/B/C` column & row headers, tabular numeric right alignment, and instant row search filtering.
  - **PowerPoint (`.pptx` / `.ppt`)**: Dual-mode hybrid slide deck viewer combining content-addressed SHA1 cached vector PDF conversion (via local PowerPoint COM or LibreOffice headless) with a built-in pure-JS `JSZip + DOMParser` OOXML slide renderer fallback.
- **Three-State Session Status Indicators (Apple Spinner + Unread Highlight)**:
  - Active sessions and collapsed parent project folders now display a calm, neutral **Apple-style 12-spoke activity spinner** while running, and light up with the theme's **`var(--accent)` highlight dot + bold title + `Unread` (`未读`) pill** only when a background session completes with unread updates (clearing immediately upon viewing).
- **Reader Font Size Stepper & Decoupled Multilingual Typography**:
  - Added a **`Font Size` (`正文字号`)** stepper (`−` / `12px–24px` / `+` / `↺ Reset`) scaling reader stage prose, headings, prompts, callouts, tables, and code blocks proportionally without shifting topbar/sidebar UI chrome.
  - Upgraded `Font` into a collapsible vertical picker adding **`Times New Roman`**, and automatically splitting into independent **`英文字体` (`Sans` · `Serif` · `Times New Roman`) × `中文字体` (`无衬线 Sans` · `现代衬线 Serif` · `华文宋体` · `楷体` · `仿宋`)** selectors in `简体中文` mode with `@font-face { size-adjust }` optical baseline calibration.
- **Multi-Candidate Named Custom RGB Palettes**:
  - Upgraded `Custom RGB` into a persistent user palette library (`+ New Custom RGB` / `+ 新增自定义配色`, inline `✎` rename, `✕` delete, and `/api/custom-palettes` disk + SSE sync across windows) with automatic migration from legacy single-slot `amp-custom-rgb`.
- **Live `update_steps` Checklist & `agy-preview --restart`**:
  - Rendered live `update_steps` progress cards above each turn's `Execution process` fold without collapsing open cards mid-turn, added `agy-preview --restart` with automatic browser reload (`serverBootId`), and refreshed all `docs/screenshots/*.png` showcase images.

### Fixed
- **Live Sidebar Running Status Sync**: Opened SQLite `conversation_summaries.db` with WAL visibility (`readOnly` without `immutable`) and enriched `/api/conversations` + SSE updates with live hook and transcript telemetry so sidebar session and project indicators update in real time.

## [0.3.1] - 2026-11-25

### Added
- **Sub-Second Live Streaming & Progressive `--stdin` Pipe**: Added a `280ms` byte-offset live poller (`server/app.mjs`, active only while SSE clients are connected) paired with real-time `.system_generated/tasks/task-*.log` command output tailing, flicker-free in-place turn patching (`patchTurnElementInPlace`), auto-follow scroll pause/resume, and progressive `180ms` chunk streaming for `agy-preview --stdin`.
- **Pinned Sessions (`★ Pinned` / `★ 置顶会话`)**: Added a `☆ / ★` star toggle in the Preview topbar and on sidebar session rows, persisting starred sessions in `pinned-sessions.json` and displaying them in a dedicated `★ Pinned` section above all project folders.
- **One-Click Project Folder Collapse / Expand (`⊟ Collapse` / `⊞ Expand`)**: Added a toggle button next to the sidebar flavor selector to collapse or expand all project folders at once without affecting pinned sessions.
- **Adaptive Horizontal-Fill Mermaid Layout & `↔ Expand` / `↔ Fit Width`**: Disabled Mermaid's cyclic `useMaxWidth` collapse, added `ResizeObserver`-driven horizontal width filling across inline diagrams, added one-click `↔ Expand` (`↔ 铺宽`) full-viewport breakout on diagram cards, and added `↔ Fit Width` (`↔ 铺满宽度`) + live resize re-fitting inside `#mermaid-modal`.

### Fixed
- **Verified Native `📂 Folder` (`📂 目录`) + In-App Directory Browser Fallback**: Switched Windows Explorer launch to verbatim `/select,"<path>"` with `Shell.Application` window verification and foreground activation, automatically falling back to an interactive in-app folder browser (plus clipboard path copy) when running inside sandboxed or remote server environments, and standardized `/preview` on the global `agy-preview` CLI.

## [0.3.0] - 2026-11-25

### Added
- **Server Password Protection (`server/auth.mjs`)**: Optional password authentication (disabled by default) manageable via `agy-preview password <set | cancel | disable | activate | print>` (or `--set-password` / `--cancel-password` / `--disable-password` / `--activate-password` / `--print-password`) and `/preview password ...`, backed by `0600` persistent config, `HttpOnly` HMAC-signed session cookies, login rate limiting, `--host` binding, and topbar `🔒 Lock`.
- **Expanded Media & Tabular File Previews (`PDF`, `Video`, `Audio`, `CSV/TSV`)**: Inline PDF viewer (`#page=N`), video/audio players with HTTP `Range` (`206 Partial Content`) byte-range streaming, playback speed (`0.5×–2×`) and loop controls, interactive CSV/TSV table + raw toggle, and inline Markdown `<video>` / `<audio>` embeds.
- **Custom Two-Color RGB Theme Panel**: Added `Custom RGB` (`自定义 RGB 配色`) to the `Preferences ▾` menu with live `Background` + `Accent` RGB (`0–255`) sliders, `#HEX` input, and native color picker deriving harmonious Light/Dark surface tokens in real time.
- **Larger & User-Resizable Mermaid Fullscreen Modal**: Expanded `#mermaid-modal` to `97vw × 94vh` by default, added 8-direction edge/corner drag-to-resize handles with `localStorage` size persistence, and added a `⤢ Full Window` (`100%`) toggle.

### Fixed
- **Windows Sidebar `📂 Folder` (`📂 目录`) & Native File Picker**: Fixed path quoting, plain-directory resolution (folders without `README.md`), and foreground window activation when opening File Explorer from the background server, plus TopMost file-picker focus and narrow-screen (`<=860px`) Outline drawer visibility.

### Changed
- **Renamed Plugin ID & Display Name to Session Preview (`agy-session-preview`)**: Aligned plugin manifest (`plugin.json`), Sidecar UI (`sidecar://agy-session-preview/preview/`), frontend title & EN/ZH branding (`Session Preview` / `会话预览器`), hooks (`session-preview-sync`), package metadata (`antigravity-session-preview`), and docs with the renamed GitHub repository while keeping the `agy-preview` CLI command and `/preview` slash command intact.
- **Automatic Legacy Data & Install Migration**: Automatically copies existing `docs-store.json`, `clips/`, `btw-notes.json`, and `auth-config.json` from `%APPDATA%/agy-markdown-preview` (and macOS/Linux equivalents) into `agy-session-preview` on startup, and removes legacy `~/.gemini/config/plugins/agy-markdown-preview` during `npm run install-plugin`.

## [0.2.1] - 2026-11-24

### Added
- **Unified Persistent `Preferences` Menu**: Consolidated persistent display settings (`Language`, `Font: Sans / Serif`, `Width: Normal / Wide`, `Tables: Fit / Expand`, `2` Light/Dark modes, and `8` Color Palettes separated by dividers) into a single `Preferences ▾` dropdown immediately to the left of `↻ Sync`.
- **Full Bilingual UI Localization (`English` Default / `简体中文`)**: Added `public/js/i18n.js` synchronizing all topbar controls, sidebar menus, Mermaid fullscreen/zoom tooltips (`⛶ Fullscreen` / `⛶ 大屏预览`), file preview actions (`📂 Folder` / `📂 目录`), and `/btw` · `/context` · `/usage` inspector labels in real time without page reloads.

## [0.2.0] - 2026-11-24

### Added
- **Mermaid v12 + ELK Orthogonal Pastel Engine**: Upgraded offline Mermaid bundle to `v12.3.0` with built-in **ELK (`Eclipse Layout Kernel`)** orthogonal port routing, quadratic-rounded 90° connector elbows, automatic multi-stage pastel pill nodes (`rx=10px`, Light & Dark adaptive), and automatic fallback for specialized diagram types.
- **Interactive Mermaid Viewport & Fullscreen Lightbox**: Added inline & fullscreen (`⛶ 大屏预览`) pan-and-zoom canvas (mouse wheel zoom around cursor, drag-to-pan, `100%` / `⊡ 适应窗口` quick fit, and one-click vector `.svg` download).
- **Topbar `Tools` Menu & Quick Jump**: Consolidated `/btw`, `/context`, and `/usage` into a topbar `Tools ▾` dropdown with a top-pinned drawer, added `⤒` / `⤓` jump-to-top/bottom buttons, and added automatic Hook capture for CLI `/btw` answers.

## [0.1.0] - 2026-11-24

### Added
- **2 × 8 Customizable Reading Themes**: Topbar `Theme` menu featuring **2 brightness modes (`Light` / `Dark`)** separated from **8 curated color palettes** (`Parchment`, `Lavender · 淡紫`, `Sakura · 淡粉`, `Matcha · 淡翠`, `Glacier · 雾蓝`, `Amber · 暖杏`, `Celadon · 青瓷`, `Slate · 冷岩`), plus Sans/Serif typography toggle, Normal/Wide reading column, standalone `--app` desktop window, and Antigravity 2.0 Sidecar (`sidecar://agy-markdown-preview/preview/`).
- **Project-Grouped Sessions & Auto-Folded Execution**:
  - Sessions grouped by workspace project, sorted by latest activity, auto-expanding projects active within the last 3 days.
  - Subagent threads collapsed by default in the sidebar (`▸ N subagents`) with inline `Subagents invoked in this session` cards and `View Subagent` / `← Parent` navigation.
  - High-level `Execution process` auto-folding (thoughts, tool groups, unified `edit_file` diffs, and spooled outputs collapsed by default; auto-collapses when a running turn finishes).
  - Opens conversations directly at the **latest user prompt**; right-hand **Outline** displays turn numbers paired with user prompt snippets.
  - Full-text sidebar & in-page (`Ctrl+K` / `/`) search across project names, titles, and SQLite FTS5 `user_body` prompts.
- **Session CLI Inspector (`/btw` · `/context` · `/usage`)**:
  - **`/context`**: 10×10 proportional context-window cell grid, category token breakdown (`System & Customizations`, `User messages`, `Agent responses`, `Tool calls`, `Free capacity`, `Checkpoints`), prompt cache hit rate, and tracked session artifacts.
  - **`/usage`**: Rolling 5-Hour & 7-Day local token consumption grouped by model family (`Gemini` vs `Claude / GPT`) plus per-model session breakdown.
  - **`/btw`**: Lists side-question commands from CLI `history.jsonl` and supports pinning `/copy btw` Markdown answers directly to the session.
- **Standalone `Docs / Clips` Manager & Dual File Previews**:
  - Persistent OS user-data storage (`%APPDATA%/agy-markdown-preview/docs-store.json` on Windows, `~/Library/Application Support/...` on macOS, `~/.local/share/...` on Linux) with hover preview cards, drag-and-drop reorder, inline rename, and delete.
  - Accurate relative path & image resolution for dragged, browsed (`📂 Browse…`), or pasted Markdown files.
  - Clicking a local hyperlink opens a **Popup Preview Modal**, while clicking **`Open in sidebar`** opens the resizable **Right Split Preview Pane** (supporting Markdown, syntax-highlighted code with `#Lstart-Lend` line highlights, images, and `📂 目录` native folder reveal).
- **Rich Offline Markdown Engine**:
  - Bundled `marked`, `highlight.js`, `KaTeX` (`$...$`, `$$...$$`), lazy `Mermaid`, GitHub/Obsidian callouts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), CJK bold punctuation compatibility, and **Expandable Wide Tables** (`Tables: Expand`, up to `50vw` per column with smooth horizontal slider).
