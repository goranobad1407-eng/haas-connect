// Application entry point.
// Initialises state, loads config, wires up all components.

import { loadConfig, checkAvailability } from "./api";
import { applyConfigState } from "./config-state";
import { initMachineList, renderMachineList } from "./components/machine-list";
import { initFileBrowser, loadLocalDirectory } from "./components/file-browser";
import { initMachineSettings } from "./components/machine-settings";
import { initPreviewPane } from "./components/preview-pane";
import { initAppSettings } from "./components/app-settings";
import { setStatus } from "./components/status-bar";
import { state } from "./state";
import { t, applyStaticLabels } from "./translations";

async function boot(): Promise<void> {
  // Wire up components (subscriptions) before loading config
  // so they react to the first state change.
  initMachineList();
  initFileBrowser();
  initPreviewPane();
  initMachineSettings();
  initAppSettings();

  // Global language subscriber: update all static labels on language change.
  state.subscribe("language", () => {
    applyStaticLabels();
  });

  // Load config from disk.
  setStatus(t("status.loadingConfig"));

  try {
    const [config, warnings] = await loadConfig();
    applyConfigState(config, warnings);

    // Apply all static labels once config/language is resolved.
    applyStaticLabels();

    if (warnings.length > 0) {
      console.warn("Config warnings:", warnings);
      setStatus(
        t("status.configWarnings", { count: String(warnings.length) })
      );
    } else {
      setStatus(
        t("status.configLoaded", { count: String(config.machines.length) }),
        3000
      );
    }

    renderMachineList();

    // Auto-load default local path if configured.
    if (config.default_local_path) {
      void autoLoadDefaultLocalPath(config.default_local_path);
    }
  } catch (err) {
    setStatus(t("status.configFailed", { error: String(err) }));
    console.error("Config load error:", err);
  }
}

async function autoLoadDefaultLocalPath(path: string): Promise<void> {
  try {
    const availability = await checkAvailability(
      path,
      state.get("config")?.check_timeout_secs ?? 3
    );
    if (availability === "online") {
      state.patch({
        local_root: path,
        local_current_path: null,
        local_breadcrumb: [],
        local_entries: [],
        selected_local_entry: null,
        selected_local_entries: [],
      });
      await loadLocalDirectory(path, []);
      setStatus(t("status.defaultLocalLoaded"), 3000);
    } else {
      setStatus(t("status.defaultLocalInvalid"), 6000);
    }
  } catch {
    setStatus(t("status.defaultLocalInvalid"), 6000);
  }
}

// Start the app once the DOM is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  void boot();
}
