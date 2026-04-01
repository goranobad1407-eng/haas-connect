# HAAS CNC Connect — Tauri 2 Architecture

## Purpose

Lightweight desktop tool for CNC machine operators to:
1. Browse configured machine/location entries
2. Detect quickly whether a machine path is reachable
3. View directory contents when online
4. Preview G-code / text / PDF files on demand
5. Copy programs to/from machines
6. Maintain machine profiles inside the app without editing JSON manually
7. Send local CNC files into the selected machine destination folder safely

This is **not** a generic file manager.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Shell / native | Tauri 2 (Rust + WebView2 on Windows) |
| Backend logic | Rust (safe, testable, no GC pauses) |
| Frontend | Plain TypeScript + Vite (no framework) |
| Config | JSON (`machines.json` in `%LOCALAPPDATA%\\HAAS CNC Connect` for installed builds; local file for portable/dev when present) |
| Build | `npm run build:installer` for production NSIS installer, `npm run build:portable` for portable test package |

---

## Directory layout

```
haas-connect-tauri/
├── index.html                    HTML shell
├── vite.config.ts                Vite dev/build config
├── tsconfig.json
├── package.json
├── machines.json                 Sample config for portable/dev use
│
├── src/                          TypeScript frontend
│   ├── main.ts                   Boot: loads config, wires components
│   ├── state.ts                  Single reactive store (pub/sub, no framework)
│   ├── api.ts                    Thin invoke() wrappers for each Rust command
│   ├── config-state.ts           Applies refreshed config safely into frontend state
│   ├── style.css
│   ├── types/
│   │   └── index.ts              All TS types matching Rust models (snake_case)
│   └── components/
│       ├── machine-list.ts       Left panel: machine entries + status dots
│       ├── machine-settings.ts   Modal editor for machine profiles
│       ├── file-browser.ts       Center panel: directory listing + navigation
│       ├── preview-pane.ts       Right panel: on-demand file preview + actions
│       ├── send-workflow.ts      Native file-pick + send-to-machine flow
│       └── status-bar.ts         Bottom status message helper
│
└── src-tauri/                    Rust backend
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json          Minimal capabilities (no built-in fs plugin)
    └── src/
        ├── main.rs               Entry: calls lib::run()
        ├── lib.rs                Registers all commands
        ├── models.rs             Shared data types
        ├── config.rs             Load/save machines.json + legacy migration
        ├── availability.rs       Async path check with configurable timeout
        ├── browser.rs            Non-recursive directory listing
        ├── preview.rs            G-code analysis, text/PDF preview, open external
        ├── send.rs               Backend-authoritative send workflow
        └── commands.rs           All #[tauri::command] functions
```

---

## Data flow

```
User clicks machine
    │
    ▼
machine-list.ts::selectMachine()
    │
    ├── state.setMachineStatus(id, "checking")
    ├── api.checkAvailability(path, timeout_secs)  ← async, non-blocking
    │       │
    │       └── Rust: availability::check_path_availability()
    │               └── tokio::task::spawn_blocking(fs::metadata)
    │               └── tokio::time::timeout(N seconds)
    │
    ▼
AvailabilityStatus returned
    │
    ├─ "online"  → file-browser loads root directory
    └─ other     → browser shows status message, no directory access
```

```
User opens Machine Settings
    │
    ▼
machine-settings.ts
    ├── api.loadMachineProfiles()
    ├── local draft editing + lightweight frontend validation
    ├── api.validateMachineProfiles(drafts)
    └── api.saveMachineProfiles(drafts, confirmedProtectedRemovals)
            │
            └── Rust: config::save_machine_profiles()
                    ├── normalize ids, names, paths, extensions, notes
                    ├── enforce required fields + unique ids/names
                    └── block protected removals unless explicitly confirmed
    │
    ▼
config-state.ts re-applies config without restarting the app
```

```
User clicks Send File
    │
    ▼
send-workflow.ts
    ├── native file picker filtered by machine.allowed_extensions
    ├── api.sendFileToMachine(machine.id, source, current_path, overwrite, timeout)
    └── overwrite confirmation only if backend returns overwrite_required
            │
            └── Rust: send::send_file_to_machine()
                    ├── validate source file exists
                    ├── validate extension against MachineProfile
                    ├── check destination availability with timeout
                    ├── enforce destination stays under machine root
                    └── send only after explicit overwrite confirmation
    │
    ▼
file-browser refreshes current folder and can reselect the sent file
```

```
User clicks file
    │
    ▼
file-browser.ts: state.set("selected_entry", entry)
    │
    ▼
preview-pane.ts: loadPreview(entry)
    │
    └── api.getPreview(path, max_bytes)
            │
            └── Rust: preview::get_preview()
                    ├── .nc / .tap  → read excerpt + analyze_gcode()
                    ├── .txt        → read excerpt
                    └── .pdf        → magic bytes check + size
```

---

## Key design rules (enforced in code)

1. **Never access a path without checking availability first.**
   `file-browser.ts` only calls `listDirectory` when status is `"online"`.

2. **All filesystem I/O is in Rust.**
   The frontend receives plain JSON — no raw paths are ever crawled from JS.

3. **Availability check uses spawn_blocking + timeout.**
   The UI is never blocked waiting for a dead network share.

4. **Preview is on-demand only.**
   No file is read until the user explicitly selects it.

5. **No recursive tree scanning.**
   `browser.rs::list_directory` reads exactly one directory level.

6. **Installed builds write config to Local AppData.**
   Production installs use `%LOCALAPPDATA%\HAAS CNC Connect\machines.json`.
   Portable/dev runs keep using a local `machines.json` when one is already present.

7. **Machine settings stay operator-focused.**
   Settings edit only machine profiles; no generic admin surface or file-manager drift.

8. **Send workflow is machine-scoped.**
   Operators pick a local CNC file and send it into the current machine destination folder only.

---

## Config format (`machines.json`)

```json
{
  "version": "2.0",
  "machines": [
    {
      "id": "haas1",
      "name": "HAAS 1",
      "path": "Z:/",
      "location_type": "network_share",
      "allowed_extensions": [".nc", ".tap", ".txt", ".pdf"],
      "protected": false,
      "notes": "Main CNC machine"
    }
  ],
  "check_timeout_secs": 3,
  "preview_max_bytes": 51200
}
```

**Legacy migration:** If only `config.json` (old Python format) is found, it is
automatically converted to the v2 format in memory. Save triggers a write of
`machines.json`. Installed builds write that file to `%LOCALAPPDATA%\HAAS CNC Connect\`;
portable/dev runs keep a local `machines.json` when one already exists. The old file is not deleted.

### Machine settings behavior

- Operators add, edit, duplicate, and remove machine profiles in-app.
- `allowed_extensions` are normalized to lowercase dotted values such as `.nc`.
- Empty or whitespace-only `id`, `name`, and `path` values are rejected.
- Duplicate ids and duplicate names are rejected.
- Protected machines require explicit confirmation before removal.
- Saving refreshes the live machine list immediately; restart is not required.

### Send workflow behavior

- Source files are chosen with a native file picker, filtered by machine-allowed extensions.
- Backend rejects missing source files, disallowed extensions, invalid destinations, and offline destinations.
- Destination folders must stay inside the selected machine root.
- Existing destination files return an `overwrite_required` result first; overwrite only happens after explicit confirmation.
- Successful sends refresh the current machine destination folder immediately.

---

## Rust commands (API surface)

| Command | Description |
|---------|-------------|
| `cmd_load_config` | Load + validate config from disk |
| `cmd_load_machine_profiles` | Load normalized machine profiles for settings |
| `cmd_validate_machine_profiles` | Validate and normalize profile edits |
| `cmd_save_config` | Write config to disk |
| `cmd_save_machine_profiles` | Save validated machine profiles back to config |
| `cmd_get_config_path` | Return path where config will be written |
| `cmd_check_availability` | Async path reachability check with timeout |
| `cmd_list_directory` | One-level directory listing |
| `cmd_get_preview` | Read file excerpt + G-code analysis |
| `cmd_send_file_to_machine` | Validate and send a local file into the current machine destination folder |
| `cmd_delete_file` | Delete a single file |
| `cmd_open_external` | Open file/folder in OS default app |

---

## Windows-specific notes

- Primary target: Windows 10/11, WebView2 (ships with modern Windows).
- `windows_subsystem = "windows"` in release: no console window.
- Availability timeout is critical: mapped drives (Z:/) pointing to offline
  machines can block `std::fs::metadata` for 30–90 seconds in the Windows I/O
  layer. Our `spawn_blocking` + `timeout` pattern prevents this from reaching
  the UI thread.
- UNC paths (`\\server\share`) are supported as `path` values in config.
- Icons: generate from source with `npx tauri icon <source.png>`.

---

## Running locally

```sh
cd haas-connect-tauri
npm install
npm run tauri dev
```

Requirements: Rust toolchain, Node.js ≥ 18, WebView2 runtime (installed by
default on Windows 10/11 with updates).

## Building for production

```sh
npm run build:installer
```

Produces the NSIS installer in `src-tauri/target/release/bundle/nsis/`.

## Building a portable Windows test package

```sh
npm run build:portable
```

Produces a portable folder and zip in `portable-build/`.

## Running tests

```sh
cd src-tauri
cargo test
```

```sh
cd ..
npx tsc --noEmit
```
