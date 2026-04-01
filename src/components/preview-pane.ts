// Right panel: on-demand file preview.
// Triggered only when the user selects a file — never automatically.

import type { ActivePaneSelection, BrowserEntry, PreviewData } from "../types/index";
import { state } from "../state";
import { getPreview, openExternal } from "../api";
import { t } from "../translations";
import { confirmAndDeleteMachineEntry } from "./file-browser";
import { setStatus } from "./status-bar";

const pholderEl = () => document.getElementById("preview-placeholder")!;
const dataEl = () => document.getElementById("preview-data")!;
const titleEl = () => document.getElementById("preview-title")!;
const metaEl = () => document.getElementById("preview-metadata")!;
const selectionListEl = () =>
  document.getElementById("preview-selection-list") as HTMLUListElement;
const paneStatusEl = () =>
  document.getElementById("preview-pane-status") as HTMLSpanElement;
const breadcrumbEl = () =>
  document.getElementById("preview-breadcrumb") as HTMLDivElement;
const textEl = () =>
  document.getElementById("preview-text-content") as HTMLPreElement;
const topActionEl = () => document.getElementById("preview-primary-action")!;
const actionsEl = () => document.getElementById("preview-actions")!;
const LOCAL_GCODE_EXTENSIONS = new Set([".nc", ".tap", ".cnc"]);
const LOCAL_EDITABLE_EXTENSIONS = new Set([
  ...LOCAL_GCODE_EXTENSIONS,
  ".txt",
]);
let previewLoadToken = 0;
let previewRenderScheduled = false;

function showPlaceholder(msg: string): void {
  pholderEl().textContent = msg;
  pholderEl().hidden = false;
  dataEl().hidden = true;
}

function showData(): void {
  pholderEl().hidden = true;
  dataEl().hidden = false;
}

function resetPreviewBody(): void {
  titleEl().textContent = "";
  metaEl().textContent = "";
  selectionListEl().hidden = true;
  selectionListEl().innerHTML = "";
  textEl().textContent = "";
  textEl().hidden = true;
  topActionEl().innerHTML = "";
  actionsEl().innerHTML = "";
}

function scheduleRenderFromState(): void {
  if (previewRenderScheduled) {
    return;
  }

  previewRenderScheduled = true;
  queueMicrotask(() => {
    previewRenderScheduled = false;
    renderFromState();
  });
}

function updatePreviewHeader(selection: ActivePaneSelection | null): void {
  if (!selection) {
    const idleText = t("preview.selectFile");
    paneStatusEl().textContent = idleText;
    breadcrumbEl().textContent = idleText;
    return;
  }

  paneStatusEl().textContent = selection.entry.name;
  breadcrumbEl().textContent = selection.entry.path;
}

/** Load and render preview for the selected entry. */
async function loadPreview(selection: ActivePaneSelection): Promise<void> {
  const { entry } = selection;
  const config = state.get("config");
  if (!config) return;
  const requestToken = ++previewLoadToken;
  updatePreviewHeader(selection);
  resetPreviewBody();
  state.set("is_loading_preview", false);

  if (entry.is_dir) {
    state.set("preview", null);
    titleEl().textContent = entry.name;
    metaEl().textContent = t("preview.folderSelected");
    textEl().textContent = "";
    textEl().hidden = true;
    renderActions(selection, null);
    showData();
    return;
  }

  if (!entry.previewable && !entry.is_dir) {
    showPlaceholder(
      t("preview.noPreview", { ext: entry.extension || "this file type" })
    );
    renderActions(selection, null);
    showData();
    titleEl().textContent = entry.name;
    metaEl().textContent = entry.size !== null ? formatSize(entry.size) : "";
    textEl().textContent = "";
    textEl().hidden = true;
    return;
  }

  showPlaceholder(t("preview.loading"));
  state.set("is_loading_preview", true);

  try {
    const preview = await getPreview(entry.path, config.preview_max_bytes);
    const current = state.get("active_selection");
    if (
      requestToken !== previewLoadToken ||
      !current ||
      current.pane !== selection.pane ||
      current.entry.path !== selection.entry.path
    ) {
      return;
    }
    state.set("preview", preview);
    renderPreview(selection, preview);
  } catch (err) {
    if (requestToken !== previewLoadToken) {
      return;
    }
    showPlaceholder(`Preview error: ${err}`);
    state.set("preview", null);
  } finally {
    if (requestToken === previewLoadToken) {
      state.set("is_loading_preview", false);
    }
  }
}

function renderPreview(
  selection: ActivePaneSelection,
  preview: PreviewData
): void {
  selectionListEl().hidden = true;
  selectionListEl().innerHTML = "";
  titleEl().textContent = preview.title;

  // Metadata section.
  if (preview.metadata) {
    metaEl().textContent = preview.metadata;
  } else {
    metaEl().textContent = "";
  }

  // Text content (gcode / plain text).
  if (
    preview.content &&
    (preview.kind === "gcode_text" || preview.kind === "plain_text")
  ) {
    textEl().textContent = preview.content;
    textEl().hidden = false;
  } else {
    textEl().textContent = "";
    textEl().hidden = true;
  }

  // PDF note.
  if (preview.kind === "pdf") {
    const note = document.createElement("p");
    note.className = "pdf-note";
    note.textContent = t("preview.pdfNote");
    metaEl().appendChild(note);
  }

  // Non-fatal read error.
  if (preview.error) {
    const errEl = document.createElement("p");
    errEl.className = "preview-error";
    errEl.textContent = `⚠ ${preview.error}`;
    metaEl().appendChild(errEl);
  }

  renderActions(selection, preview);
  showData();
}

/** Build the action buttons for the selected file. */
function renderActions(
  selection: ActivePaneSelection,
  _preview: PreviewData | null
): void {
  const { entry, pane } = selection;
  const topEl = topActionEl();
  const bottomEl = actionsEl();
  topEl.innerHTML = "";
  bottomEl.innerHTML = "";

  if (shouldShowPreviewOpenAction(selection)) {
    const openBtn = document.createElement("button");
    openBtn.className = "btn-action btn-action-primary";
    openBtn.textContent = getOpenActionLabel(selection);
    openBtn.addEventListener("click", async () => {
      try {
        await openExternal(entry.path);
      } catch (err) {
        setStatus(t("preview.openError", { error: String(err) }));
      }
    });
    topEl.appendChild(openBtn);
  }

  // Delete (only if machine is not protected).
  const machine = state.get("selected_machine");
  if (pane === "machine" && machine && !machine.protected) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-action btn-danger";
    delBtn.textContent = t("btn.delete");
    delBtn.addEventListener("click", () => promptDelete(entry));
    bottomEl.appendChild(delBtn);
  }
}

async function promptDelete(entry: BrowserEntry): Promise<void> {
  await confirmAndDeleteMachineEntry(entry);
}

function renderMultiSelectionSummary(entries: BrowserEntry[]): void {
  previewLoadToken += 1;
  state.set("preview", null);
  state.set("is_loading_preview", false);
  resetPreviewBody();

  const totalKnownBytes = entries.reduce(
    (sum, entry) => sum + (entry.size ?? 0),
    0
  );
  const hasKnownSizes = entries.some((entry) => entry.size !== null);

  titleEl().textContent = t("preview.multiSelectedTitle");
  metaEl().textContent = hasKnownSizes
    ? t("preview.multiSelectedMetaWithSize", {
        count: String(entries.length),
        size: formatSize(totalKnownBytes),
      })
    : t("preview.multiSelectedMeta", {
        count: String(entries.length),
      });

  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = entry.name;
    selectionListEl().appendChild(item);
  }

  selectionListEl().hidden = false;
  paneStatusEl().textContent = t("preview.multiSelectedStatus", {
    count: String(entries.length),
  });
  breadcrumbEl().textContent = t("preview.multiSelectedStatus", {
    count: String(entries.length),
  });
  showData();
}

function renderFromState(): void {
  const localSelections = state.get("selected_local_entries");
  if (localSelections.length > 1) {
    renderMultiSelectionSummary(localSelections);
    return;
  }

  const selection = state.get("active_selection");
  if (!selection) {
    previewLoadToken += 1;
    updatePreviewHeader(null);
    resetPreviewBody();
    state.set("is_loading_preview", false);
    showPlaceholder(t("preview.selectFile"));
    state.set("preview", null);
    return;
  }

  void loadPreview(selection);
}

function shouldShowPreviewOpenAction(selection: ActivePaneSelection): boolean {
  const { pane, entry } = selection;

  if (entry.is_dir) {
    return false;
  }

  if (entry.extension === ".pdf") {
    return true;
  }

  return pane === "local" && LOCAL_EDITABLE_EXTENSIONS.has(entry.extension);
}

function getOpenActionLabel(selection: ActivePaneSelection): string {
  const { pane, entry } = selection;

  if (entry.extension === ".pdf") {
    return t("btn.openPdfViewer");
  }

  if (pane === "local" && LOCAL_GCODE_EXTENSIONS.has(entry.extension)) {
    return t("btn.openInGcodeViewer");
  }

  if (pane === "local" && LOCAL_EDITABLE_EXTENSIONS.has(entry.extension)) {
    return t("btn.openExternal");
  }

  return t("btn.openExternal");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Wire up state subscriptions. */
export function initPreviewPane(): void {
  state.subscribe("active_selection", () => {
    scheduleRenderFromState();
  });
  state.subscribe("selected_local_entries", () => {
    scheduleRenderFromState();
  });

  // Update placeholder text on language change if nothing is selected.
  state.subscribe("language", () => {
    scheduleRenderFromState();
  });
}
