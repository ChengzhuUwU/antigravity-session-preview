---
name: preview
description: Open the lightweight editorial Session Preview window (or side pane) for the active Antigravity CLI/Desktop conversation, a Markdown/PDF/media file, or CLI output, or manage the Preview frontend password (set, cancel/clear, disable, activate, print). Use whenever the user invokes /preview or asks to preview CLI output/files or configure preview password protection.
---

# Session Preview (`/preview`)

Open a lightweight, real-time standalone Session, Markdown & Media preview window where thinking chains and tool calls are collapsed by default, featuring customizable Light/Dark color themes + custom RGB panel, inline PDF/video/audio/CSV previews, adaptive Mermaid v12 ELK diagrams, pinned sessions, and optional frontend password protection for remote servers.

## Step 1: Always Use `agy-preview` CLI

Always invoke `agy-preview` (`~/.local/bin/agy-preview`, falling back to `~/.gemini/config/plugins/agy-session-preview/bin/agy-preview.mjs` only if `agy-preview` is not on `PATH`).

## Step 2: Handle Password Security Subcommands (If Requested)

If the user invokes `/preview password ...` (or asks in natural language to **set / cancel / deactivate / activate / print** the preview frontend password), run `agy-preview` synchronously (`IsDaemon: false`, `WaitMsBeforeAsync: 5000`):

- **Set & activate password** (`/preview password set <PASSWORD>`):
  ```powershell
  agy-preview password set "<PASSWORD>"
  ```
- **Cancel / clear password** (`/preview password cancel` or `clear`):
  ```powershell
  agy-preview password cancel
  ```
- **Temporarily deactivate password check** (`/preview password disable` or `off`, keeps saved password):
  ```powershell
  agy-preview password disable
  ```
- **Activate password protection** (`/preview password activate [OPTIONAL_PASSWORD]` — re-enables saved password or generates a random one if unset):
  ```powershell
  agy-preview password activate
  ```
- **Print current password & status** (`/preview password print` or `show`):
  ```powershell
  agy-preview password print
  ```

## Step 2b: Update the installed plugin

If the user asks to update Session Preview, run `agy-preview update` (or `agy-preview --update`). It downloads the latest GitHub release into `~/.gemini/config/plugins/agy-session-preview` and restarts a running preview server. Do not clone the repository or re-run `npm run install-plugin` for this.

## Step 3: Launch or Focus via `agy-preview`

1. First check `agy-preview --status`.
   - **If `running: true`**: run `agy-preview --conv "<CONVERSATION_ID>" --open` (or `agy-preview --file "<FILE_PATH>" --open`; add `--focus` only if the user explicitly asked to switch an already-open preview window immediately) with `IsDaemon: false` — this reuses the existing `agy-preview` server (preserving full native OS File Explorer permissions) and notifies or opens the window without hijacking another active document/session.
   - **If `running: false`**: call `run_command` with **`IsDaemon: true`** and **`WaitMsBeforeAsync: 3000`** using `agy-preview --foreground`:

### Case A — Preview the current (or specific) Antigravity conversation

```powershell
agy-preview --foreground --conv "<CONVERSATION_ID>" --open
```

### Case B — User specified a Markdown / PDF / Video / JSONL / text file (`/preview path/to/file`)

```powershell
agy-preview --foreground --file "<FILE_PATH>" --open
```

## Step 4: Respond Concisely

Return the preview URL printed by `agy-preview` (`http://127.0.0.1:19420/...`), mention key shortcuts (`R` sync, `T` theme, `O` outline, `P` open/paste Markdown), and if running inside Antigravity 2.0 Desktop, also provide the side-pane link:

`[Session Preview](sidecar://agy-session-preview/preview/)`
