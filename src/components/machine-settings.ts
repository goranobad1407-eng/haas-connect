import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import {
  checkAvailability,
  loadMachineProfiles,
  saveMachineProfiles,
  validateMachineProfiles,
} from "../api";
import { applyConfigState } from "../config-state";
import { state } from "../state";
import { t, applyStaticLabels } from "../translations";
import type { LocationType, MachineProfile } from "../types/index";
import { setStatus } from "./status-bar";

const DEFAULT_EXTENSIONS = [".nc", ".tap", ".txt", ".pdf"];

type DraftProfile = MachineProfile;

type LocalValidation = {
  errors: string[];
  warnings: string[];
  selectedFieldErrors: {
    id: boolean;
    name: boolean;
    path: boolean;
    extensions: boolean;
  };
};

const modal = () => document.getElementById("settings-modal") as HTMLDivElement;
const openButton = () => document.getElementById("btn-settings") as HTMLButtonElement;
const closeButton = () =>
  document.getElementById("btn-settings-close") as HTMLButtonElement;
const cancelButton = () =>
  document.getElementById("btn-settings-cancel") as HTMLButtonElement;
const saveButton = () =>
  document.getElementById("btn-settings-save") as HTMLButtonElement;
const addButton = () =>
  document.getElementById("btn-machine-add") as HTMLButtonElement;
const duplicateButton = () =>
  document.getElementById("btn-machine-duplicate") as HTMLButtonElement;
const removeButton = () =>
  document.getElementById("btn-machine-remove") as HTMLButtonElement;
const testButton = () =>
  document.getElementById("btn-machine-test") as HTMLButtonElement;
const presetButton = () =>
  document.getElementById("btn-extension-presets") as HTMLButtonElement;
const listEl = () =>
  document.getElementById("settings-machine-list") as HTMLDivElement;
const formEl = () =>
  document.getElementById("settings-form") as HTMLFormElement;
const emptyEl = () =>
  document.getElementById("settings-empty") as HTMLDivElement;
const messageEl = () =>
  document.getElementById("settings-message") as HTMLDivElement;
const validationEl = () =>
  document.getElementById("settings-validation-list") as HTMLUListElement;
const configPathEl = () =>
  document.getElementById("settings-config-path") as HTMLSpanElement;
const inputId = () => document.getElementById("machine-id") as HTMLInputElement;
const inputName = () =>
  document.getElementById("machine-name") as HTMLInputElement;
const inputType = () =>
  document.getElementById("machine-location-type") as HTMLSelectElement;
const inputPath = () =>
  document.getElementById("machine-path") as HTMLInputElement;
const inputExtensions = () =>
  document.getElementById("machine-extensions") as HTMLInputElement;
const inputProtected = () =>
  document.getElementById("machine-protected") as HTMLInputElement;
const inputNotes = () =>
  document.getElementById("machine-notes") as HTMLTextAreaElement;

let drafts: DraftProfile[] = [];
let selectedIndex = -1;
let isOpen = false;
let dirty = false;
let confirmedProtectedRemovals = new Set<string>();
let backendValidationErrors: string[] = [];
let backendValidationWarnings: string[] = [];
let currentValidation: LocalValidation = {
  errors: [],
  warnings: [],
  selectedFieldErrors: { id: false, name: false, path: false, extensions: false },
};

function setModalOpen(open: boolean): void {
  isOpen = open;
  modal().hidden = !open;
}

export function initMachineSettings(): void {
  openButton().addEventListener("click", () => {
    void openSettings();
  });
  closeButton().addEventListener("click", () => { void closeSettings(); });
  cancelButton().addEventListener("click", () => { void closeSettings(); });
  saveButton().addEventListener("click", () => {
    void saveSettings();
  });
  addButton().addEventListener("click", () => addMachine());
  duplicateButton().addEventListener("click", () => duplicateMachine());
  removeButton().addEventListener("click", () => removeMachine());
  testButton().addEventListener("click", () => {
    void testSelectedMachine();
  });
  presetButton().addEventListener("click", () => applyDefaultExtensions());
  modal().addEventListener("click", (event) => {
    if (event.target === modal()) {
      void closeSettings();
    }
  });

  inputId().addEventListener("input", () =>
    updateSelectedDraft("id", inputId().value)
  );
  inputName().addEventListener("input", () =>
    updateSelectedDraft("name", inputName().value)
  );
  inputType().addEventListener("change", () =>
    updateSelectedDraft("location_type", inputType().value as LocationType)
  );
  inputPath().addEventListener("input", () =>
    updateSelectedDraft("path", inputPath().value)
  );
  inputExtensions().addEventListener("input", () =>
    updateSelectedDraft(
      "allowed_extensions",
      normalizeExtensionsInput(inputExtensions().value)
    )
  );
  inputExtensions().addEventListener("blur", () => {
    renderForm();
  });
  inputProtected().addEventListener("change", () =>
    updateSelectedDraft("protected", inputProtected().checked)
  );
  inputNotes().addEventListener("input", () =>
    updateSelectedDraft("notes", inputNotes().value)
  );

  // Re-render form labels and list if modal is open when language changes.
  state.subscribe("language", () => {
    applyStaticLabels();
    if (isOpen) {
      render();
    }
  });
}

async function openSettings(): Promise<void> {
  try {
    const profiles = await loadMachineProfiles();
    drafts = profiles.map(cloneProfile);
    selectedIndex = drafts.length > 0 ? 0 : -1;
    dirty = false;
    confirmedProtectedRemovals = new Set<string>();
    backendValidationErrors = [];
    backendValidationWarnings = [];
    currentValidation = computeLocalValidation(
      backendValidationErrors,
      backendValidationWarnings
    );
    configPathEl().textContent = "machines.json";
    setMessage(t("settings.machine.editMessage"));
    setModalOpen(true);
    render();
  } catch (error) {
    setStatus(t("settings.machine.openError", { error: String(error) }));
  }
}

async function closeSettings(): Promise<void> {
  if (!isOpen) return;
  if (dirty) {
    const discard = await tauriConfirm(t("settings.machine.discardConfirm"), { title: "HAAS CNC Connect", kind: "warning" });
    if (!discard) return;
  }

  setModalOpen(false);
}

function addMachine(): void {
  const existingIds = drafts.map((draft) => draft.id);
  const name = nextMachineName();
  drafts.push({
    id: uniqueId(slugify(name) || "machine", existingIds),
    name,
    path: "",
    location_type: "network_share",
    allowed_extensions: [...DEFAULT_EXTENSIONS],
    protected: false,
    notes: "",
  });
  selectedIndex = drafts.length - 1;
  dirty = true;
  render();
}

function duplicateMachine(): void {
  const draft = drafts[selectedIndex];
  if (!draft) return;

  const existingIds = drafts.map((entry) => entry.id);
  const duplicateName = uniqueName(`${draft.name} Copy`);
  drafts.push({
    ...cloneProfile(draft),
    id: uniqueId(slugify(duplicateName) || `${draft.id}-copy`, existingIds),
    name: duplicateName,
    protected: false,
  });
  selectedIndex = drafts.length - 1;
  dirty = true;
  render();
}

function removeMachine(): void {
  const draft = drafts[selectedIndex];
  if (!draft) return;

  if (draft.protected) {
    const confirmation = window.prompt(
      t("settings.machine.removeProtectedPrompt", {
        name: draft.name,
        id: draft.id,
      })
    );
    if (confirmation?.trim() !== draft.id) {
      setMessage(t("settings.machine.protectedNotRemoved"));
      return;
    }
    confirmedProtectedRemovals.add(draft.id);
  }

  drafts.splice(selectedIndex, 1);
  selectedIndex =
    drafts.length === 0 ? -1 : Math.min(selectedIndex, drafts.length - 1);
  dirty = true;
  render();
}

function render(): void {
  currentValidation = computeLocalValidation(
    backendValidationErrors,
    backendValidationWarnings
  );
  renderList();
  renderForm();
  renderValidation();
}

function renderList(): void {
  listEl().innerHTML = "";

  if (drafts.length === 0) {
    listEl().innerHTML = `<div class="settings-list-empty">${t("settings.machine.noMachinesInList")}</div>`;
    duplicateButton().disabled = true;
    removeButton().disabled = true;
    return;
  }

  duplicateButton().disabled = !drafts[selectedIndex];
  removeButton().disabled = !drafts[selectedIndex];

  drafts.forEach((draft, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "settings-machine-item";
    if (index === selectedIndex) {
      item.classList.add("selected");
    }

    const title = document.createElement("span");
    title.className = "settings-machine-title";
    title.textContent =
      draft.name || t("settings.machine.unnamed");

    const meta = document.createElement("span");
    meta.className = "settings-machine-meta";
    meta.textContent = draft.path || t("settings.machine.pathNotSet");

    item.appendChild(title);
    item.appendChild(meta);

    if (draft.protected) {
      const badge = document.createElement("span");
      badge.className = "settings-machine-badge";
      badge.textContent = t("settings.machine.protectedBadge");
      item.appendChild(badge);
    }

    item.addEventListener("click", () => {
      selectedIndex = index;
      render();
    });
    listEl().appendChild(item);
  });
}

function renderForm(): void {
  const draft = drafts[selectedIndex];
  const hasSelection = Boolean(draft);

  formEl().hidden = !hasSelection;
  emptyEl().hidden = hasSelection;

  if (!draft) {
    return;
  }

  inputId().value = draft.id;
  inputName().value = draft.name;
  inputType().value = draft.location_type;
  inputPath().value = draft.path;
  if (document.activeElement !== inputExtensions()) {
    inputExtensions().value = draft.allowed_extensions.join(", ");
  }
  inputProtected().checked = draft.protected;
  inputNotes().value = draft.notes;

  inputId().classList.toggle("input-error", currentValidation.selectedFieldErrors.id);
  inputName().classList.toggle(
    "input-error",
    currentValidation.selectedFieldErrors.name
  );
  inputPath().classList.toggle(
    "input-error",
    currentValidation.selectedFieldErrors.path
  );
  inputExtensions().classList.toggle(
    "input-error",
    currentValidation.selectedFieldErrors.extensions
  );
}

function renderValidation(): void {
  validationEl().innerHTML = "";

  for (const error of currentValidation.errors) {
    const item = document.createElement("li");
    item.className = "validation-error";
    item.textContent = error;
    validationEl().appendChild(item);
  }

  for (const warning of currentValidation.warnings) {
    const item = document.createElement("li");
    item.className = "validation-warning";
    item.textContent = warning;
    validationEl().appendChild(item);
  }
}

function updateSelectedDraft<K extends keyof DraftProfile>(
  key: K,
  value: DraftProfile[K]
): void {
  const draft = drafts[selectedIndex];
  if (!draft) return;

  draft[key] = value;
  dirty = true;
  backendValidationErrors = [];
  backendValidationWarnings = [];
  currentValidation = computeLocalValidation(
    backendValidationErrors,
    backendValidationWarnings
  );
  renderForm();
  renderList();
  renderValidation();
}

async function saveSettings(): Promise<void> {
  backendValidationErrors = [];
  backendValidationWarnings = [];
  currentValidation = computeLocalValidation(
    backendValidationErrors,
    backendValidationWarnings
  );
  renderValidation();
  renderForm();

  if (currentValidation.errors.length > 0) {
    setMessage(t("settings.machine.fixErrors"));
    return;
  }

  try {
    const validation = await validateMachineProfiles(drafts.map(cloneProfile));
    drafts = validation.profiles.map(cloneProfile);

    if (validation.errors.length > 0) {
      backendValidationErrors = validation.errors;
      backendValidationWarnings = validation.warnings;
      render();
      setMessage(t("settings.machine.backendErrors"));
      return;
    }

    const [config, warnings] = await saveMachineProfiles(
      validation.profiles,
      Array.from(confirmedProtectedRemovals)
    );

    applyConfigState(config, warnings);
    dirty = false;
    backendValidationErrors = [];
    backendValidationWarnings = warnings;

    if (config.machines.length === 0) {
      render();
      setMessage(t("settings.machine.noProfilesSaved"));
      setStatus(t("status.noProfilesSaved"));
      return;
    }

    if (warnings.length > 0) {
      render();
      setMessage(t("settings.machine.savedWithWarnings"));
      setStatus(
        t("status.savedMachinesWithWarnings", {
          count: String(config.machines.length),
        })
      );
      return;
    }

    await closeSettings();
    setStatus(
      t("status.savedMachines", { count: String(config.machines.length) }),
      4000
    );
  } catch (error) {
    setMessage(String(error));
    setStatus(t("settings.machine.saveError", { error: String(error) }));
  }
}

async function testSelectedMachine(): Promise<void> {
  const draft = drafts[selectedIndex];
  if (!draft) return;

  const path = draft.path.trim();
  if (path.length === 0) {
    setMessage(t("settings.machine.enterPath"));
    return;
  }

  const machineName = draft.name || draft.id || "machine";
  const timeout = state.get("config")?.check_timeout_secs ?? 3;
  setMessage(t("settings.machine.checking", { name: machineName }));

  try {
    const status = await checkAvailability(path, timeout);
    setMessage(t("settings.machine.checkResult", { status }));
  } catch (error) {
    setMessage(t("settings.machine.checkFailed", { error: String(error) }));
  }
}

function applyDefaultExtensions(): void {
  updateSelectedDraft("allowed_extensions", [...DEFAULT_EXTENSIONS]);
  renderForm();
}

function setMessage(message: string): void {
  messageEl().textContent = message;
}

function computeLocalValidation(
  backendErrors: string[] = [],
  backendWarnings: string[] = []
): LocalValidation {
  const errors = [...backendErrors];
  const warnings = [...backendWarnings];
  const selectedFieldErrors = {
    id: false,
    name: false,
    path: false,
    extensions: false,
  };
  const ids = new Map<string, number>();
  const names = new Map<string, number>();

  drafts.forEach((draft, index) => {
    const row = index + 1;
    const id = draft.id.trim();
    const name = draft.name.trim();
    const path = draft.path.trim();

    if (id.length === 0) {
      errors.push(t("validation.idRequired", { row: String(row) }));
      if (index === selectedIndex) selectedFieldErrors.id = true;
    } else {
      const key = id.toLowerCase();
      if (ids.has(key)) {
        errors.push(t("validation.dupId", { row: String(row), id }));
        if (index === selectedIndex || ids.get(key) === selectedIndex) {
          selectedFieldErrors.id = true;
        }
      } else {
        ids.set(key, index);
      }
    }

    if (name.length === 0) {
      errors.push(t("validation.nameRequired", { row: String(row) }));
      if (index === selectedIndex) selectedFieldErrors.name = true;
    } else {
      const key = name.toLowerCase();
      if (names.has(key)) {
        errors.push(t("validation.dupName", { row: String(row), name }));
        if (index === selectedIndex || names.get(key) === selectedIndex) {
          selectedFieldErrors.name = true;
        }
      } else {
        names.set(key, index);
      }
    }

    if (path.length === 0) {
      errors.push(t("validation.pathRequired", { row: String(row) }));
      if (index === selectedIndex) selectedFieldErrors.path = true;
    }
  });

  const selectedDraft = drafts[selectedIndex];
  if (selectedDraft) {
    const selectedLabel = selectedDraft.name.trim()
      ? `('${selectedDraft.name.trim()}')`
      : "";
    const matchesSelected = (message: string) =>
      message.includes(`Entry ${selectedIndex + 1}`) ||
      (selectedLabel.length > 0 && message.includes(selectedLabel));

    for (const message of [...errors, ...warnings]) {
      if (!matchesSelected(message)) continue;
      if (
        message.includes("machine path is required") ||
        message.includes("path cannot use a UNC") ||
        message.includes("path must use UNC")
      ) {
        selectedFieldErrors.path = true;
      }
      if (message.includes("invalid extension")) {
        selectedFieldErrors.extensions = true;
      }
    }
  }

  return { errors, warnings, selectedFieldErrors };
}

function cloneProfile(profile: MachineProfile): MachineProfile {
  return {
    ...profile,
    allowed_extensions: [...profile.allowed_extensions],
  };
}

function normalizeExtensionsInput(value: string): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const token of value.split(",")) {
    const trimmed = token.trim().replace(/^\./, "").toLowerCase();
    if (!trimmed) continue;

    const extension = `.${trimmed}`;
    if (!seen.has(extension)) {
      seen.add(extension);
      normalized.push(extension);
    }
  }

  return normalized;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(baseId: string, existingIds: string[]): string {
  const seen = new Set(existingIds.map((id) => id.toLowerCase()));
  let candidate = baseId;
  let suffix = 2;

  while (seen.has(candidate.toLowerCase())) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function uniqueName(baseName: string): string {
  const seen = new Set(
    drafts.map((draft) => draft.name.trim().toLowerCase())
  );
  let candidate = baseName;
  let suffix = 2;

  while (seen.has(candidate.trim().toLowerCase())) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function nextMachineName(): string {
  const base = "Machine";
  let index = drafts.length + 1;
  let candidate = `${base} ${index}`;

  while (
    drafts.some(
      (draft) => draft.name.trim().toLowerCase() === candidate.toLowerCase()
    )
  ) {
    index += 1;
    candidate = `${base} ${index}`;
  }

  return candidate;
}
