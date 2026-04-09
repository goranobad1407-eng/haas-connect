import { open, confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  deleteDirectoryContents,
  deleteEntries,
  deleteEntry,
  isDirectory,
  listDirectory,
  openExternal,
  searchLocalEntries,
  setActiveLocalSearchRequest,
  transferFile,
} from "../api";
import { state } from "../state";
import { t, applyStaticLabels } from "../translations";
import type {
  AvailabilityStatus,
  BrowserEntry,
  MachineProfile,
  PaneKind,
  TransferFileResult,
} from "../types/index";
import { setStatus } from "./status-bar";

type TransferDirection = "to_machine" | "to_local";
type BatchTransferSummary = {
  copied: number;
  skipped: number;
  failed: number;
  lastDestinationPath: string | null;
};

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
const localSearchInput = () =>
  document.getElementById("local-search-input") as HTMLInputElement;
const copyToMachineButton = () =>
  document.getElementById("btn-copy-to-machine") as HTMLButtonElement;
const appRootEl = () =>
  document.getElementById("app") as HTMLElement;
const mainLayoutEl = () =>
  document.getElementById("main-layout") as HTMLElement;
const browserPanelEl = () =>
  document.getElementById("browser-panel") as HTMLElement;
const transferWorkspaceEl = () =>
  document.getElementById("transfer-workspace") as HTMLElement;
const previewPanelEl = () =>
  document.getElementById("preview-panel") as HTMLElement;
const machineBrowserSplitterEl = () =>
  document.getElementById("splitter-machine-browser") as HTMLDivElement;
const machinePaneEl = () =>
  document.getElementById("machine-pane") as HTMLElement;
const transferSplitterEl = () =>
  document.getElementById("splitter-transfer") as HTMLDivElement;
const browserPreviewSplitterEl = () =>
  document.getElementById("splitter-browser-preview") as HTMLDivElement;
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
let localSelectionAnchorPath: string | null = null;
let machineSelectionAnchorPath: string | null = null;
let localSearchQuery = "";
let localSearchDebounceHandle: number | null = null;
let localSearchRequestToken = 0;

const SIDEBAR_MIN_WIDTH = 230;
const CENTER_MIN_WIDTH = 660;
const PREVIEW_MIN_WIDTH = 320;
const TRANSFER_LEFT_MIN_WIDTH = 260;
const TRANSFER_RIGHT_MIN_WIDTH = 360;
const LOCAL_SEARCH_DEBOUNCE_MS = 320;
const LOCAL_SEARCH_MIN_QUERY_LENGTH = 5;
const LOCAL_SEARCH_CANCELLED_ERROR = "__local_search_cancelled__";
const SPLITTER_STORAGE_KEYS = {
  sidebar: "haas-connect-sidebar-width",
  preview: "haas-connect-preview-width",
  transferLeft: "haas-connect-transfer-left-width",
} as const;

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
    : getVisibleLocalEntries();
}

function getBreadcrumb(pane: PaneKind): string[] {
  return pane === "machine"
    ? state.get("machine_breadcrumb")
    : state.get("local_breadcrumb");
}

function getNormalizedLocalSearchQuery(): string {
  return localSearchQuery.trim();
}

function isLocalSearchActive(): boolean {
  return getNormalizedLocalSearchQuery().length > 0;
}

function shouldRunRecursiveLocalSearch(query = getNormalizedLocalSearchQuery()): boolean {
  return query.length >= LOCAL_SEARCH_MIN_QUERY_LENGTH;
}

function isLocalSearchBelowThreshold(query = getNormalizedLocalSearchQuery()): boolean {
  return query.length > 0 && query.length < LOCAL_SEARCH_MIN_QUERY_LENGTH;
}

function syncActiveLocalSearchRequest(): void {
  void setActiveLocalSearchRequest(localSearchRequestToken).catch(() => undefined);
}

function bumpLocalSearchRequestToken(): number {
  localSearchRequestToken += 1;
  syncActiveLocalSearchRequest();
  return localSearchRequestToken;
}

function getVisibleLocalEntries(): BrowserEntry[] {
  if (!shouldRunRecursiveLocalSearch()) {
    return state.get("local_entries");
  }

  const searchResults = state.get("local_search_results");
  if (state.get("is_loading_local_search")) {
    return searchResults ?? state.get("local_entries");
  }

  return searchResults ?? [];
}

function isLocalExternallyOpenable(
  entry: BrowserEntry | null | undefined
): entry is BrowserEntry {
  return !!entry && !entry.is_dir && LOCAL_EDITABLE_EXTENSIONS.has(entry.extension);
}

function getSelectedLocalEntries(): BrowserEntry[] {
  const selected = state.get("selected_local_entries");
  if (selected.length > 0) {
    return selected;
  }

  const single = state.get("selected_local_entry");
  return single ? [single] : [];
}

function getSelectedMachineEntries(): BrowserEntry[] {
  const selected = state.get("selected_machine_entries");
  if (selected.length > 0) {
    return selected;
  }

  const single = state.get("selected_machine_entry");
  return single ? [single] : [];
}

function orderedLocalEntriesFromPaths(paths: Set<string>): BrowserEntry[] {
  return getVisibleLocalEntries().filter((entry) => paths.has(entry.path));
}

function orderedMachineEntriesFromPaths(paths: Set<string>): BrowserEntry[] {
  return getEntries("machine").filter((entry) => paths.has(entry.path));
}

function resetLocalNavigationHistory(): void {
  localNavigationHistory = [];
  localNavigationIndex = -1;
  localSelectionAnchorPath = null;
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

function readStoredNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function storeNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Ignore storage failures and keep split sizes session-live only.
  }
}

function setMainLayoutWidth(variable: "--sidebar-width" | "--preview-width", value: number): void {
  mainLayoutEl().style.setProperty(variable, `${Math.round(value)}px`);
}

function setTransferLeftWidth(value: number): void {
  transferWorkspaceEl().style.setProperty("--transfer-left-width", `${Math.round(value)}px`);
}

function enforcePaneLayoutMinimums(): void {
  const layoutWidth = mainLayoutEl().clientWidth;
  if (layoutWidth > 0) {
    const safeSidebarMax = Math.max(
      SIDEBAR_MIN_WIDTH,
      layoutWidth - CENTER_MIN_WIDTH - PREVIEW_MIN_WIDTH - 12
    );
    const sidebarWidth = clamp(machinePanelWidth(), SIDEBAR_MIN_WIDTH, safeSidebarMax);
    setMainLayoutWidth("--sidebar-width", sidebarWidth);
    storeNumber(SPLITTER_STORAGE_KEYS.sidebar, sidebarWidth);

    const safePreviewMax = Math.max(
      PREVIEW_MIN_WIDTH,
      layoutWidth - sidebarWidth - CENTER_MIN_WIDTH - 12
    );
    const previewWidth = clamp(
      previewPanelEl().getBoundingClientRect().width,
      PREVIEW_MIN_WIDTH,
      safePreviewMax
    );
    setMainLayoutWidth("--preview-width", previewWidth);
    storeNumber(SPLITTER_STORAGE_KEYS.preview, previewWidth);
  }

  const workspaceWidth = transferWorkspaceEl().clientWidth;
  if (workspaceWidth > 0) {
    const safeTransferLeftMax = Math.max(
      TRANSFER_LEFT_MIN_WIDTH,
      workspaceWidth - TRANSFER_RIGHT_MIN_WIDTH - 6
    );
    const leftWidth = clamp(
      machineTransferPaneWidth(),
      TRANSFER_LEFT_MIN_WIDTH,
      safeTransferLeftMax
    );
    setTransferLeftWidth(leftWidth);
    storeNumber(SPLITTER_STORAGE_KEYS.transferLeft, leftWidth);
  }
}

function initPaneSplitters(): void {
  const storedSidebar = readStoredNumber(SPLITTER_STORAGE_KEYS.sidebar);
  const storedPreview = readStoredNumber(SPLITTER_STORAGE_KEYS.preview);
  const storedTransferLeft = readStoredNumber(SPLITTER_STORAGE_KEYS.transferLeft);

  if (storedSidebar !== null) {
    setMainLayoutWidth("--sidebar-width", Math.max(SIDEBAR_MIN_WIDTH, storedSidebar));
  }
  if (storedPreview !== null) {
    setMainLayoutWidth("--preview-width", Math.max(PREVIEW_MIN_WIDTH, storedPreview));
  }
  if (storedTransferLeft !== null) {
    setTransferLeftWidth(Math.max(TRANSFER_LEFT_MIN_WIDTH, storedTransferLeft));
  }

  enforcePaneLayoutMinimums();
  window.addEventListener("resize", enforcePaneLayoutMinimums);

  bindHorizontalSplitter({
    handle: machineBrowserSplitterEl(),
    onStart: () => {
      const previousPanel = machineBrowserSplitterEl().previousElementSibling;
      return {
        containerWidth: mainLayoutEl().clientWidth,
        startSidebarWidth:
          previousPanel instanceof HTMLElement
            ? previousPanel.getBoundingClientRect().width
            : SIDEBAR_MIN_WIDTH,
      };
    },
    onMove: (deltaX, ctx) => {
      const maxSidebar = ctx.containerWidth - CENTER_MIN_WIDTH - PREVIEW_MIN_WIDTH - 12;
      const next = clamp(ctx.startSidebarWidth + deltaX, SIDEBAR_MIN_WIDTH, maxSidebar);
      setMainLayoutWidth("--sidebar-width", next);
      storeNumber(SPLITTER_STORAGE_KEYS.sidebar, next);
    },
  });

  bindHorizontalSplitter({
    handle: browserPreviewSplitterEl(),
    onStart: () => ({
      containerWidth: mainLayoutEl().clientWidth,
      startPreviewWidth: previewPanelEl().getBoundingClientRect().width,
    }),
    onMove: (deltaX, ctx) => {
      const sidebarWidth = machinePanelWidth();
      const maxPreview =
        ctx.containerWidth - sidebarWidth - CENTER_MIN_WIDTH - 12;
      const next = clamp(ctx.startPreviewWidth - deltaX, PREVIEW_MIN_WIDTH, maxPreview);
      setMainLayoutWidth("--preview-width", next);
      storeNumber(SPLITTER_STORAGE_KEYS.preview, next);
    },
  });

  bindHorizontalSplitter({
    handle: transferSplitterEl(),
    onStart: () => ({
      containerWidth: transferWorkspaceEl().clientWidth,
      startLeftWidth: machineTransferPaneWidth(),
    }),
    onMove: (deltaX, ctx) => {
      const maxLeft = ctx.containerWidth - TRANSFER_RIGHT_MIN_WIDTH - 6;
      const next = clamp(
        ctx.startLeftWidth + deltaX,
        TRANSFER_LEFT_MIN_WIDTH,
        maxLeft
      );
      setTransferLeftWidth(next);
      storeNumber(SPLITTER_STORAGE_KEYS.transferLeft, next);
    },
  });
}

function machinePanelWidth(): number {
  const panel = document.getElementById("machine-panel");
  return panel instanceof HTMLElement
    ? panel.getBoundingClientRect().width
    : SIDEBAR_MIN_WIDTH;
}

function machineTransferPaneWidth(): number {
  const pane = transferWorkspaceEl().querySelector(".transfer-pane");
  return pane instanceof HTMLElement
    ? pane.getBoundingClientRect().width
    : TRANSFER_LEFT_MIN_WIDTH;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function bindHorizontalSplitter<TContext>({
  handle,
  onStart,
  onMove,
}: {
  handle: HTMLDivElement;
  onStart: () => TContext;
  onMove: (deltaX: number, context: TContext) => void;
}): void {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const context = onStart();

    handle.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      onMove(moveEvent.clientX - startX, context);
    };

    const stopDragging = (pointerId: number) => {
      handle.classList.remove("dragging");
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      stopDragging(upEvent.pointerId);
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      stopDragging(cancelEvent.pointerId);
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
  });
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
  const hadLocalSelections = pane === "local" && getSelectedLocalEntries().length > 0;
  const hadMachineSelections = pane === "machine" && getSelectedMachineEntries().length > 0;
  const list = pane === "machine" ? machineListEl() : localListEl();
  for (const row of list.querySelectorAll(".entry-selected")) {
    row.classList.remove("entry-selected");
  }

  if (pane === "machine") {
    state.patch({
      selected_machine_entry: null,
      selected_machine_entries: [],
    });
    machineSelectionAnchorPath = null;
  } else {
    state.patch({
      selected_local_entry: null,
      selected_local_entries: [],
    });
    localSelectionAnchorPath = null;
  }

  const active = state.get("active_selection");
  const shouldClearPreview =
    active?.pane === pane ||
    hadLocalSelections ||
    hadMachineSelections;
  if (shouldClearPreview) {
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

  const visibleEntries = pane === "local" ? getVisibleLocalEntries() : entries;

  if (visibleEntries.length === 0) {
    const message =
      pane === "local" && state.get("is_loading_local_search")
        ? t("pane.localSearching")
        : pane === "local" && shouldRunRecursiveLocalSearch()
          ? t("pane.localNoMatches", { query: getNormalizedLocalSearchQuery() })
        : t("pane.dirEmpty");
    showPlaceholder(pane, message);
    return;
  }

  showList(pane);
  for (const entry of visibleEntries) {
    list.appendChild(buildEntryItem(pane, entry));
  }
}

function buildEntryItem(pane: PaneKind, entry: BrowserEntry): HTMLLIElement {
  const row = document.createElement("li");
  row.className = entry.is_dir ? "entry-dir" : "entry-file";
  row.dataset.path = entry.path;
  row.dataset.pane = pane;
  row.title = entry.path;

  const icon = document.createElement("span");
  icon.className = "entry-icon";
  icon.textContent = entry.is_dir ? "📁" : fileIcon(entry.extension);

  const text = document.createElement("span");
  text.className = "entry-text";

  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = entry.name;
  text.appendChild(name);

  if (pane === "local" && entry.relative_path) {
    const subpath = document.createElement("span");
    subpath.className = "entry-subpath";
    subpath.textContent = entry.relative_path;
    text.appendChild(subpath);
  }

  const meta = document.createElement("span");
  meta.className = "entry-meta";
  meta.textContent =
    !entry.is_dir && entry.size !== null ? formatSize(entry.size) : "";

  row.append(icon, text, meta);

  row.addEventListener("click", (event) => {
    if (pane === "local") {
      handleLocalEntryClick(entry, event);
      return;
    }

    handleMachineEntryClick(entry, event);
  });

  row.addEventListener("dblclick", () => {
    if (entry.is_dir) {
      if (pane === "machine") {
        const nextBreadcrumb = [...getBreadcrumb(pane), entry.name];
        void loadMachineDirectory(entry.path, nextBreadcrumb);
      } else {
        void openLocalDirectoryEntry(entry);
      }
      return;
    }

    if (pane === "local" && isLocalExternallyOpenable(entry)) {
      void openLocalEntryExternally(entry);
    }
  });

  return row;
}

function syncLocalSelectionVisual(selectedPaths: Set<string>): void {
  for (const row of localListEl().querySelectorAll("li")) {
    if (!(row instanceof HTMLLIElement)) {
      continue;
    }
    row.classList.toggle("entry-selected", selectedPaths.has(row.dataset.path ?? ""));
  }
}

function syncMachineSelectionVisual(selectedPaths: Set<string>): void {
  for (const row of machineListEl().querySelectorAll("li")) {
    if (!(row instanceof HTMLLIElement)) {
      continue;
    }
    row.classList.toggle("entry-selected", selectedPaths.has(row.dataset.path ?? ""));
  }
}

function updateLocalSearchInput(): void {
  localSearchInput().value = localSearchQuery;
}

function cancelScheduledLocalSearch(): void {
  if (localSearchDebounceHandle !== null) {
    window.clearTimeout(localSearchDebounceHandle);
    localSearchDebounceHandle = null;
  }
}

function clearLocalSearchState(): void {
  state.patch({
    local_search_results: null,
    is_loading_local_search: false,
  });
}

function resetLocalSearch(): void {
  cancelScheduledLocalSearch();
  bumpLocalSearchRequestToken();
  if (!localSearchQuery) {
    clearLocalSearchState();
    updateLocalPaneStatus();
    return;
  }

  localSearchQuery = "";
  clearLocalSearchState();
  updateLocalSearchInput();
  updateLocalPaneStatus();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getLocalBreadcrumbForPath(path: string): string[] {
  const root = state.get("local_root");
  if (!root) {
    return [...state.get("local_breadcrumb")];
  }

  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  const normalizedRootLower = normalizedRoot.toLocaleLowerCase();
  const normalizedPathLower = normalizedPath.toLocaleLowerCase();

  if (normalizedPathLower === normalizedRootLower) {
    return [];
  }

  const prefix = `${normalizedRootLower}/`;
  if (!normalizedPathLower.startsWith(prefix)) {
    return [...state.get("local_breadcrumb")];
  }

  const relative = normalizedPath.slice(normalizedRoot.length + 1);
  return relative.length > 0 ? relative.split("/").filter(Boolean) : [];
}

async function executeLocalSearch(
  path: string,
  query: string,
  requestToken: number
): Promise<void> {
  try {
    const results = await searchLocalEntries(path, query, requestToken);
    if (
      requestToken !== localSearchRequestToken ||
      state.get("local_current_path") !== path ||
      getNormalizedLocalSearchQuery() !== query
    ) {
      return;
    }

    state.patch({
      local_search_results: results,
      is_loading_local_search: false,
    });
    updateLocalPaneStatus();
    renderEntries("local", state.get("local_entries"));
  } catch (error) {
    if (
      requestToken !== localSearchRequestToken ||
      String(error).includes(LOCAL_SEARCH_CANCELLED_ERROR)
    ) {
      return;
    }

    state.patch({
      local_search_results: [],
      is_loading_local_search: false,
    });
    updateLocalPaneStatus();
    showPlaceholder("local", t("status.localSearchError", { error: String(error) }));
    setStatus(t("status.localSearchError", { error: String(error) }));
  } finally {
    if (requestToken === localSearchRequestToken) {
      updateLocalPaneStatus();
      updateTransferButtons();
    }
  }
}

function scheduleLocalSearch(
  requestToken = bumpLocalSearchRequestToken(),
  options?: { immediate?: boolean }
): void {
  const path = state.get("local_current_path");
  const query = getNormalizedLocalSearchQuery();

  cancelScheduledLocalSearch();

  if (!path || !query) {
    clearLocalSearchState();
    updateLocalPaneStatus();
    renderEntries("local", state.get("local_entries"));
    updateTransferButtons();
    return;
  }

  if (!shouldRunRecursiveLocalSearch(query)) {
    clearLocalSearchState();
    updateLocalPaneStatus();
    renderEntries("local", state.get("local_entries"));
    updateTransferButtons();
    return;
  }

  const hasVisibleEntries = getVisibleLocalEntries().length > 0;
  state.set("is_loading_local_search", true);
  updateLocalPaneStatus();
  if (!hasVisibleEntries) {
    renderEntries("local", state.get("local_entries"));
  }

  const runSearch = () => {
    localSearchDebounceHandle = null;
    void executeLocalSearch(path, query, requestToken);
  };

  if (options?.immediate) {
    runSearch();
    return;
  }

  localSearchDebounceHandle = window.setTimeout(runSearch, LOCAL_SEARCH_DEBOUNCE_MS);
}

function handleLocalSearchInput(): void {
  const nextQuery = localSearchInput().value;
  if (nextQuery === localSearchQuery) {
    return;
  }

  localSearchQuery = nextQuery;
  const requestToken = bumpLocalSearchRequestToken();
  if (getSelectedLocalEntries().length > 0) {
    clearPaneSelection("local");
    clearPaneSelectionVisual("machine");
  }
  updateLocalPaneStatus();
  scheduleLocalSearch(requestToken);
}

async function openLocalDirectoryEntry(entry: BrowserEntry): Promise<void> {
  const breadcrumb = getLocalBreadcrumbForPath(entry.path);
  if (isLocalSearchActive()) {
    resetLocalSearch();
  }

  await loadLocalDirectory(entry.path, breadcrumb);
}

function setLocalSelection(
  entries: BrowserEntry[],
  primaryEntry?: BrowserEntry | null
): void {
  if (entries.length === 0) {
    clearPaneSelection("local");
    clearPaneSelectionVisual("machine");
    state.set("selected_machine_entry", null);
    updateTransferButtons();
    return;
  }

  const paths = new Set(entries.map((entry) => entry.path));
  const orderedEntries = orderedLocalEntriesFromPaths(paths);
  const primary =
    primaryEntry && paths.has(primaryEntry.path)
      ? primaryEntry
      : orderedEntries[orderedEntries.length - 1];

  syncLocalSelectionVisual(paths);
  clearPaneSelectionVisual("machine");
  localSelectionAnchorPath = primary?.path ?? null;

  if (orderedEntries.length === 1 && primary) {
    state.patch({
      selected_local_entry: primary,
      selected_local_entries: orderedEntries,
      selected_machine_entry: null,
      active_selection: { pane: "local", entry: primary },
    });
  } else {
    state.patch({
      selected_local_entry: null,
      selected_local_entries: orderedEntries,
      selected_machine_entry: null,
      active_selection: null,
      preview: null,
    });
  }

  updateTransferButtons();
}

function setMachineSelection(
  entries: BrowserEntry[],
  primaryEntry?: BrowserEntry | null
): void {
  if (entries.length === 0) {
    clearPaneSelection("machine");
    clearPaneSelectionVisual("local");
    state.set("selected_local_entry", null);
    state.set("selected_local_entries", []);
    updateTransferButtons();
    return;
  }

  const paths = new Set(entries.map((entry) => entry.path));
  const orderedEntries = orderedMachineEntriesFromPaths(paths);
  const primary =
    primaryEntry && paths.has(primaryEntry.path)
      ? primaryEntry
      : orderedEntries[orderedEntries.length - 1];

  syncMachineSelectionVisual(paths);
  clearPaneSelectionVisual("local");
  machineSelectionAnchorPath = primary?.path ?? null;

  if (orderedEntries.length === 1 && primary) {
    state.patch({
      selected_machine_entry: primary,
      selected_machine_entries: orderedEntries,
      selected_local_entry: null,
      selected_local_entries: [],
      active_selection: { pane: "machine", entry: primary },
    });
  } else {
    state.patch({
      selected_machine_entry: null,
      selected_machine_entries: orderedEntries,
      selected_local_entry: null,
      selected_local_entries: [],
      active_selection: null,
      preview: null,
    });
  }

  updateTransferButtons();
}

function selectMachineEntry(entry: BrowserEntry, row: HTMLLIElement): void {
  clearPaneSelection("machine");
  row.classList.add("entry-selected");
  clearPaneSelectionVisual("local");

  state.patch({
    selected_machine_entry: entry,
    selected_local_entry: null,
    selected_local_entries: [],
    active_selection: { pane: "machine", entry },
  });
  localSelectionAnchorPath = null;
  updateTransferButtons();
}

function handleLocalEntryClick(
  entry: BrowserEntry,
  event: MouseEvent
): void {
  const currentEntries = getVisibleLocalEntries();
  const currentSelection = new Set(
    state.get("selected_local_entries").map((item) => item.path)
  );

  if (event.shiftKey) {
    const anchorPath =
      localSelectionAnchorPath ?? state.get("selected_local_entry")?.path ?? entry.path;
    const anchorIndex = currentEntries.findIndex((item) => item.path === anchorPath);
    const targetIndex = currentEntries.findIndex((item) => item.path === entry.path);

    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] =
        anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
      const rangeEntries = currentEntries.slice(start, end + 1);

      if (event.ctrlKey || event.metaKey) {
        for (const rangeEntry of rangeEntries) {
          currentSelection.add(rangeEntry.path);
        }
        setLocalSelection(orderedLocalEntriesFromPaths(currentSelection), entry);
      } else {
        setLocalSelection(rangeEntries, entry);
      }
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    if (currentSelection.has(entry.path)) {
      currentSelection.delete(entry.path);
    } else {
      currentSelection.add(entry.path);
    }

    setLocalSelection(orderedLocalEntriesFromPaths(currentSelection), entry);
    return;
  }

  setLocalSelection([entry], entry);
}

function handleMachineEntryClick(
  entry: BrowserEntry,
  event: MouseEvent
): void {
  const currentEntries = getEntries("machine");
  const currentSelection = new Set(
    state.get("selected_machine_entries").map((item) => item.path)
  );

  if (event.shiftKey) {
    const anchorPath =
      machineSelectionAnchorPath ?? state.get("selected_machine_entry")?.path ?? entry.path;
    const anchorIndex = currentEntries.findIndex((item) => item.path === anchorPath);
    const targetIndex = currentEntries.findIndex((item) => item.path === entry.path);

    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] =
        anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
      const rangeEntries = currentEntries.slice(start, end + 1);

      if (event.ctrlKey || event.metaKey) {
        for (const rangeEntry of rangeEntries) {
          currentSelection.add(rangeEntry.path);
        }
        setMachineSelection(orderedMachineEntriesFromPaths(currentSelection), entry);
      } else {
        setMachineSelection(rangeEntries, entry);
      }
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    if (currentSelection.has(entry.path)) {
      currentSelection.delete(entry.path);
    } else {
      currentSelection.add(entry.path);
    }

    setMachineSelection(orderedMachineEntriesFromPaths(currentSelection), entry);
    return;
  }

  setMachineSelection([entry], entry);
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
    selected_machine_entries: [],
    ...(clearMachinePreview
      ? {
          active_selection: null,
          preview: null,
        }
      : {}),
  });
  machineSelectionAnchorPath = null;
  clearPaneSelectionVisual("machine");
}

function canDeleteViaContextMenu(
  pane: PaneKind,
  _entry: BrowserEntry
): boolean {
  if (pane !== "machine") {
    return false;
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
  if (pane !== "machine") {
    return;
  }

  await confirmAndDeleteMachineEntry(entry);
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

    if (pane === "local") {
      setLocalSelection([entry], entry);
    } else {
      selectMachineEntry(entry, row);
    }
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
  if (getSelectedLocalEntries().length !== 1) {
    return;
  }

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

  if (pane === "local") {
    setLocalSelection([match], match);
  } else {
    selectMachineEntry(match, row);
  }
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
  localSelectionAnchorPath = null;

  if (state.get("local_current_path") !== path) {
    resetLocalSearch();
  }

  state.patch({
    local_current_path: path,
    local_breadcrumb: breadcrumb,
    local_entries: [],
    local_search_results: null,
    selected_local_entry: null,
    selected_local_entries: [],
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
    if (isLocalSearchActive()) {
      scheduleLocalSearch(undefined, { immediate: true });
    } else {
      updateLocalPaneStatus();
      renderEntries("local", entries);
    }
    setStatus(t("status.localReady", { path }));
    return entries;
  } catch (error) {
    state.set("is_loading_local_directory", false);
    clearLocalSearchState();
    updateLocalPaneStatus();
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
    selected_local_entries: [],
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
  if (!root) {
    localStatusEl().textContent = t("pane.localChooseFolder");
    updateBreadcrumb("local");
    return;
  }

  const query = getNormalizedLocalSearchQuery();
  let status = root;

  if (state.get("is_loading_local_search") && shouldRunRecursiveLocalSearch(query)) {
    status = `${root} • 🔍 ${t("pane.localSearching")}`;
  } else if (isLocalSearchBelowThreshold(query)) {
    status = `${root} • ${t("pane.localSearchMinChars", {
      count: String(LOCAL_SEARCH_MIN_QUERY_LENGTH),
    })}`;
  }

  localStatusEl().textContent = status;
  updateBreadcrumb("local");
}

function updateTransferButtons(): void {
  const machine = state.get("selected_machine");
  const machineStatus = machine
    ? state.get("machine_statuses").get(machine.id) ?? "unknown"
    : "unknown";
  const selectedLocalEntries = getSelectedLocalEntries();
  const selectedMachineEntries = getSelectedMachineEntries();
  // Allow delete if we have a machine path and machine is not protected.
  // Do NOT require status === "online"—network paths may show timeout/offline
  // even when operations work. The actual delete will succeed or fail truthfully.
  const machineDeleteAllowed =
    !!machine &&
    !machine.protected &&
    !!state.get("machine_current_path");

  copyToMachineButton().disabled =
    !machine ||
    machineStatus !== "online" ||
    !state.get("machine_current_path") ||
    selectedLocalEntries.length === 0;

  copyToLocalButton().disabled =
    !machine ||
    machineStatus !== "online" ||
    !state.get("local_current_path") ||
    selectedMachineEntries.length === 0;

  openLocalEntryButton().disabled =
    selectedLocalEntries.length !== 1 ||
    !isLocalExternallyOpenable(state.get("selected_local_entry"));

  deleteMachineEntryButton().disabled =
    !machineDeleteAllowed || selectedMachineEntries.length === 0;
  deleteMachineFolderContentsButton().disabled =
    !machineDeleteAllowed || state.get("machine_entries").length === 0;
}

async function runTransfer(direction: TransferDirection): Promise<void> {
  const config = state.get("config");
  if (!config) return;

  const machine = state.get("selected_machine");
  const timeoutSecs = config.check_timeout_secs;
  const destinationDir =
    direction === "to_machine"
      ? state.get("machine_current_path")
      : state.get("local_current_path");

  const sourceEntries =
    direction === "to_machine"
      ? getSelectedLocalEntries()
      : getSelectedMachineEntries();

  if (sourceEntries.length === 0 || !destinationDir) {
    setStatus(t("transfer.chooseFileFirst"));
    return;
  }

  if (direction === "to_machine" && !machine) {
    setStatus(t("transfer.selectMachineFirst"));
    return;
  }

  if (sourceEntries.length > 1) {
    // Batch transfer for multiple items
    if (direction === "to_machine") {
      setStatus(
        t("transfer.copyingBatchToMachine", {
          count: String(sourceEntries.length),
        })
      );

      const summary = await transferEntriesToMachine(
        sourceEntries,
        destinationDir,
        timeoutSecs,
        machine
      );

      if (summary.copied > 0) {
        await refreshMachineDirectory(
          summary.copied === 1 ? summary.lastDestinationPath ?? undefined : undefined
        );
      }

      setStatus(
        t("transfer.batchToMachineSummary", {
          copied: String(summary.copied),
          skipped: String(summary.skipped),
          failed: String(summary.failed),
        }),
        6000
      );
    } else {
      // to_local batch transfer
      setStatus(
        t("transfer.copyingBatchToLocal", {
          count: String(sourceEntries.length),
        })
      );

      const summary = await transferEntriesToLocal(
        sourceEntries,
        destinationDir,
        timeoutSecs,
        machine
      );

      if (summary.copied > 0) {
        await refreshLocalDirectory(
          summary.copied === 1 ? summary.lastDestinationPath ?? undefined : undefined
        );
      }

      setStatus(
        t("transfer.batchToLocalSummary", {
          copied: String(summary.copied),
          skipped: String(summary.skipped),
          failed: String(summary.failed),
        }),
        6000
      );
    }
    return;
  }

  const sourceEntry = sourceEntries[0];
  const finalResult = await executeTransferEntry(
    direction,
    sourceEntry,
    destinationDir,
    timeoutSecs,
    machine
  );

  if (finalResult) {
    await applyTransferResult(direction, finalResult);
  }
}

async function transferEntriesToMachine(
  entries: BrowserEntry[],
  destinationDir: string,
  timeoutSecs: number,
  machine: MachineProfile | null
): Promise<BatchTransferSummary> {
  const summary: BatchTransferSummary = {
    copied: 0,
    skipped: 0,
    failed: 0,
    lastDestinationPath: null,
  };

  for (const entry of entries) {
    const result = await executeTransferEntry(
      "to_machine",
      entry,
      destinationDir,
      timeoutSecs,
      machine
    );

    if (!result) {
      summary.skipped += 1;
      continue;
    }

    if (result.status === "success") {
      summary.copied += 1;
      summary.lastDestinationPath = result.destination_path ?? summary.lastDestinationPath;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

async function transferEntriesToLocal(
  entries: BrowserEntry[],
  destinationDir: string,
  timeoutSecs: number,
  machine: MachineProfile | null
): Promise<BatchTransferSummary> {
  const summary: BatchTransferSummary = {
    copied: 0,
    skipped: 0,
    failed: 0,
    lastDestinationPath: null,
  };

  for (const entry of entries) {
    const result = await executeTransferEntry(
      "to_local",
      entry,
      destinationDir,
      timeoutSecs,
      machine
    );

    if (!result) {
      summary.skipped += 1;
      continue;
    }

    if (result.status === "success") {
      summary.copied += 1;
      summary.lastDestinationPath = result.destination_path ?? summary.lastDestinationPath;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

async function executeTransferEntry(
  direction: TransferDirection,
  sourceEntry: BrowserEntry,
  destinationDir: string,
  timeoutSecs: number,
  machine: MachineProfile | null
): Promise<TransferFileResult | null> {
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

  return firstAttempt.status === "overwrite_required"
    ? retryWithOverwrite(direction, firstAttempt, sourceEntry.name, machine?.name)
    : firstAttempt;
}

async function retryWithOverwrite(
  direction: TransferDirection,
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
  const confirmed = await tauriConfirm(
    t(promptKey, {
      message: result.message,
      name: fileName,
      dest,
    }),
    { title: "HAAS CNC Connect", kind: "warning" }
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
  direction: TransferDirection,
  result: TransferFileResult
): Promise<void> {
  if (result.status !== "success") {
    setStatus(result.message);
    return;
  }

  const copied = result.copied_count ?? 0;
  const skipped = result.skipped_count ?? 0;
  const isFolderWithStats = result.is_directory && (result.copied_count != null);

  let statusMessage: string;
  if (isFolderWithStats && copied === 0 && skipped > 0) {
    statusMessage = t("transfer.folderNoneEligible", {
      name: result.file_name,
      skipped: String(skipped),
    });
  } else if (isFolderWithStats && skipped > 0) {
    statusMessage = t("transfer.folderPartialSuccess", {
      name: result.file_name,
      copied: String(copied),
      skipped: String(skipped),
    });
  } else if (isFolderWithStats) {
    statusMessage = t("transfer.folderFullSuccess", {
      name: result.file_name,
      copied: String(copied),
    });
  } else if (direction === "to_machine") {
    statusMessage = t("transfer.copiedToMachine", { name: result.file_name });
  } else {
    statusMessage = t("transfer.copiedToLocal", { name: result.file_name });
  }

  setStatus(statusMessage, 6000);

  if (direction === "to_machine") {
    await refreshMachineDirectory(result.destination_path ?? undefined);
  } else {
    await refreshLocalDirectory(result.destination_path ?? undefined);
  }
}

export async function confirmAndDeleteMachineEntry(
  entryOverride?: BrowserEntry | null
): Promise<void> {
  const machine = state.get("selected_machine");

  if (!machine || machine.protected) {
    return;
  }

  // Determine target entries: explicit override, multi-selection, or single selection
  const selectedEntries = getSelectedMachineEntries();
  const entriesToDelete: BrowserEntry[] = entryOverride
    ? [entryOverride]
    : selectedEntries.length > 0
      ? selectedEntries
      : state.get("selected_machine_entry")
        ? [state.get("selected_machine_entry")!]
        : [];

  if (entriesToDelete.length === 0) {
    return;
  }

  // Build confirmation message based on count
  let confirmMessage: string;
  if (entriesToDelete.length === 1) {
    confirmMessage = t("preview.deleteConfirm", { name: entriesToDelete[0].name });
  } else {
    const maxNamesToShow = 5;
    const namesList = entriesToDelete.slice(0, maxNamesToShow).map((e) => `  - ${e.name}`).join("\n");
    const moreCount = entriesToDelete.length - maxNamesToShow;
    const moreText = moreCount > 0 ? `\n  ... i još ${moreCount} stavki` : "";
    confirmMessage = t("machine.deleteSelectedConfirm", {
      count: String(entriesToDelete.length),
      names: namesList + moreText,
    });
  }

  const confirmed = await tauriConfirm(confirmMessage, { title: "HAAS CNC Connect", kind: "warning" });
  if (!confirmed) {
    return;
  }

  // Perform deletion
  try {
    if (entriesToDelete.length === 1) {
      await deleteEntry(entriesToDelete[0].path);
      setStatus(t("preview.deleted", { name: entriesToDelete[0].name }), 4000);
    } else {
      const paths = entriesToDelete.map((e) => e.path);
      const [deleted, skipped, failed] = await deleteEntries(paths);
      setStatus(
        t("machine.deleteSelectedDone", {
          deleted: String(deleted),
          skipped: String(skipped),
          failed: String(failed),
        }),
        5000
      );
    }
    clearMachineSelectionAfterDelete();
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

  const confirmed = await tauriConfirm(
    t("machine.deleteAllConfirm", {
      path: currentPath,
      count: String(entryCount),
    }),
    { title: "HAAS CNC Connect", kind: "warning" }
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

// Drag and drop state for machine pane
let isDragOverMachinePane = false;

/** Check if coordinates are within the machine pane bounds */
function isPointInMachinePane(x: number, y: number): boolean {
  const pane = machinePaneEl();
  if (!pane) return false;
  const rect = pane.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

let machinePaneOriginalPlaceholder: string | null = null;

/** Update visual drag-over state on machine pane */
function setMachinePaneDragOver(isOver: boolean): void {
  const pane = machinePaneEl();
  if (!pane) return;
  isDragOverMachinePane = isOver;
  pane.classList.toggle("drag-over", isOver);
  if (isOver) {
    pane.setAttribute("data-drag-message", t("pane.machineDragOver"));
  } else {
    pane.removeAttribute("data-drag-message");
  }
  const placeholder = pane.querySelector(".placeholder-text") as HTMLElement | null;
  if (placeholder) {
    if (isOver) {
      // Save original text before changing
      if (machinePaneOriginalPlaceholder === null) {
        machinePaneOriginalPlaceholder = placeholder.textContent || "";
      }
      placeholder.textContent = t("pane.machineDragOver");
    } else if (machinePaneOriginalPlaceholder !== null) {
      // Restore original text
      placeholder.textContent = machinePaneOriginalPlaceholder;
      machinePaneOriginalPlaceholder = null;
    }
  }
}

/** Process dropped files/folders onto machine pane */
async function handleDroppedFilesToMachine(paths: string[]): Promise<void> {
  const machine = state.get("selected_machine");
  const destinationDir = state.get("machine_current_path");
  const config = state.get("config");

  if (!machine || !destinationDir || !config) {
    setStatus(t("transfer.selectMachineFirst"));
    return;
  }

  const machineStatus = state.get("machine_statuses").get(machine.id);
  if (machineStatus !== "online") {
    setStatus(t("pane.machineUnavailable"));
    return;
  }

  const timeoutSecs = config.check_timeout_secs;
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let lastDestinationPath: string | null = null;

  setStatus(
    t("transfer.copyingBatchToMachine", { count: String(paths.length) })
  );

  for (const sourcePath of paths) {
    // Check if path is a directory
    const pathIsDir = await isDirectory(sourcePath);

    // Create a minimal BrowserEntry-like object for the transfer
    const sourceEntry: BrowserEntry = {
      name: sourcePath.split(/[/\\]/).pop() || "",
      path: sourcePath,
      relative_path: null,
      is_dir: pathIsDir,
      size: null,
      modified: null,
      extension: pathIsDir ? "" : (sourcePath.split(".").pop() || ""),
      previewable: false,
    };

    const result = await executeTransferEntry(
      "to_machine",
      sourceEntry,
      destinationDir,
      timeoutSecs,
      machine
    );

    if (!result) {
      skipped += 1;
      continue;
    }

    if (result.status === "success") {
      copied += 1;
      lastDestinationPath = result.destination_path ?? lastDestinationPath;
    } else {
      failed += 1;
    }
  }

  if (copied > 0) {
    await refreshMachineDirectory(
      copied === 1 ? lastDestinationPath ?? undefined : undefined
    );
  }

  setStatus(
    t("transfer.batchToMachineSummary", {
      copied: String(copied),
      skipped: String(skipped),
      failed: String(failed),
    }),
    6000
  );
}

/** Initialize drag and drop for machine pane using Tauri native events */
function initMachinePaneDragDrop(): void {
  const pane = machinePaneEl();
  if (!pane) return;

  // Tauri's onDragDropEvent is the ONLY reliable source of drag lifecycle
  // events for external file drags (Explorer → WebView) on Windows/WebView2.
  // HTML5 document drag events do NOT fire reliably for external drags.
  const appWindow = getCurrentWindow();
  appWindow.onDragDropEvent((event) => {
    const type = event.payload.type;

    if (type === "enter" || type === "over") {
      const { position } = event.payload;
      const overMachine = isPointInMachinePane(position.x, position.y);
      if (overMachine !== isDragOverMachinePane) {
        setMachinePaneDragOver(overMachine);
      }
      return;
    }

    if (type === "leave") {
      setMachinePaneDragOver(false);
      return;
    }

    if (type === "drop") {
      const { paths, position } = event.payload;
      setMachinePaneDragOver(false);
      if (isPointInMachinePane(position.x, position.y)) {
        void handleDroppedFilesToMachine(paths);
      }
    }
  });
}

export function initFileBrowser(): void {
  bindAppContextMenu();
  initPaneSplitters();
  initMachinePaneDragDrop();
  updateLocalSearchInput();

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
  localSearchInput().addEventListener("input", () => {
    handleLocalSearchInput();
  });
  copyToMachineButton().addEventListener("click", () => {
    void runTransfer("to_machine");
  });
  copyToLocalButton().addEventListener("click", () => {
    void runTransfer("to_local");
  });
  deleteMachineEntryButton().addEventListener("click", () => {
    void confirmAndDeleteMachineEntry();
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
      // Show warning but DO NOT clear machine state—user may still want to
      // perform operations like delete even if availability check failed.
      // The actual operation will succeed or fail with a truthful error.
      const message =
        status === "offline"
          ? t("pane.machineUnavailable")
          : status === "timeout"
            ? t("pane.machineNoResponse")
            : t("pane.machineCheckFailed");
      // Only show placeholder if we have no entries loaded yet.
      if (state.get("machine_entries").length === 0) {
        showPlaceholder("machine", message);
      } else {
        // Show status but keep current entries visible.
        const statusLabel: Record<AvailabilityStatus, string> = {
          unknown: t("machine.unknown"),
          checking: t("machine.checking"),
          online: t("machine.online"),
          offline: t("machine.offline"),
          timeout: t("machine.timeout"),
          error: t("machine.error"),
        };
        setStatus(
          t("status.machineStatus", {
            name: machine.name,
            status: statusLabel[status],
            path: machine.path,
          })
        );
      }
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
    updateLocalPaneStatus();
    updateTransferButtons();
    updateLocalNavigationButtons();
  });
  state.subscribe("is_loading_local_search", () => updateLocalPaneStatus());
  state.subscribe("selected_machine_entry", () => updateTransferButtons());
  state.subscribe("selected_local_entry", () => updateTransferButtons());
  state.subscribe("selected_local_entries", () => updateTransferButtons());

  // On language change: update all text in the pane that depends on state.
  state.subscribe("language", () => {
    applyStaticLabels();
    updateLocalSearchInput();
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

    if (!state.get("local_root")) {
      showPlaceholder("local", t("pane.localEmpty"));
    } else if (state.get("is_loading_local_directory")) {
      showPlaceholder("local", t("pane.localLoading"));
    } else {
      renderEntries("local", state.get("local_entries"));
    }
  });

  updateMachinePaneStatus();
  updateLocalPaneStatus();
  updateLocalNavigationButtons();
  updateTransferButtons();
}
