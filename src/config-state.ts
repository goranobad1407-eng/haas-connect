import type { AppConfig, AvailabilityStatus, Language } from "./types/index";
import { state } from "./state";

export function applyConfigState(config: AppConfig, warnings: string[]): void {
  const previousConfig = state.get("config");
  const previousSelected = state.get("selected_machine");
  const previousStatuses = state.get("machine_statuses");
  const previousMachines = new Map(
    (previousConfig?.machines ?? []).map((machine) => [machine.id, machine])
  );

  const nextStatuses = new Map<string, AvailabilityStatus>();
  for (const machine of config.machines) {
    const previousMachine = previousMachines.get(machine.id);
    const previousStatus = previousStatuses.get(machine.id);
    if (
      previousMachine &&
      previousStatus !== undefined &&
      previousMachine.path === machine.path
    ) {
      nextStatuses.set(machine.id, previousStatus);
    } else {
      nextStatuses.set(machine.id, "unknown");
    }
  }

  const nextSelected = previousSelected
    ? config.machines.find((machine) => machine.id === previousSelected.id) ?? null
    : null;
  const keepSelection =
    nextSelected !== null &&
    previousSelected !== null &&
    nextSelected.path === previousSelected.path;
  const clearMachinePreview = state.get("active_selection")?.pane === "machine";

  state.patch({
    config,
    config_warnings: warnings,
    selected_machine: keepSelection ? nextSelected : null,
    machine_statuses: nextStatuses,
    ...(!keepSelection
      ? {
          machine_current_path: null,
          machine_breadcrumb: [],
          machine_entries: [],
          selected_machine_entry: null,
          ...(clearMachinePreview
            ? {
                active_selection: null,
                preview: null,
              }
            : {}),
        }
      : {}),
  });

  // Apply language from config (only triggers subscribers when it actually changes).
  const newLang = ((config.language || "hr") as Language);
  if (newLang !== state.get("language")) {
    state.set("language", newLang);
  }
}
