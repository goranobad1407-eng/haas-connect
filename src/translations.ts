// Lightweight translation layer for HAAS CNC Connect.
// Supports English ("en") and Croatian ("hr").
// Usage: t("key") or t("key", { name: "HAAS 1" })

import { state } from "./state";
import type { Language } from "./types/index";

type Dict = Record<string, string>;

const translations: Record<Language, Dict> = {
  en: {
    // Panel headers
    "panel.machines": "Machines",
    "panel.preview": "Preview",

    // Machine panel footer buttons
    "btn.machineSettings": "Machine Settings",
    "btn.appSettings": "App Settings",

    // Pane titles
    "pane.machine": "Machine",
    "pane.local": "Local",

    // Pane action buttons
    "btn.copyToLocal": "Copy to server",
    "btn.chooseFolder": "Choose Folder",
    "btn.open": "Open",
    "btn.copyToMachine": "Copy to machine",
    "btn.back": "Back",
    "btn.forward": "Forward",
    "btn.up": "Up",

    // Machine availability status labels (short, shown in list and pane)
    "machine.unknown": "Not checked",
    "machine.checking": "Checking…",
    "machine.online": "Online",
    "machine.offline": "Offline",
    "machine.timeout": "No response",
    "machine.error": "Error",
    "machine.badgeUnknown": "Not checked",
    "machine.badgeChecking": "Checking",
    "machine.badgeOnline": "Online",
    "machine.badgeOffline": "Offline",
    "machine.badgeTimeout": "Timeout",
    "machine.badgeError": "Error",

    // Machine list
    "machine.noMachines":
      "No machines configured.\nUse Machine Settings to add entries.",

    // Machine pane subtitle
    "pane.machineSelect": "Select a machine",
    "pane.machineNotChecked": "{name} — not checked",
    "pane.machineChecking": "Checking {name}…",
    "pane.machineOnline": "Machine online",
    "pane.machineOffline": "Machine unavailable",
    "pane.machineTimeout": "Machine did not respond",
    "pane.machineError": "Machine check failed",

    // Machine pane placeholders
    "pane.machineSelectPrompt": "Select a machine from the left panel",
    "pane.machineUnavailable": "Machine unavailable",
    "pane.machineNoResponse":
      "Machine did not respond within the timeout",
    "pane.machineCheckFailed": "Machine availability check failed",
    "pane.machineLoading": "Loading machine folder…",

    // Local pane
    "pane.localChooseFolder": "Choose a local work folder",
    "pane.localEmpty":
      "Choose a local work folder to browse CNC files.",
    "pane.localLoading": "Loading local folder…",
    "pane.localSearching": "Searching current folder…",
    "pane.localSearchMinChars":
      "Type at least {count} characters to search recursively",
    "pane.localSearchPlaceholder": "Search current folder and subfolders",
    "pane.localNoMatches": 'No local matches for "{query}" under the current folder',
    "pane.dirEmpty": "Directory is empty",

    // Preview pane
    "preview.selectFile": "Select a file to preview",
    "preview.loading": "Loading preview…",
    "preview.noPreview": "No preview available for {ext}",
    "preview.pdfNote":
      "Open in default PDF viewer to read contents.",
    "preview.folderSelected":
      "Folder selected. Double-click to open it or use the transfer buttons to copy it.",
    "preview.multiSelectedTitle": "Multiple files selected",
    "preview.multiSelectedStatus": "{count} items selected",
    "preview.multiSelectedMeta": "{count} selected items",
    "preview.multiSelectedMetaWithSize":
      "{count} selected items • total file size {size}",

    // Preview action buttons
    "btn.openExternal": "Open in default app",
    "btn.openFolder": "Open folder",
    "btn.openPdfViewer": "Open in PDF viewer",
    "btn.openInGcodeViewer": "Open in G-code viewer",
    "btn.edit": "Edit",
    "btn.delete": "Delete",
    "btn.deleteAll": "Delete all",

    // Delete confirm dialog
    "preview.deleteConfirm": 'Delete "{name}"?\n\nThis cannot be undone.',
    "preview.deleted": "Deleted: {name}",
    "preview.deleteError": "Delete failed: {error}",
    "preview.openError": "Could not open: {error}",
    "machine.deleteAllConfirm":
      "Delete all {count} item(s) in this machine folder?\n\nFolder: {path}\n\nThis cannot be undone.",
    "machine.deleteAllDone": "Deleted {count} item(s) from the machine folder.",
    "machine.deleteAllError": "Delete all failed: {error}",

    // Transfer messages
    "transfer.copyingToMachine": "Copying '{name}' to machine folder…",
    "transfer.copyingToLocal": "Copying '{name}' to local folder…",
    "transfer.copyingBatchToMachine":
      "Copying {count} selected item(s) to machine folder…",
    "transfer.copiedToMachine": "Copied '{name}' to machine folder.",
    "transfer.copiedToLocal": "Copied '{name}' to local folder.",
    "transfer.batchToMachineSummary":
      "Machine copy finished: {copied} copied, {skipped} skipped, {failed} failed.",
    "transfer.cancelled":
      "Copy cancelled. Existing destination content was left unchanged.",
    "transfer.chooseFileFirst":
      "Choose a file or folder and destination folder before copying.",
    "transfer.selectMachineFirst":
      "Select an online machine before copying to machine.",
    "transfer.overwritePrompt":
      "{message}\n\nOverwrite '{name}' in the {dest}?",
    "transfer.overwriteFolderPrompt":
      "{message}\n\nProceed with folder merge for '{name}' in the {dest}? Existing files with the same name will be overwritten.",
    "transfer.machineDest": "machine folder",
    "transfer.localDest": "local folder",

    // Status bar
    "status.ready": "Ready",
    "status.loadingConfig": "Loading configuration…",
    "status.configLoaded": "Loaded {count} machine(s)",
    "status.configWarnings":
      "Config loaded with {count} warning(s). Check console.",
    "status.configFailed": "Failed to load config: {error}",
    "status.checking": "Checking {name}…",
    "status.machineOnline": "{name} — Online",
    "status.machineStatus": "{name} — {status} ({path})",
    "status.machineError": "Error checking {name}: {error}",
    "status.machineReady": "Machine folder ready: {path}",
    "status.machineLoadError": "Machine folder error: {error}",
    "status.localReady": "Local folder ready: {path}",
    "status.localError": "Local folder error: {error}",
    "status.localSearchError": "Local search failed: {error}",
    "status.defaultLocalLoaded": "Default local folder loaded.",
    "status.defaultLocalInvalid":
      "Default local path is unavailable. Choose a folder manually.",

    // Machine settings modal — general
    "settings.machine.title": "Machine Settings",
    "settings.machine.subtitle": "Edit machine profiles stored in",
    "settings.machine.editMessage":
      "Edit machines and save when ready.",
    "settings.machine.fixErrors":
      "Fix the highlighted fields before saving.",
    "settings.machine.backendErrors":
      "Backend validation found problems that need attention.",
    "settings.machine.noProfilesSaved":
      "No profiles saved. Fix errors above.",
    "settings.machine.savedWithWarnings":
      "Saved with warnings. Review the messages above.",
    "settings.machine.openError":
      "Could not open machine settings: {error}",
    "settings.machine.saveError":
      "Could not save machine settings: {error}",
    "settings.machine.enterPath":
      "Enter a path before testing availability.",
    "settings.machine.checking": "Checking {name}…",
    "settings.machine.checkResult": "Availability: {status}.",
    "settings.machine.checkFailed":
      "Availability check failed: {error}",
    "settings.machine.discardConfirm":
      "Discard unsaved machine settings changes?",
    "settings.machine.removeProtectedPrompt":
      '"{name}" is protected.\nType its id ({id}) to confirm removal.',
    "settings.machine.protectedNotRemoved":
      "Protected machine was not removed.",
    "settings.machine.empty":
      "Add a machine or select one from the list.",
    "settings.machine.noMachinesInList":
      "No machines yet. Add one to start.",
    "settings.machine.unnamed": "(Unnamed machine)",
    "settings.machine.pathNotSet": "Path not set",
    "settings.machine.protectedBadge": "Protected",

    // Machine settings — form labels
    "settings.machine.id": "ID",
    "settings.machine.name": "Name",
    "settings.machine.locationType": "Location Type",
    "settings.machine.location.local": "Local",
    "settings.machine.location.networkShare": "Network Share",
    "settings.machine.location.usb": "USB",
    "settings.machine.protected": "Protected",
    "settings.machine.path": "Path",
    "settings.machine.extensions": "Allowed Extensions",
    "settings.machine.extensionsPlaceholder": ".nc, .tap, .txt, .pdf",
    "settings.machine.cncPreset": "CNC Preset",
    "settings.machine.notes": "Notes",

    // Machine settings — buttons
    "btn.add": "Add",
    "btn.duplicate": "Duplicate",
    "btn.remove": "Remove",
    "btn.cancel": "Cancel",
    "btn.close": "Close",
    "btn.saveMachineSettings": "Save Machine Settings",
    "btn.testAvailability": "Test Availability",

    // Status messages from machine settings
    "status.savedMachines": "Saved {count} machine setting(s).",
    "status.savedMachinesWithWarnings":
      "Saved {count} machine(s) with warning(s).",
    "status.noProfilesSaved": "No profiles saved. Fix errors above.",

    // App settings modal
    "settings.app.title": "App Settings",
    "settings.app.defaultLocalPath": "Default Local Folder",
    "settings.app.defaultLocalPathPlaceholder":
      "e.g. C:\\CNC\\Programs",
    "settings.app.language": "Language",
    "settings.app.saved": "Settings saved.",
    "settings.app.saveError": "Could not save settings: {error}",
    "btn.browse": "Browse…",
    "btn.saveAppSettings": "Save Settings",

    // Validation errors (client-side, in machine-settings)
    "validation.idRequired": "Row {row}: machine id is required.",
    "validation.dupId": 'Row {row}: duplicate machine id "{id}".',
    "validation.nameRequired": "Row {row}: machine name is required.",
    "validation.dupName": 'Row {row}: duplicate machine name "{name}".',
    "validation.pathRequired": "Row {row}: machine path is required.",
  },

  hr: {
    // Panel headers
    "panel.machines": "Strojevi",
    "panel.preview": "Pregled",

    // Machine panel footer buttons
    "btn.machineSettings": "Postavke stroja",
    "btn.appSettings": "Postavke aplikacije",

    // Pane titles
    "pane.machine": "Stroj",
    "pane.local": "Lokalno",

    // Pane action buttons
    "btn.copyToLocal": "Kopiraj na server",
    "btn.chooseFolder": "Odaberi mapu",
    "btn.open": "Otvori",
    "btn.copyToMachine": "Kopiraj na stroj",
    "btn.back": "Natrag",
    "btn.forward": "Naprijed",
    "btn.up": "Gore",

    // Machine availability status labels
    "machine.unknown": "Nije provjereno",
    "machine.checking": "Provjera…",
    "machine.online": "Dostupan",
    "machine.offline": "Nedostupan",
    "machine.timeout": "Nema odgovora",
    "machine.error": "Greška",
    "machine.badgeUnknown": "Nije provjereno",
    "machine.badgeChecking": "Provjera",
    "machine.badgeOnline": "Dostupan",
    "machine.badgeOffline": "Nedostupan",
    "machine.badgeTimeout": "Timeout",
    "machine.badgeError": "Greška",

    // Machine list
    "machine.noMachines":
      "Nema konfiguriranih strojeva.\nKoristite Postavke stroja za dodavanje.",

    // Machine pane subtitle
    "pane.machineSelect": "Odaberite stroj",
    "pane.machineNotChecked": "{name} — nije provjereno",
    "pane.machineChecking": "Provjera {name}…",
    "pane.machineOnline": "Stroj dostupan",
    "pane.machineOffline": "Stroj nedostupan",
    "pane.machineTimeout": "Stroj ne odgovara",
    "pane.machineError": "Provjera dostupnosti neuspješna",

    // Machine pane placeholders
    "pane.machineSelectPrompt": "Odaberite stroj s lijeve ploče",
    "pane.machineUnavailable": "Stroj nedostupan",
    "pane.machineNoResponse":
      "Stroj nije odgovorio u zadanom vremenu",
    "pane.machineCheckFailed": "Provjera dostupnosti stroja neuspješna",
    "pane.machineLoading": "Učitavanje mape stroja…",

    // Local pane
    "pane.localChooseFolder": "Odaberite lokalnu radnu mapu",
    "pane.localEmpty":
      "Odaberite lokalnu radnu mapu za pregled CNC datoteka.",
    "pane.localLoading": "Učitavanje lokalne mape…",
    "pane.localSearching": "Pretraga trenutne mape…",
    "pane.localSearchMinChars":
      "Unesite najmanje {count} znaka za rekurzivnu pretragu",
    "pane.localSearchPlaceholder": "Pretraži trenutnu mapu i podmape",
    "pane.localNoMatches": 'Nema rezultata za "{query}" u trenutnoj mapi',
    "pane.dirEmpty": "Mapa je prazna",

    // Preview pane
    "preview.selectFile": "Odaberite datoteku za pregled",
    "preview.loading": "Učitavanje pregleda…",
    "preview.noPreview": "Pregled nije dostupan za {ext}",
    "preview.pdfNote":
      "Otvorite u zadanom PDF pregledniku za čitanje sadržaja.",
    "preview.folderSelected":
      "Mapa je odabrana. Dvaput kliknite za otvaranje ili koristite gumbe za prijenos za kopiranje.",
    "preview.multiSelectedTitle": "Odabrano više datoteka",
    "preview.multiSelectedStatus": "Odabrano {count} stavki",
    "preview.multiSelectedMeta": "{count} odabranih stavki",
    "preview.multiSelectedMetaWithSize":
      "{count} odabranih stavki • ukupna veličina datoteka {size}",

    // Preview action buttons
    "btn.openExternal": "Otvori u zadanom programu",
    "btn.openFolder": "Otvori mapu",
    "btn.openPdfViewer": "Otvori u PDF pregledniku",
    "btn.openInGcodeViewer": "Otvori u G-code programu",
    "btn.edit": "Uredi",
    "btn.delete": "Obriši",
    "btn.deleteAll": "Obriši sve",

    // Delete confirm dialog
    "preview.deleteConfirm": 'Obrisati "{name}"?\n\nOvo se ne može poništiti.',
    "preview.deleted": "Obrisano: {name}",
    "preview.deleteError": "Brisanje neuspješno: {error}",
    "preview.openError": "Nije moguće otvoriti: {error}",
    "machine.deleteAllConfirm":
      "Obrisati svih {count} stavki u ovoj mapi stroja?\n\nMapa: {path}\n\nOvo se ne može poništiti.",
    "machine.deleteAllDone": "Obrisano {count} stavki iz mape stroja.",
    "machine.deleteAllError": "Brisanje svega neuspješno: {error}",

    // Transfer messages
    "transfer.copyingToMachine": "Kopiranje '{name}' na stroj…",
    "transfer.copyingToLocal": "Kopiranje '{name}' lokalno…",
    "transfer.copyingBatchToMachine":
      "Kopiranje {count} odabranih stavki na stroj…",
    "transfer.copiedToMachine": "Kopirano '{name}' na stroj.",
    "transfer.copiedToLocal": "Kopirano '{name}' lokalno.",
    "transfer.batchToMachineSummary":
      "Kopiranje na stroj završeno: {copied} kopirano, {skipped} preskočeno, {failed} neuspješno.",
    "transfer.cancelled":
      "Kopiranje otkazano. Postojeći sadržaj odredišta nije promijenjen.",
    "transfer.chooseFileFirst":
      "Odaberite datoteku ili mapu i odredišnu mapu prije kopiranja.",
    "transfer.selectMachineFirst":
      "Odaberite dostupan stroj prije kopiranja na stroj.",
    "transfer.overwritePrompt":
      "{message}\n\nPrepisati '{name}' u {dest}?",
    "transfer.overwriteFolderPrompt":
      "{message}\n\nNastaviti sa spajanjem mape '{name}' u {dest}? Postojeće datoteke istog naziva bit će prepisane.",
    "transfer.machineDest": "mapi stroja",
    "transfer.localDest": "lokalnoj mapi",

    // Status bar
    "status.ready": "Spreman",
    "status.loadingConfig": "Učitavanje konfiguracije…",
    "status.configLoaded": "Učitano {count} stroj(eva)",
    "status.configWarnings":
      "Konfiguracija učitana s {count} upozorenje(m). Pogledajte konzolu.",
    "status.configFailed":
      "Greška pri učitavanju konfiguracije: {error}",
    "status.checking": "Provjera {name}…",
    "status.machineOnline": "{name} — Dostupan",
    "status.machineStatus": "{name} — {status} ({path})",
    "status.machineError": "Greška pri provjeri {name}: {error}",
    "status.machineReady": "Mapa stroja učitana: {path}",
    "status.machineLoadError": "Greška mape stroja: {error}",
    "status.localReady": "Lokalna mapa učitana: {path}",
    "status.localError": "Greška lokalne mape: {error}",
    "status.localSearchError": "Greška lokalne pretrage: {error}",
    "status.defaultLocalLoaded": "Zadana lokalna mapa učitana.",
    "status.defaultLocalInvalid":
      "Zadana lokalna mapa nije dostupna. Odaberite mapu ručno.",

    // Machine settings modal — general
    "settings.machine.title": "Postavke stroja",
    "settings.machine.subtitle": "Uređivanje profila strojeva pohranjenih u",
    "settings.machine.editMessage":
      "Uredite strojeve i spremite kada budete gotovi.",
    "settings.machine.fixErrors":
      "Ispravite označena polja prije spremanja.",
    "settings.machine.backendErrors":
      "Provjera je pronašla probleme koje treba riješiti.",
    "settings.machine.noProfilesSaved":
      "Ništa nije spremljeno. Ispravite greške iznad.",
    "settings.machine.savedWithWarnings":
      "Spremljeno s upozorenjima. Pregledajte poruke iznad.",
    "settings.machine.openError":
      "Nije moguće otvoriti postavke stroja: {error}",
    "settings.machine.saveError":
      "Nije moguće spremiti postavke stroja: {error}",
    "settings.machine.enterPath":
      "Unesite putanju prije testiranja dostupnosti.",
    "settings.machine.checking": "Provjera {name}…",
    "settings.machine.checkResult": "Dostupnost: {status}.",
    "settings.machine.checkFailed":
      "Provjera dostupnosti neuspješna: {error}",
    "settings.machine.discardConfirm":
      "Odbaciti nespremljene promjene postavki stroja?",
    "settings.machine.removeProtectedPrompt":
      '"{name}" je zaštićen.\nUnesite njegov id ({id}) za potvrdu uklanjanja.',
    "settings.machine.protectedNotRemoved":
      "Zaštićeni stroj nije uklonjen.",
    "settings.machine.empty":
      "Dodajte stroj ili odaberite postojeći.",
    "settings.machine.noMachinesInList":
      "Nema strojeva. Dodajte jedan za početak.",
    "settings.machine.unnamed": "(Stroj bez naziva)",
    "settings.machine.pathNotSet": "Putanja nije postavljena",
    "settings.machine.protectedBadge": "Zaštićen",

    // Machine settings — form labels
    "settings.machine.id": "ID",
    "settings.machine.name": "Naziv",
    "settings.machine.locationType": "Tip lokacije",
    "settings.machine.location.local": "Lokalni",
    "settings.machine.location.networkShare": "Mrežni disk",
    "settings.machine.location.usb": "USB",
    "settings.machine.protected": "Zaštićen",
    "settings.machine.path": "Putanja",
    "settings.machine.extensions": "Dozvoljene ekstenzije",
    "settings.machine.extensionsPlaceholder": ".nc, .tap, .txt, .pdf",
    "settings.machine.cncPreset": "CNC predložak",
    "settings.machine.notes": "Bilješke",

    // Machine settings — buttons
    "btn.add": "Dodaj",
    "btn.duplicate": "Dupliciraj",
    "btn.remove": "Ukloni",
    "btn.cancel": "Odustani",
    "btn.close": "Zatvori",
    "btn.saveMachineSettings": "Spremi postavke stroja",
    "btn.testAvailability": "Testiraj dostupnost",

    // Status messages from machine settings
    "status.savedMachines": "Spremljeno {count} postavki stroja.",
    "status.savedMachinesWithWarnings":
      "Spremljeno {count} stroj(eva) s upozorenjima.",
    "status.noProfilesSaved":
      "Ništa nije spremljeno. Ispravite greške iznad.",

    // App settings modal
    "settings.app.title": "Postavke aplikacije",
    "settings.app.defaultLocalPath": "Zadana lokalna mapa",
    "settings.app.defaultLocalPathPlaceholder":
      "npr. C:\\CNC\\Programi",
    "settings.app.language": "Jezik",
    "settings.app.saved": "Postavke spremljene.",
    "settings.app.saveError": "Nije moguće spremiti postavke: {error}",
    "btn.browse": "Pregledaj…",
    "btn.saveAppSettings": "Spremi postavke",

    // Validation errors (client-side)
    "validation.idRequired": "Red {row}: id stroja je obavezan.",
    "validation.dupId": 'Red {row}: duplikat id-a stroja "{id}".',
    "validation.nameRequired": "Red {row}: naziv stroja je obavezan.",
    "validation.dupName": 'Red {row}: duplikat naziva stroja "{name}".',
    "validation.pathRequired": "Red {row}: putanja stroja je obavezna.",
  },
};

/** Translate a key. Optionally substitute {var} placeholders. */
export function t(key: string, vars?: Record<string, string>): string {
  const lang = (state.get("language") ?? "hr") as Language;
  const dict = translations[lang] ?? translations.en;
  let text = dict[key] ?? translations.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }
  return text;
}

/**
 * Update all elements with data-i18n / data-i18n-placeholder attributes.
 * Call on boot and on language change.
 */
export function applyStaticLabels(): void {
  document.documentElement.lang = state.get("language") === "hr" ? "hr" : "en";

  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = (el as HTMLElement).dataset.i18n!;
    el.textContent = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = (el as HTMLElement).dataset.i18nPlaceholder!;
    (el as HTMLInputElement).placeholder = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const key = (el as HTMLElement).dataset.i18nTitle!;
    (el as HTMLElement).title = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    const key = (el as HTMLElement).dataset.i18nAriaLabel!;
    (el as HTMLElement).setAttribute("aria-label", t(key));
  }
}
