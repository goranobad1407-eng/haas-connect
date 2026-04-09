# HAAS CNC Connect — Migration: PySide6 → Tauri 2

## Status

Migration in progress. This repository root now contains the Tauri 2 app.
Legacy Python app files remain outside this repo for reference only.

---

## Why migrate

| Problem | Impact |
|---------|--------|
| PySide6 .exe is 50–100 MB | Heavy for a simple browser tool |
| No availability checking before path access | App freezes 1–2 min when a machine drive is offline |
| Generic file manager behavior | Wrong product concept for CNC workflows |
| No timeout on network paths | Explorer-style blocking on dead UNC/mapped drives |
| Single 1,300-line Python file | Hard to test, hard to extend |

---

## Migration decisions

### Keep
- `config.json` format (auto-migrated to `machines.json` v2 format on first run)
- Core concept: configurable named machine/location entries
- NC file analysis: X/Y/Z range, G/M code extraction
- Text/NC preview (partial, max-bytes limited)
- PDF metadata preview
- Copy file operation
- Icons from `image/` folder (need re-export at standard sizes)

### Drop
- PySide6 and all Python dependencies
- cx_Freeze bundling
- PyMuPDF (PDF rendered externally in default viewer instead)
- Pillow (image thumbnails not in v1 scope)
- Generic recursive file tree as primary interaction
- "Delete All" button (too dangerous, low-value)
- Croatian hardcoded strings (English for maintainability)
- Drag-and-drop (deferred to later iteration)

### Rebuild
- Entire UI: HTML/CSS/TypeScript (no framework, Vite)
- File system operations: Rust via Tauri 2 commands
- **NEW: async availability check with short timeout before any path access**
- **NEW: explicit machine status (online / offline / timeout / checking)**
- Config: Rust-based loader with legacy migration
- Preview: Rust reads file, frontend renders

### Risks
- Windows: `std::fs::metadata()` on a dead UNC/mapped path can still block in the
  `spawn_blocking` thread even after timeout is returned to the UI. The UI remains
  responsive but background thread is leaked. Acceptable for this tool's scale.
- PDF inline preview deferred: first version shows metadata + "Open externally".
- Icons: Tauri requires specific sizes. Generate with `npx tauri icon` from source.
- `machines.json` must be placed next to the `.exe` or in the working directory.

---

## Architecture chosen

**Tauri 2** (Rust backend + TypeScript/Vite frontend, no JS framework)

- All filesystem operations happen in Rust — frontend gets only serialized results
- Availability is checked asynchronously with 3-second timeout before any directory read
- Frontend is thin DOM manipulation — no React/Vue/Svelte overhead
- State is a single plain object, updated by events
- Backend modules are pure functions, easy to unit test

---

## File changes

### Added (Tauri app)
See `ARCHITECTURE.md` for full file list.

### Preserved (Python app)
- `main.py` — reference only
- `config.json` — will be auto-read and migrated to `machines.json`
- `requirements.txt`, `setup.py`, `CHANGELOG.md` — reference only

---

## Next steps after this foundation

1. Generate proper icons (`npx tauri icon image/HAAS\ LOGO\ app.ico`)
2. Add machine settings dialog (add/edit/remove machines from UI)
3. Add drag-and-drop copy (Tauri dnd plugin or custom)
4. Add proper PDF first-page inline preview (pdfium-render crate)
5. Sign the Windows installer for deployment
