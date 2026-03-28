// Thin wrappers around tauri invoke calls.
// Each function maps directly to one Rust command in commands.rs.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  AvailabilityStatus,
  BrowserEntry,
  MachineProfile,
  MachineProfilesValidation,
  PreviewData,
  TransferFileResult,
} from "./types/index";

export async function loadConfig(): Promise<[AppConfig, string[]]> {
  return invoke<[AppConfig, string[]]>("cmd_load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke<void>("cmd_save_config", { config });
}

export async function loadMachineProfiles(): Promise<MachineProfile[]> {
  return invoke<MachineProfile[]>("cmd_load_machine_profiles");
}

export async function validateMachineProfiles(
  profiles: MachineProfile[]
): Promise<MachineProfilesValidation> {
  return invoke<MachineProfilesValidation>("cmd_validate_machine_profiles", {
    profiles,
  });
}

export async function saveMachineProfiles(
  profiles: MachineProfile[],
  confirmedProtectedRemovals: string[]
): Promise<[AppConfig, string[]]> {
  return invoke<[AppConfig, string[]]>("cmd_save_machine_profiles", {
    profiles,
    confirmedProtectedRemovals,
  });
}

export async function getConfigPath(): Promise<string> {
  return invoke<string>("cmd_get_config_path");
}

/** Check whether a path is reachable. Never blocks UI. */
export async function checkAvailability(
  path: string,
  timeoutSecs: number
): Promise<AvailabilityStatus> {
  return invoke<AvailabilityStatus>("cmd_check_availability", {
    path,
    timeoutSecs,
  });
}

/** List one directory level. Call only after checkAvailability returned 'online'. */
export async function listDirectory(path: string): Promise<BrowserEntry[]> {
  return invoke<BrowserEntry[]>("cmd_list_directory", { path });
}

/** Get on-demand preview for a single file. */
export async function getPreview(
  path: string,
  maxBytes: number
): Promise<PreviewData> {
  return invoke<PreviewData>("cmd_get_preview", { path, maxBytes });
}

/** Delete a single file. Confirmation must happen in the UI before calling this. */
export async function deleteFile(path: string): Promise<void> {
  return invoke<void>("cmd_delete_file", { path });
}

/** Open a file or directory in the OS default application. */
export async function openExternal(path: string): Promise<void> {
  return invoke<void>("cmd_open_external", { path });
}

export async function transferFile(
  sourcePath: string,
  destinationDir: string,
  overwrite: boolean,
  timeoutSecs: number,
  allowedExtensions?: string[],
  destinationRoot?: string
): Promise<TransferFileResult> {
  return invoke<TransferFileResult>("cmd_transfer_file", {
    sourcePath,
    destinationDir,
    overwrite,
    timeoutSecs,
    allowedExtensions,
    destinationRoot,
  });
}
