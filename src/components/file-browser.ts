import { open } from "@tauri-apps/plugin-dialog";

import { listDirectory, transferFile } from "../api";
import { state } from "../state";
import { t, applyStaticLabels } from "../translations";
import type {
  AvailabilityStatus,
  BrowserEntry,
  PaneKind,
  TransferFileResult,
} from "../types/index";
import { setStatus } from "./status-bar";

const machineListEl = () =>
  document.getElementById("machine-file-list") as HTMLUListElement;
const machinePlaceholderEl = () =>
  document.getElementById("machine-file-list-placeholder") as HTMLDivElement;
const machineBreadcrumbEl = () =>
  document.getElementById("machine-breadcrumb") as HTMLDivElement;
const machineStatusEl = () =>
  document.getElementById("machine-pane-status") as HTMLSpanElement;
const copyToLocalButton = () =>
  document.getElementById("btn-copy-to-local") as HTMLButtonElement;

const localListEl = () =>
  document.getElementById("local-file-list") as HTMLUListElement;
const localPlaceholderEl = () =>
  document.getElementById("local-file-list-placeholder") as HTMLDivElement;
const localBreadcrumbEl = () =>
  document.getElementById("local-breadcrumb") as HTMLDivElement;
const localStatusEl = () =>
  document.getElementById("local-pane-status") as HTMLSpanElement;
const chooseLocalFolderButton = () =>
  document.getElementById("btn-choose-local-folder") as HTMLButtonElement;
const copyToMachineButton = () =>
  document.getElementById("btn-copy-to-machine") as HTMLButtonElement;

function buildPath(base: string, crumbs: string[]): string {
  let path = base.replace(/\\/g, "/").replace(/\/$/, "");
  for (const crumb of crumbs) {
    path = `${path}/${crumb}`;
  }
  return path;
}

function showPlaceholder(pane: PaneKind, message: string): void {
  const placeholder =
    pane === "machine" ? machinePlaceholderEl() : localPlaceholderEl();
  const list = pane === "machine" ? machineListEl() : localListEl();
  placeholder.textContent = message;
  placeholder.hidden = false;
  list.hidden = true;
}

function showList(pane: PaneKind): void {
  const placeholder =
    pane === "machine" ? machinePlaceholderEl() : localPlaceholderEl();
  const list = pane === "machine" ? machineListEl() : localListEl();
  placeholder.hidden = true;
  list.hidden = false;
}

function getEntries(pane: PaneKind): BrowserEntry[] {
  return pane === "machine"
    ? state.get("machine_entries")
    : state.get("local_entries");
}

function getBreadcrumb(pane: PaneKind): string[] {
  return pane === "machine"
    ? state.get("machine_breadcrumb")
    : state.get("local_breadcrumb");
}

function clearPaneSelection(pane: PaneKind): void {
  const list = pane === "machine" ? machineListEl() : localListEl();
  for (const row of list.querySelectorAll(".entry-selected")) {
    row.classList.remove("entry-selected");
  }

  if (pane === "machine") {
    state.set("selected_machine_entry", null);
  } else {
    state.set("selected_local_entry", null);
  }

  const active = state.get("active_selection");
  if (active?.pane === pane) {
    state.patch({ active_selection: null, preview: null });
  }
}

function updateBreadcrumb(pane: PaneKind): void {
  const target =
    pane === "machine" ? machineBreadcrumbEl() : localBreadcrumbEl();
  const crumbs = getBreadcrumb(pane);
  const baseLabel =
    pane === "machine"
      ? state.get("selected_machine")?.name ?? t("pane.machine")
      : state.get("local_root") ?? t("pane.local");

  if (pane === "machine" && !state.get("selected_machine")) {
    target.textContent = t("pane.machineSelectPrompt");
    return;
  }

  if (pane === "local" && !state.get("local_root")) {
    target.textContent = t("pane.localChooseFolder");
    return;
  }

  const parts = [baseLabel, ...crumbs];
  target.innerHTML = "";

  parts.forEach((part, index) => {
    const span = document.createElement("span");
    span.textContent = part;

    if (index < parts.length - 1) {
      span.className = "crumb crumb-link";
      span.addEventListener("click", () => {
        void navigateToDepth(pane, index);
      });
    } else {
      span.className = "crumb crumb-current";
    }

    target.appendChild(span);

    if (index < parts.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = " › ";
      target.appendChild(sep);
    }
  });
}

async function navigateToDepth(
  pane: PaneKind,
  depth: number
): Promise<void> {
  const root =
    pane === "machine"
      ? state.get("selected_machine")?.path ?? null
      : state.get("local_root");
  if (!root) return;

  const newBreadcrumb = getBreadcrumb(pane).slice(0, depth);
  const path = depth === 0 ? root : buildPath(root, newBreadcrumb);

  if (pane === "machine") {
    await loadMachineDirectory(path, newBreadcrumb);
  } else {
    await loadLocalDirectory(path, newBreadcrumb);
  }
}

function renderEntries(pane: PaneKind, entries: BrowserEntry[]): void {
  const list = pane === "machine" ? machineListEl() : localListEl();
  list.innerHTML = "";

  if (entries.length === 0) {
    showPlaceholder(pane, t("pane.dirEmpty"));
    return;
  }

  showList(pane);
  for (const entry of entries) {
    list.appendChild(buildEntryItem(pane, entry));
  }
}

function buildEntryItem(pane: PaneKind, entry: BrowserEntry): HTMLLIElement {
  const row = document.createElement("li");
  row.className = entry.is_dir ? "entry-dir" : "entry-file";
  row.dataset.path = entry.path;

  const icon = document.createElement("span");
  icon.className = "entry-icon";
  icon.textContent = entry.is_dir ? "📁" : fileIcon(entry.extension);

  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = entry.name;

  const meta = document.createElement("span");
  meta.className = "entry-meta";
  meta.textContent =
    !entry.is_dir && entry.size !== null ? formatSize(entry.size) : "";

  row.append(icon, name, meta);

  row.addEventListener("click", () => {
    if (!entry.is_dir) {
      selectEntry(pane, entry, row);
    }
  });

  row.addEventListener("dblclick", () => {
    if (!entry.is_dir) return;

    const nextBreadcrumb = [...getBreadcrumb(pane), entry.name];
    if (pane === "machine") {
      void loadMachineDirectory(entry.path, nextBreadcrumb);
    } else {
      void loadLocalDirectory(entry.path, nextBreadcrumb);
    }
  });

  return row;
}

function selectEntry(
  pane: PaneKind,
  entry: BrowserEntry,
  row: HTMLLIElement
): void {
  clearPaneSelection(pane);
  row.classList.add("entry-selected");

  if (pane === "machine") {
    state.set("selected_machine_entry", entry);
    state.set("selected_local_entry", null);
    clearPaneSelectionVisual("local");
  } else {
    state.set("selected_local_entry", entry);
    state.set("selected_machine_entry", null);
    clearPaneSelectionVisual("machine");
  }

  state.set("active_selection", { pane, entry });
  updateTransferButtons();
}

function clearPaneSelectionVisual(pane: PaneKind): void {
  const list = pane === "machine" ? machineListEl() : localListEl();
  for (const row of list.querySelectorAll(".entry-selected")) {
    row.classList.remove("entry-selected");
  }
}

function selectEntryByPath(pane: PaneKind, path: string): void {
  const match = getEntries(pane).find((entry) => entry.path === path);
  if (!match || match.is_dir) return;

  const list = pane === "machine" ? machineListEl() : localListEl();
  const row = list.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!(row instanceof HTMLLIElement)) return;

  selectEntry(pane, match, row);
}

export async function loadMachineDirectory(
  path: string,
  breadcrumb: string[]
): Promise<BrowserEntry[]> {
  state.patch({
    machine_current_path: path,
    machine_breadcrumb: breadcrumb,
    machine_entries: [],
    selected_machine_entry: null,
    is_loading_machine_directory: true,
  });

  const active = state.get("active_selection");
  if (active?.pane === "machine") {
    state.patch({ active_selection: null, preview: null });
  }

  updateBreadcrumb("machine");
  showPlaceholder("machine", t("pane.machineLoading"));

  try {
    const entries = await listDirectory(path);
    state.patch({
      machine_entries: entries,
      is_loading_machine_directory: false,
    });
    renderEntries("machine", entries);
    setStatus(t("status.machineReady", { path }));
    return entries;
  } catch (error) {
    state.set("is_loading_machine_directory", false);
    showPlaceholder("machine", `${t("status.machineLoadError", { error: String(error) })}`);
    setStatus(t("status.machineLoadError", { error: String(error) }));
    return [];
  } finally {
    updateTransferButtons();
  }
}

export async function loadLocalDirectory(
  path: string,
  breadcrumb: string[]
): Promise<BrowserEntry[]> {
  state.patch({
    local_current_path: path,
    local_breadcrumb: breadcrumb,
    local_entries: [],
    selected_local_entry: null,
    is_loading_local_directory: true,
  });

  const active = state.get("active_selection");
  if (active?.pane === "local") {
    state.patch({ active_selection: null, preview: null });
  }

  updateBreadcrumb("local");
  showPlaceholder("local", t("pane.localLoading"));

  try {
    const entries = await listDirectory(path);
    state.patch({
      local_entries: entries,
      is_loading_local_directory: false,
    });
    renderEntries("local", entries);
    setStatus(t("status.localReady", { path }));
    return entries;
  } catch (error) {
    state.set("is_loading_local_directory", false);
    showPlaceholder("local", t("status.localError", { error: String(error) }));
    setStatus(t("status.localError", { error: String(error) }));
    return [];
  } finally {
    updateTransferButtons();
  }
}

export async function refreshMachineDirectory(
  selectedPath?: string
): Promise<void> {
  const currentPath = state.get("machine_current_path");
  if (!currentPath) return;

  await loadMachineDirectory(currentPath, [...state.get("machine_breadcrumb")]);
  if (selectedPath) {
    selectEntryByPath("machine", selectedPath);
  }
}

export async function refreshLocalDirectory(
  selectedPath?: string
): Promise<void> {
  const currentPath = state.get("local_current_path");
  if (!currentPath) return;

  await loadLocalDirectory(currentPath, [...state.get("local_breadcrumb")]);
  if (selectedPath) {
    selectEntryByPath("local", selectedPath);
  }
}

async function chooseLocalRoot(): Promise<void> {
  const result = await open({
    directory: true,
    multiple: false,
    defaultPath: state.get("local_root") ?? undefined,
  });

  if (typeof result !== "string") {
    return;
  }

  state.patch({
    local_root: result,
    local_current_path: null,
    local_breadcrumb: [],
    local_entries: [],
    selected_local_entry: null,
  });
  await loadLocalDirectory(result, []);
}

function updateMachinePaneStatus(): void {
  const machine = state.get("selected_machine");
  if (!machine) {
    machineStatusEl().textContent = t("pane.machineSelect");
    updateBreadcrumb("machine");
    return;
  }

  const status = state.get("machine_statuses").get(machine.id) ?? "unknown";
  const labels: Record<AvailabilityStatus, string> = {
    unknown: t("pane.machineNotChecked", { name: machine.name }),
    checking: t("pane.machineChecking", { name: machine.name }),
    online: t("pane.machineOnline"),
    offline: t("pane.machineOffline"),
    timeout: t("pane.machineTimeout"),
    error: t("pane.machineError"),
  };
  machineStatusEl().textContent = labels[status];
  updateBreadcrumb("machine");
}

function updateLocalPaneStatus(): void {
  const root = state.get("local_root");
  localStatusEl().textContent = root ?? t("pane.localChooseFolder");
  updateBreadcrumb("local");
}

function updateTransferButtons(): void {
  const machine = state.get("selected_machine");
  const machineStatus = machine
    ? state.get("machine_statuses").get(machine.id) ?? "unknown"
    : "unknown";

  copyToMachineButton().disabled =
    !machine ||
    machineStatus !== "online" ||
    !state.get("machine_current_path") ||
    !state.get("selected_local_entry");

  copyToLocalButton().disabled =
    !machine ||
    machineStatus !== "online" ||
    !state.get("local_current_path") ||
    !state.get("selected_machine_entry");
}

async function runTransfer(
  direction: "to_machine" | "to_local"
): Promise<void> {
  const config = state.get("config");
  if (!config) return;

  const machine = state.get("selected_machine");
  const timeoutSecs = config.check_timeout_secs;

  const sourceEntry =
    direction === "to_machine"
      ? state.get("selected_local_entry")
      : state.get("selected_machine_entry");
  const destinationDir =
    direction === "to_machine"
      ? state.get("machine_current_path")
      : state.get("local_current_path");

  if (!sourceEntry || !destinationDir) {
    setStatus(t("transfer.chooseFileFirst"));
    return;
  }

  if (direction === "to_machine" && !machine) {
    setStatus(t("transfer.selectMachineFirst"));
    return;
  }

  setStatus(
    direction === "to_machine"
      ? t("transfer.copyingToMachine", { name: sourceEntry.name })
      : t("transfer.copyingToLocal", { name: sourceEntry.name })
  );

  const firstAttempt = await transferFile(
    sourceEntry.path,
    destinationDir,
    false,
    timeoutSecs,
    direction === "to_machine" ? machine?.allowed_extensions : undefined,
    direction === "to_machine" ? machine?.path : undefined
  );

  const finalResult =
    firstAttempt.status === "overwrite_required"
      ? await retryWithOverwrite(
          direction,
          firstAttempt,
          sourceEntry.name,
          machine?.name
        )
      : firstAttempt;

  if (!finalResult) {
    return;
  }

  await applyTransferResult(direction, finalResult);
}

async function retryWithOverwrite(
  direction: "to_machine" | "to_local",
  result: TransferFileResult,
  fileName: string,
  machineName?: string
): Promise<TransferFileResult | null> {
  const dest =
    direction === "to_machine"
      ? `${machineName ?? t("pane.machine")} ${t("transfer.machineDest")}`
      : t("transfer.localDest");
  const confirmed = window.confirm(
    t("transfer.overwritePrompt", {
      message: result.message,
      name: fileName,
      dest,
    })
  );

  if (!confirmed) {
    setStatus(t("transfer.cancelled"));
    return null;
  }

  return transferFile(
    result.source_path,
    result.destination_dir,
    true,
    state.get("config")?.check_timeout_secs ?? 3,
    direction === "to_machine"
      ? state.get("selected_machine")?.allowed_extensions
      : undefined,
    direction === "to_machine" ? state.get("selected_machine")?.path : undefined
  );
}

async function applyTransferResult(
  direction: "to_machine" | "to_local",
  result: TransferFileResult
): Promise<void> {
  if (result.status !== "success") {
    setStatus(result.message);
    return;
  }

  if (direction === "to_machine") {
    setStatus(t("transfer.copiedToMachine", { name: result.file_name }), 5000);
    await refreshMachineDirectory(result.destination_path ?? undefined);
  } else {
    setStatus(t("transfer.copiedToLocal", { name: result.file_name }), 5000);
    await refreshLocalDirectory(result.destination_path ?? undefined);
  }
}

function fileIcon(extension: string): string {
  switch (extension) {
    case ".nc":
    case ".tap":
    case ".cnc":
      return "⚙";
    case ".pdf":
      return "📄";
    case ".txt":
      return "📝";
    default:
      return "📄";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initFileBrowser(): void {
  chooseLocalFolderButton().addEventListener("click", () => {
    void chooseLocalRoot();
  });
  copyToMachineButton().addEventListener("click", () => {
    void runTransfer("to_machine");
  });
  copyToLocalButton().addEventListener("click", () => {
    void runTransfer("to_local");
  });

  state.subscribe("selected_machine", (machine) => {
    updateMachinePaneStatus();
    if (!machine) {
      state.patch({
        machine_current_path: null,
        machine_breadcrumb: [],
        machine_entries: [],
        selected_machine_entry: null,
      });
      showPlaceholder("machine", t("pane.machineSelectPrompt"));
      updateTransferButtons();
    }
  });

  state.subscribe("machine_statuses", (statuses) => {
    const machine = state.get("selected_machine");
    if (!machine) return;

    const status = statuses.get(machine.id) ?? "unknown";
    updateMachinePaneStatus();

    if (status === "online" && state.get("machine_current_path") === null) {
      void loadMachineDirectory(machine.path, []);
      return;
    }

    if (status === "offline" || status === "timeout" || status === "error") {
      clearPaneSelection("machine");
      state.patch({
        machine_current_path: null,
        machine_breadcrumb: [],
        machine_entries: [],
      });
      const message =
        status === "offline"
          ? t("pane.machineUnavailable")
          : status === "timeout"
            ? t("pane.machineNoResponse")
            : t("pane.machineCheckFailed");
      showPlaceholder("machine", message);
      updateTransferButtons();
    }
  });

  state.subscribe("local_root", () => {
    updateLocalPaneStatus();
    updateTransferButtons();
  });
  state.subscribe("machine_current_path", () => updateTransferButtons());
  state.subscribe("local_current_path", () => updateTransferButtons());
  state.subscribe("selected_machine_entry", () => updateTransferButtons());
  state.subscribe("selected_local_entry", () => updateTransferButtons());

  // On language change: update all text in the pane that depends on state.
  state.subscribe("language", () => {
    applyStaticLabels();
    updateMachinePaneStatus();
    updateLocalPaneStatus();

    // Refresh machine pane placeholder if no files are showing.
    const machine = state.get("selected_machine");
    if (!machine) {
      showPlaceholder("machine", t("pane.machineSelectPrompt"));
    } else if (state.get("machine_entries").length === 0) {
      const mStatus =
        state.get("machine_statuses").get(machine.id) ?? "unknown";
      if (mStatus === "offline")
        showPlaceholder("machine", t("pane.machineUnavailable"));
      else if (mStatus === "timeout")
        showPlaceholder("machine", t("pane.machineNoResponse"));
      else if (mStatus === "error")
        showPlaceholder("machine", t("pane.machineCheckFailed"));
    }

    // Refresh local pane placeholder if no files are showing.
    if (!state.get("local_root")) {
      showPlaceholder("local", t("pane.localEmpty"));
    } else if (state.get("local_entries").length === 0) {
      showPlaceholder("local", t("pane.dirEmpty"));
    }
  });

  updateMachinePaneStatus();
  updateLocalPaneStatus();
  updateTransferButtons();
}
