# Portable Windows Build

## Build command

```powershell
npm run build:portable
```

## Output

The command creates:

- `portable-build/HAAS-CNC-Connect-portable-0.1.0/`
- `portable-build/HAAS-CNC-Connect-portable-0.1.0.zip`

The portable folder contains:

- `haas-cnc-connect.exe`
- `machines.json`
- `PORTABLE_BUILD.md`

## What to copy to the test PC

Copy either:

- the whole `portable-build/HAAS-CNC-Connect-portable-0.1.0/` folder
- or the zip and extract it on the test PC

Run the app from a normal writable folder such as `Desktop`, `Documents`, or a dedicated test folder.
Do not run it from a locked-down location like `Program Files` if you want in-app settings changes to save locally.

## Runtime requirement

- Windows 10/11
- Microsoft Edge WebView2 Runtime

Modern Windows systems usually already have WebView2 installed. If the app does not start on the test PC, install the WebView2 Runtime first.

## Config behavior in the portable build

The portable build reads and writes `machines.json` next to `haas-cnc-connect.exe`.

That means:

- the copied folder keeps its own machine/config state
- Machine Settings changes stay inside that portable folder
- no installer or AppData-first workflow is required for testing

If `machines.json` is missing, the app starts with an empty default config and writes a new `machines.json` next to the executable when settings are saved.

## Reset for a clean test

To reset the portable test state:

1. Close the app.
2. Delete or replace `machines.json` in the portable folder.
3. Start the app again.

## Current limitations

- This is a portable test package, not an installer.
- WebView2 must exist on the target PC.
- The build does not bundle auto-update, MSI, or NSIS installer behavior.
