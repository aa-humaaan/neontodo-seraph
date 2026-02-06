# NeonTodo

```
   _   _                  _____         _
  | \ | | ___  ___  _ __ |_   _|__   __| | ___
  |  \| |/ _ \/ _ \| '_ \  | |/ _ \ / _` |/ _ \
  | |\  |  __/ (_) | | | | | | (_) | (_| | (_) |
  |_| \_|\___|\___/|_| |_| |_|\___/ \__,_|\___/
```

NeonTodo is a local-first, futuristic desktop to-do app built with Tauri + React. It stays fast, works offline, and ships cleanly to Windows later (no rewrite).

Built with: Tauri v2 + React + TypeScript + SQLite

Repo: `aa-humaaan/neontodo-seraph`

## Why This Exists

Most todo apps either feel heavy, require accounts, or get in the way.
NeonTodo is the opposite: a crisp command-deck UI, instant persistence, and a vibe that makes you want to use it.

## Features

- Local-first SQLite storage (offline by default)
- Projects (create/rename/delete)
- Delete project safely: tasks are moved to Inbox
- Smart views: Today / Upcoming / Completed
- Tasks: create/edit/complete/delete
- Inspector panel: title, due date, priority, notes
- Tags: add/remove per task + filter chips (AND semantics)
- Drag-and-drop reorder in projects (persists sort order)
- Import/Export JSON backups (merge-by-id with confirmation)

## Tech Stack

- UI: React + TypeScript + Vite
- Desktop: Tauri v2
- Storage: SQLite via `@tauri-apps/plugin-sql`
- Native dialogs/files: `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`

## Quick Start (Dev)

```sh
source ~/.cargo/env
npm install
npm run tauri dev
```

### Wayland Note (Linux)

If you hit a Wayland crash like `Error 71 (Protocol error) dispatching to Wayland display`, force X11:

```sh
npm run tauri:dev:x11
```

## Build

Frontend build:

```sh
npm run build
```

Desktop bundle (release):

```sh
source ~/.cargo/env
npm run tauri build
```

## Windows App Later

Tauri makes Windows packaging straightforward.
When you are ready, build on a Windows machine:

```sh
npm install
npm run tauri build
```

This produces installer artifacts (MSI/EXE depending on Tauri bundler config).

## Data + Backups

- Data is stored locally in a SQLite database (app data directory).
- Use the sidebar buttons:
  - Export JSON
  - Import JSON

Import merges by ID and overwrites matching records (with a confirmation dialog).

## Roadmap Ideas

- Project color/icon picker
- Better project management (delete/rename UX polish)
- GitHub Actions release builds (Windows installers)

## Dev Setup (Recommended)

- VS Code + Tauri extension + rust-analyzer

## Keyboard Shortcuts

- `Ctrl+N` new task
- `/` focus search
- `Esc` close inspector
