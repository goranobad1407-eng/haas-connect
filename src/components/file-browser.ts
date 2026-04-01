import { open } from "@tauri-apps/plugin-dialog";

import { deleteDirectoryContents, deleteEntry, listDirectory, openExternal, transferFile } from "../api";
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
const deleteMachineEntryButton = () =>
  document.getElementById("btn-delete-machine-entry") as HTMLButtonElement;
const deleteMachineFolderContentsButton = () =>
  document.getElementById("btn-delete-machine-folder-contents") as HTMLButtonElement;

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
const openLocalEntryButton = () =>
  document.getElementById("btn-open-local-entry") as HTMLButtonElement;
const localBackButton = () =>
  document.getElementById("btn-local-back") as HTMLButtonElement;
const localForwardButton = () =>
  document.getElementById("btn-local-forward") as HTMLButtonElement;
const localUpButton = () =>
  document.getElementById("btn-local-up") as HTMLButtonElement;
const copyToMachineButton = () =>
  document.getElementById("btn-copy-to-machine") as HTMLButtonElement;
const appRootEl = () =>
  document.getElementById("app") as HTMLElement;
const browserPanelEl = () =>
  document.getElementById("browser-panel") as HTMLElement;
const previewPanelEl = () =>
  document.getElementById("preview-panel") as HTMLElement;
const contextMenuEl = () =>
  document.getElementById("file-context-menu") as HTMLDivElement;
const contextMenuDeleteButton = () =>
  document.getElementById("context-menu-delete") as HTMLButtonElement;
const contextMenuEditButton = () =>
  document.getElementById("context-menu-edit") as HTMLButtonElement;

const LOCAL_EDITABLE_EXTENSIONS = new Set([".nc", ".tap", ".cnc", ".txt"]);
type LocalNavigationEntry = { path: string; breadcrumb: string[] };
let contextMenuTarget: { pane: PaneKind; entry: BrowserEntry } | null = null;
let localNavigationHistory: LocalNavigationEntry[] = [];
let localNavigationIndex = -1;

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

function isLocalExternallyOpenable(
  entry: BrowserEntry | null | undefined
): entry is BrowserEntry {
  return !!entry && !entry.is_dir && LOCAL_EDITABLE_EXTENSIONS.has(entry.extension);
}

function resetLocalNavigationHistory(): void {
  localNavigationHistory = [];
  localNavigationIndex = -1;
}

function recordLocalNavigation(path: string, breadcrumb: string[]): void {
  const current = localNavigationHistory[localNavigationIndex];
  if (current?.path === path) {
    current.breadcrumb = [...breadcrumb];
    return;
  }

  localNavigationHistory = localNavigationHistory.slice(0, localNavigationIndex + 1);
  localNavigationHistory.push({
    path,
    breadcrumb: [...breadcrumb],
  });
  localNavigationIndex = localNavigationHistory.length - 1;
}

function updateLocalNavigationButtons(): void {
  const hasRoot = !!state.get("local_root");
  const canGoBack = localNavigationIndex > 0;
  const canGoForward =
    localNavigationIndex >= 0 &&
    localNavigationIndex < localNavigationHistory.length - 1;
  const canGoUp = hasRoot && state.get("local_breadcrumb").length > 0;

  localBackButton().disabled = !canGoBack;
  localForwardButton().disabled = !canGoForward;
  localUpButton().disabled = !canGoUp;
}

async function openLocalEntryExternally(entry: BrowserEntry): Promise<void> {
  try {
    await openExternal(entry.path);
  } catch (error) {
    setStatus(t("preview.openError", { error: String(error) }));
  }
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
  row.dataset.pane = pane;

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
    selectEntry(pane, entry, row);
  });

  row.addEventListener("dblclick", () => {
    if (entry.is_dir) {
      const nextBreadcrumb = [...getBreadcrumb(pane), entry.name];
      if (pane === "machine") {
        void loadMachineDirectory(entry.path, nextBreadcrumb);
      } else {
        void loadLocalDirectory(entry.path, nextBreadcrumb);
      }
      return;
    }

    if (pane === "local" && isLocalExternallyOpenable(entry)) {
      void openLocalEntryExternally(entry);
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

function clearMachineSelectionAfterDelete(): void {
  const active = state.get("active_selection");
  const clearMachinePreview = active?.pane === "machine";

  state.patch({
    selected_machine_entry: null,
    ...(clearMachinePreview
      ? {
          active_selection: null,
          preview: null,
        }
      : {}),
  });
  clearPaneSelectionVisual("machine");
}

function canDeleteViaContextMenu(
  pane: PaneKind,
  _entry: BrowserEntry
): boolean {
  if (pane === "local") {
    return true;
  }

  const machine = state.get("selected_machine");
  return !!machine && !machine.protected;
}

function canEditViaContextMenu(
  pane: PaneKind,
  entry: BrowserEntry
): boolean {
  return (
    pane === "local" &&
    !entry.is_dir &&
    LOCAL_EDITABLE_EXTENSIONS.has(entry.extension)
  );
}

function hideContextMenu(): void {
  contextMenuTarget = null;
  contextMenuEl().hidden = true;
}

function showContextMenu(
  x: number,
  y: number,
  pane: PaneKind,
  entry: BrowserEntry
): void {
  const canDelete = canDeleteViaContextMenu(pane, entry);
  const canEdit = canEditViaContextMenu(pane, entry);

  if (!canDelete && !canEdit) {
    hideContextMenu();
    return;
  }

  const menu = contextMenuEl();
  contextMenuTarget = { pane, entry };

  contextMenuDeleteButton().hidden = !canDelete;
  contextMenuEditButton().hidden = !canEdit;

  menu.hidden = false;

  const menuRect = menu.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${Math.min(x, maxLeft)}px`;
  menu.style.top = `${Math.min(y, maxTop)}px`;
}

async function handleContextMenuDelete(): Promise<void> {
  const target = contextMenuTarget;
  hideContextMenu();
  if (!target) return;

  const { pane, entry } = target;
  const confirmed = window.confirm(
    t("preview.deleteConfirm", { name: entry.name })
  );
  if (!confirmed) {
    return;
  }

  try {
    await deleteEntry(entry.path);

    if (pane === "machine") {
      clearMachineSelectionAfterDelete();
      setStatus(t("preview.deleted", { name: entry.name }), 4000);
      await refreshMachineDirectory();
    } else {
      clearPaneSelection("local");
      setStatus(t("preview.deleted", { name: entry.name }), 4000);
      await refreshLocalDirectory();
    }
  } catch (error) {
    setStatus(t("preview.deleteError", { error: String(error) }));
  }
}

async function handleContextMenuEdit(): Promise<void> {
  const target = contextMenuTarget;
  hideContextMenu();
  if (!target || !canEditViaContextMenu(target.pane, target.entry)) {
    return;
  }

  await openLocalEntryExternally(target.entry);
}

function bindAppContextMenu(): void {
  const handleRelevantContextMenu = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("input, textarea, select, [contenteditable='true']")) {
      return;
    }

    event.preventDefault();

    const row = target.closest("#machine-file-list li, #local-file-list li");
    if (!(row instanceof HTMLLIElement)) {
      hideContextMenu();
      return;
    }

    const pane = row.dataset.pane as PaneKind | undefined;
    const path = row.dataset.path;
    if (!pane || !path) {
      hideContextMenu();
      return;
    }

    const entry = getEntries(pane).find((candidate) => candidate.path === path);
    if (!entry) {
      hideContextMenu();
      return;
    }

    selectEntry(pane, entry, row);
    showContextMenu(event.clientX, event.clientY, pane, entry);
  };

  appRootEl().addEventListener("contextmenu", handleRelevantContextMenu);
  document.addEventListener("click", () => hideContextMenu());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideContextMenu();
    }
  });
  browserPanelEl().addEventListener("scroll", () => hideContextMenu(), true);
  previewPanelEl().addEventListener("scroll", () => hideContextMenu(), true);
  window.addEventListener("blur", () => hideContextMenu());

  contextMenuDeleteButton().addEventListener("click", () => {
    void handleContextMenuDelete();
  });
  contextMenuEditButton().addEventListener("click", () => {
    void handleContextMenuEdit();
  });
}

async function navigateLocalHistory(direction: -1 | 1): Promise<void> {
  const nextIndex = localNavigationIndex + direction;
  const target = localNavigationHistory[nextIndex];
  if (!target) {
    return;
  }

  localNavigationIndex = nextIndex;
  await loadLocalDirectory(target.path, [...target.breadcrumb], {
    recordHistory: false,
  });
}

async function navigateLocalUp(): Promise<void> {
  const root = state.get("local_root");
  if (!root) {
    return;
  }

  const breadcrumb = state.get("local_breadcrumb");
  if (breadcrumb.length === 0) {
    return;
  }

  const parentBreadcrumb = breadcrumb.slice(0, -1);
  const parentPath =
    parentBreadcrumb.length === 0 ? root : buildPath(root, parentBreadcrumb);

  await loadLocalDirectory(parentPath, parentBreadcrumb);
}

async function openSelectedLocalEntry(): Promise<void> {
  const entry = state.get("selected_local_entry");
  if (!isLocalExternallyOpenable(entry)) {
    return;
  }

  await openLocalEntryExternally(entry);
}

function selectEntryByPath(pane: PaneKind, path: string): void {
  const match = getEntries(pane).find((entry) => entry.path === path);
  if (!match) return;

  const list = pane === "machine" ? machineListEl() : localListEl();
  const row = list.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!(row instanceof HTMLLIElement)) return;

  selectEntry(pane, match, row);
}

export async function loadMachineDirectory(
  path: string,
  breadcrumb: string[]
): Promise<BrowserEntry[]> {
  hideContextMenu();

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
  breadcrumb: string[],
  options?: { recordHistory?: boolean }
): Promise<BrowserEntry[]> {
  hideContextMenu();

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
    if (options?.recordHistory !== false) {
      recordLocalNavigation(path, breadcrumb);
    }
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
    updateLocalNavigationButtons();
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

  await loadLocalDirectory(currentPath, [...state.get("local_breadcrumb")], {
    recordHistory: false,
  });
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

  resetLocalNavigationHistory();
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
  const machineDeleteAllowed =
    !!machine &&
    !machine.protected &&
    machineStatus === "online" &&
    !!state.get("machine_current_path");

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

  openLocalEntryButton().disabled = !isLocalExternallyOpenable(
    state.get("selected_local_entry")
  );

  deleteMachineEntryButton().disabled =
    !machineDeleteAllowed || !state.get("selected_machine_entry");
  deleteMachineFolderContentsButton().disabled =
    !machineDeleteAllowed || state.get("machine_entries").length === 0;
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
  const promptKey = result.is_directory
    ? "transfer.overwriteFolderPrompt"
    : "transfer.overwritePrompt";
  const confirmed = window.confirm(
    t(promptKey, {
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

async function deleteSelectedMachineEntry(): Promise<void> {
  const machine = state.get("selected_machine");
  const entry = state.get("selected_machine_entry");

  if (!machine || machine.protected || !entry) {
    return;
  }

  const confirmed = window.confirm(
    t("preview.deleteConfirm", { name: entry.name })
  );
  if (!confirmed) {
    return;
  }

  try {
    await deleteEntry(entry.path);
    clearMachineSelectionAfterDelete();
    setStatus(t("preview.deleted", { name: entry.name }), 4000);
    await refreshMachineDirectory();
  } catch (error) {
    setStatus(t("preview.deleteError", { error: String(error) }));
  }
}

async function deleteAllMachineFolderContents(): Promise<void> {
  const machine = state.get("selected_machine");
  const currentPath = state.get("machine_current_path");
  const entryCount = state.get("machine_entries").length;

  if (!machine || machine.protected || !currentPath || entryCount === 0) {
    return;
  }

  const confirmed = window.confirm(
    t("machine.deleteAllConfirm", {
      path: currentPath,
      count: String(entryCount),
    })
  );
  if (!confirmed) {
    return;
  }

  try {
    const deletedCount = await deleteDirectoryContents(currentPath);
    clearMachineSelectionAfterDelete();
    setStatus(
      t("machine.deleteAllDone", {
        count: String(deletedCount),
      }),
      5000
    );
    await refreshMachineDirectory();
  } catch (error) {
    setStatus(t("machine.deleteAllError", { error: String(error) }));
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
  bindAppContextMenu();

  chooseLocalFolderButton().addEventListener("click", () => {
    void chooseLocalRoot();
  });
  openLocalEntryButton().addEventListener("click", () => {
    void openSelectedLocalEntry();
  });
  localBackButton().addEventListener("click", () => {
    void navigateLocalHistory(-1);
  });
  localForwardButton().addEventListener("click", () => {
    void navigateLocalHistory(1);
  });
  localUpButton().addEventListener("click", () => {
    void navigateLocalUp();
  });
  copyToMachineButton().addEventListener("click", () => {
    void runTransfer("to_machine");
  });
  copyToLocalButton().addEventListener("click", () => {
    void runTransfer("to_local");
  });
  deleteMachineEntryButton().addEventListener("click", () => {
    void deleteSelectedMachineEntry();
  });
  deleteMachineFolderContentsButton().addEventListener("click", () => {
    void deleteAllMachineFolderContents();
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
    if (!state.get("local_root")) {
      resetLocalNavigationHistory();
    }
    updateLocalNavigationButtons();
    updateTransferButtons();
  });
  state.subscribe("machine_current_path", () => updateTransferButtons());
  state.subscribe("local_current_path", () => {
    updateTransferButtons();
    updateLocalNavigationButtons();
  });
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
  updateLocalNavigationButtons();
  updateTransferButtons();
}
