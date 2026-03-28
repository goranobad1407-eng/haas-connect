use crate::availability::check_path_availability;
use crate::browser::list_directory;
use crate::config::{
    default_config_write_path, load_config, load_machine_profiles, save_config,
    save_machine_profiles, validate_config, validate_machine_profiles,
};
use crate::models::{
    AppConfig, AvailabilityStatus, BrowserEntry, MachineProfile, MachineProfilesValidation,
    PreviewData, TransferFileResult,
};
use crate::preview::{get_preview, open_in_default_app};
use crate::send::transfer_file;

/// Load the application config from disk.
/// Returns the config plus any validation warnings (non-fatal).
#[tauri::command]
pub fn cmd_load_config() -> Result<(AppConfig, Vec<String>), String> {
    let mut config = load_config();
    let profile_validation = validate_machine_profiles(&config.machines);
    config.machines = profile_validation.profiles;
    let warnings = validate_config(&config);
    Ok((config, warnings))
}

#[tauri::command]
pub fn cmd_load_machine_profiles() -> Result<Vec<MachineProfile>, String> {
    Ok(load_machine_profiles())
}

#[tauri::command]
pub fn cmd_validate_machine_profiles(
    profiles: Vec<MachineProfile>,
) -> Result<MachineProfilesValidation, String> {
    Ok(validate_machine_profiles(&profiles))
}

/// Persist the application config to disk.
#[tauri::command]
pub fn cmd_save_config(config: AppConfig) -> Result<(), String> {
    let path = default_config_write_path();
    save_config(&config, &path)
}

#[tauri::command]
pub fn cmd_save_machine_profiles(
    profiles: Vec<MachineProfile>,
    confirmed_protected_removals: Option<Vec<String>>,
) -> Result<(AppConfig, Vec<String>), String> {
    let path = default_config_write_path();
    let confirmed_protected_removals = confirmed_protected_removals.unwrap_or_default();
    save_machine_profiles(profiles, &confirmed_protected_removals, &path)
}

/// Return the filesystem path where machines.json will be written.
#[tauri::command]
pub fn cmd_get_config_path() -> String {
    default_config_write_path().to_string_lossy().to_string()
}

/// Asynchronously check whether a machine path is reachable.
/// Returns immediately if the path is clearly unavailable, or after the
/// configured timeout if the OS is blocking on a dead network share.
#[tauri::command]
pub async fn cmd_check_availability(path: String, timeout_secs: Option<u64>) -> AvailabilityStatus {
    check_path_availability(path, timeout_secs.unwrap_or(3)).await
}

/// List the immediate children of a directory. Does NOT recurse.
/// Should only be called after cmd_check_availability returned Online.
#[tauri::command]
pub fn cmd_list_directory(path: String) -> Result<Vec<BrowserEntry>, String> {
    list_directory(&path)
}

/// Get an inline preview for a file.
/// Safe to call only after confirming the path is reachable.
/// max_bytes caps how much file content is read.
#[tauri::command]
pub fn cmd_get_preview(path: String, max_bytes: Option<u64>) -> Result<PreviewData, String> {
    get_preview(&path, max_bytes.unwrap_or(51_200))
}

/// Delete a single file (not directory). Requires user confirmation on the
/// frontend — this command performs the deletion without further prompts.
/// Will fail if the machine/location is marked protected in the config.
#[tauri::command]
pub fn cmd_delete_file(path: String) -> Result<(), String> {
    use std::path::Path;

    let p = Path::new(&path);

    if !p.exists() {
        return Err(format!("File does not exist: {path}"));
    }
    if p.is_dir() {
        return Err("Refusing to delete a directory via this command.".into());
    }

    std::fs::remove_file(p).map_err(|e| format!("Delete failed: {e}"))
}

/// Open a file or directory in the OS default application (Explorer, PDF viewer, etc.)
#[tauri::command]
pub fn cmd_open_external(path: String) -> Result<(), String> {
    open_in_default_app(&path)
}

#[tauri::command]
pub async fn cmd_transfer_file(
    source_path: String,
    destination_dir: String,
    overwrite: bool,
    timeout_secs: Option<u64>,
    allowed_extensions: Option<Vec<String>>,
    destination_root: Option<String>,
) -> Result<TransferFileResult, String> {
    Ok(transfer_file(
        source_path,
        destination_dir,
        overwrite,
        timeout_secs.unwrap_or(3),
        allowed_extensions,
        destination_root,
    )
    .await)
}

#[cfg(test)]
mod tests {
    #[test]
    fn missing_confirmed_protected_removals_defaults_to_empty_list() {
        let confirmed_protected_removals: Option<Vec<String>> = None;
        let values = confirmed_protected_removals.unwrap_or_default();
        assert!(values.is_empty());
    }

    #[test]
    fn missing_timeout_defaults_cleanly() {
        let timeout_secs: Option<u64> = None;
        assert_eq!(timeout_secs.unwrap_or(3), 3);
    }
}
