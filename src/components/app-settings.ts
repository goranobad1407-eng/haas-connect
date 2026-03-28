// Application Settings modal.
// Manages: default local folder and UI language.
// Separate from Machine Settings — no machine profile editing here.

import { open } from "@tauri-apps/plugin-dialog";
import { saveConfig } from "../api";
import { state } from "../state";
import { t, applyStaticLabels } from "../translations";
import type { Language } from "../types/index";
import { setStatus } from "./status-bar";

const modal = () =>
  document.getElementById("app-settings-modal") as HTMLDivElement;
const openButton = () =>
  document.getElementById("btn-app-settings") as HTMLButtonElement;
const closeButton = () =>
  document.getElementById("btn-app-settings-close") as HTMLButtonElement;
const cancelButton = () =>
  document.getElementById("btn-app-settings-cancel") as HTMLButtonElement;
const saveButton = () =>
  document.getElementById("btn-app-settings-save") as HTMLButtonElement;
const browseButton = () =>
  document.getElementById("btn-browse-local-path") as HTMLButtonElement;
const inputDefaultPath = () =>
  document.getElementById("app-default-local-path") as HTMLInputElement;
const selectLanguage = () =>
  document.getElementById("app-language") as HTMLSelectElement;
const messageEl = () =>
  document.getElementById("app-settings-message") as HTMLDivElement;

function setMessage(msg: string): void {
  messageEl().textContent = msg;
}

function openAppSettings(): void {
  const config = state.get("config");
  inputDefaultPath().value = config?.default_local_path ?? "";
  selectLanguage().value = state.get("language");
  setMessage("");
  modal().hidden = false;
}

function closeAppSettings(): void {
  modal().hidden = true;
}

async function browseLocalPath(): Promise<void> {
  const current = inputDefaultPath().value.trim();
  const result = await open({
    directory: true,
    multiple: false,
    defaultPath: current || undefined,
  });
  if (typeof result === "string") {
    inputDefaultPath().value = result;
  }
}

async function saveAppSettings(): Promise<void> {
  const config = state.get("config");
  if (!config) {
    setMessage("Config not loaded. Restart the app and try again.");
    return;
  }

  const newPath = inputDefaultPath().value.trim() || null;
  const newLang = selectLanguage().value as Language;

  const updatedConfig = {
    ...config,
    default_local_path: newPath,
    language: newLang,
  };

  try {
    await saveConfig(updatedConfig);
    // Apply new config and language immediately — no restart needed.
    state.set("config", updatedConfig);
    if (newLang !== state.get("language")) {
      state.set("language", newLang);
    }
    // Refresh all static labels now (language may have changed).
    applyStaticLabels();
    setMessage(t("settings.app.saved"));
    setStatus(t("settings.app.saved"), 4000);
  } catch (err) {
    setMessage(t("settings.app.saveError", { error: String(err) }));
    setStatus(t("settings.app.saveError", { error: String(err) }));
  }
}

export function initAppSettings(): void {
  openButton().addEventListener("click", () => openAppSettings());
  closeButton().addEventListener("click", () => closeAppSettings());
  cancelButton().addEventListener("click", () => closeAppSettings());
  saveButton().addEventListener("click", () => {
    void saveAppSettings();
  });
  browseButton().addEventListener("click", () => {
    void browseLocalPath();
  });

  // Close on backdrop click.
  modal().addEventListener("click", (event) => {
    if (event.target === modal()) closeAppSettings();
  });

  // Keep the modal message label in sync with language changes.
  state.subscribe("language", () => {
    // Update static button/label text inside the modal.
    applyStaticLabels();
  });
}
