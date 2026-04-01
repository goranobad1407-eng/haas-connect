# Production Windows Installer

## Build command

```powershell
npm run build:installer
```

## Output

The production installer is written to:

- `src-tauri/target/release/bundle/nsis/`
- and automatically copied to the project root

Use the copied `.exe` in the project root for the fastest operator handoff.

## Recommended installer artifact

- Preferred: NSIS `.exe` installer
- The standard `npm run build:installer` flow now keeps the original NSIS bundle output and also places the same installer file in the project root automatically.

This repo's supported production installer path is NSIS so the build stays predictable and does not require WiX/MSI tooling.

## Production PC prerequisites

- Windows 10 or Windows 11
- Microsoft Edge WebView2 Runtime

This installer now uses Tauri's `offlineInstaller` WebView2 mode with `silent: true`, so if WebView2 is missing the NSIS installer can install it inside the setup flow without requiring internet access.

## Automatic root copy

After every successful `npm run build:installer` run, the final installer is available in both places:

- `src-tauri/target/release/bundle/nsis/HAAS CNC Connect_0.1.0_x64-setup.exe`
- `HAAS CNC Connect_0.1.0_x64-setup.exe` in the project root

The root copy uses the same filename as the generated NSIS installer and is overwritten on the next build of the same version.

Notes:

- the installer is larger because it bundles the offline WebView2 installer
- installation stays inside the normal NSIS flow instead of asking operators to download WebView2 manually
- if WebView2 installation still fails because of machine policy or permissions, install the Evergreen Runtime separately and rerun the installer

## Config location after installation

Installed builds store writable config here:

- `%LOCALAPPDATA%\HAAS CNC Connect\machines.json`

This avoids writes to `Program Files` and does not require admin rights for machine/app settings changes.

## Reset / start clean

1. Close the app.
2. Delete `%LOCALAPPDATA%\HAAS CNC Connect\machines.json`.
3. Start the app again.

If you want to preseed a production PC, place a prepared `machines.json` at that same path before first launch.

## First-run steps on a production PC

1. Install with the NSIS `.exe`.
2. Confirm WebView2 is present if the app fails to open.
3. Open Machine Settings and enter machine paths, or preseed `%LOCALAPPDATA%\HAAS CNC Connect\machines.json`.
4. Test each configured machine path from inside the app before operator handoff.

## Current limitations

- the production installer is larger because it bundles the WebView2 offline installer
- PDF preview is metadata-only; PDFs still open externally.
- Code signing is not configured in this repo yet, so Windows SmartScreen reputation may depend on your deployment environment.
