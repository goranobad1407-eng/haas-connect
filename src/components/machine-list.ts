// Left panel: renders the machine/location list with availability status.

import type { AvailabilityStatus, MachineProfile } from "../types/index";
import { state } from "../state";
import { checkAvailability } from "../api";
import { t } from "../translations";
import { setStatus } from "./status-bar";

const container = () => document.getElementById("machine-list")!;

/** Render or re-render the entire machine list. */
export function renderMachineList(): void {
  const machines = state.get("config")?.machines ?? [];
  const el = container();
  el.innerHTML = "";

  if (machines.length === 0) {
    el.innerHTML = `<div class="empty-list">${t("machine.noMachines").replace("\n", "<br>")}</div>`;
    return;
  }

  for (const machine of machines) {
    el.appendChild(buildMachineItem(machine));
  }
}

function buildMachineItem(machine: MachineProfile): HTMLElement {
  const item = document.createElement("div");
  item.className = "machine-item";
  item.dataset.id = machine.id;

  const status = state.get("machine_statuses").get(machine.id) ?? "unknown";
  item.classList.add(`status-${status}`);

  const info = document.createElement("div");
  info.className = "machine-info";

  const headerRow = document.createElement("div");
  headerRow.className = "machine-header-row";

  const dot = document.createElement("span");
  dot.className = `status-dot dot-${status}`;
  dot.title = machineStatusLabel(status);

  const nameEl = document.createElement("span");
  nameEl.className = "machine-name";
  nameEl.textContent = machine.name;

  const badgeEl = document.createElement("span");
  badgeEl.className = `machine-status-badge badge-${status}`;
  badgeEl.textContent = machineStatusBadge(status);

  const statusTextEl = document.createElement("span");
  statusTextEl.className = `machine-status-text status-text-${status}`;
  statusTextEl.textContent = machineStatusLabel(status);

  const pathEl = document.createElement("span");
  pathEl.className = "machine-path";
  pathEl.textContent = machine.path;

  const statusRow = document.createElement("div");
  statusRow.className = "machine-status-row";
  statusRow.append(dot, statusTextEl);

  headerRow.append(nameEl, badgeEl);
  info.append(headerRow, statusRow, pathEl);
  item.appendChild(info);

  // Click: select this machine.
  item.addEventListener("click", () => selectMachine(machine));

  return item;
}

/** Highlight the selected machine item. */
function setSelectedItem(id: string): void {
  for (const el of container().querySelectorAll(".machine-item")) {
    el.classList.toggle("selected", (el as HTMLElement).dataset.id === id);
  }
}

/** Update the status dot and inline status text for one machine without rebuilding everything. */
function updateMachineStatus(id: string, status: AvailabilityStatus): void {
  const item = container().querySelector(
    `[data-id="${id}"]`
  ) as HTMLElement | null;
  if (!item) return;

  const dot = item.querySelector(".status-dot") as HTMLElement;
  dot.className = `status-dot dot-${status}`;
  dot.title = machineStatusLabel(status);

  const badge = item.querySelector(".machine-status-badge") as HTMLElement | null;
  if (badge) {
    badge.className = `machine-status-badge badge-${status}`;
    badge.textContent = machineStatusBadge(status);
  }

  const statusText = item.querySelector(".machine-status-text") as HTMLElement | null;
  if (statusText) {
    statusText.className = `machine-status-text status-text-${status}`;
    statusText.textContent = machineStatusLabel(status);
  }

  item.className = `machine-item status-${status}`;
  if (id === state.get("selected_machine")?.id) {
    item.classList.add("selected");
  }
}

/** Called when the user clicks a machine. */
async function selectMachine(machine: MachineProfile): Promise<void> {
  const config = state.get("config")!;
  const alreadySelected = state.get("selected_machine")?.id === machine.id;
  if (alreadySelected) return;

  state.patch({
    selected_machine: machine,
    machine_current_path: null,
    machine_breadcrumb: [],
    machine_entries: [],
    selected_machine_entry: null,
    is_checking: true,
  });

  const active = state.get("active_selection");
  if (active?.pane === "machine") {
    state.patch({ active_selection: null, preview: null });
  }

  setSelectedItem(machine.id);
  setStatus(t("status.checking", { name: machine.name }));
  state.setMachineStatus(machine.id, "checking");
  updateMachineStatus(machine.id, "checking");

  try {
    const status = await checkAvailability(
      machine.path,
      config.check_timeout_secs
    );

    state.setMachineStatus(machine.id, status);
    updateMachineStatus(machine.id, status);

    if (status === "online") {
      setStatus(t("status.machineOnline", { name: machine.name }));
    } else {
      setStatus(
        t("status.machineStatus", {
          name: machine.name,
          status: machineStatusLabel(status),
          path: machine.path,
        })
      );
    }
  } catch (err) {
    state.setMachineStatus(machine.id, "error");
    updateMachineStatus(machine.id, "error");
    setStatus(t("status.machineError", { name: machine.name, error: String(err) }));
  } finally {
    state.set("is_checking", false);
  }
}

/** Short, operator-friendly status label used both in the list badge and dot tooltip. */
function machineStatusLabel(s: AvailabilityStatus): string {
  switch (s) {
    case "unknown":  return t("machine.unknown");
    case "checking": return t("machine.checking");
    case "online":   return t("machine.online");
    case "offline":  return t("machine.offline");
    case "timeout":  return t("machine.timeout");
    case "error":    return t("machine.error");
  }
}

function machineStatusBadge(s: AvailabilityStatus): string {
  switch (s) {
    case "unknown":  return t("machine.badgeUnknown");
    case "checking": return t("machine.badgeChecking");
    case "online":   return t("machine.badgeOnline");
    case "offline":  return t("machine.badgeOffline");
    case "timeout":  return t("machine.badgeTimeout");
    case "error":    return t("machine.badgeError");
  }
}

/** Wire up state subscriptions for this component. */
export function initMachineList(): void {
  // Re-render when config loads.
  state.subscribe("config", () => renderMachineList());

  // Update status badges when statuses change.
  state.subscribe("machine_statuses", (statuses) => {
    for (const [id, status] of statuses) {
      updateMachineStatus(id, status);
    }
  });

  // Re-render on language change so all status labels update.
  state.subscribe("language", () => renderMachineList());
}
