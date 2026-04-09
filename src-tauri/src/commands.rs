use crate::availability::check_path_availability;
use crate::browser::{list_directory, search_directory_recursive, set_active_local_search_request};
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

/// Recursively search one local directory tree by entry name.
/// Scope is limited to the requested path and its descendants.
#[tauri::command]
pub fn cmd_set_active_local_search_request(request_id: u64) {
    set_active_local_search_request(request_id);
}

#[tauri::command]
pub fn cmd_search_local_entries(
    path: String,
    query: String,
    request_id: u64,
) -> Result<Vec<BrowserEntry>, String> {
    search_directory_recursive(&path, &query, request_id)
}

/// Get an inline preview for a file.
/// Safe to call only after confirming the path is reachable.
/// max_bytes caps how much file content is read.
#[tauri::command]
pub fn cmd_get_preview(path: String, max_bytes: Option<u64>) -> Result<PreviewData, String> {
    get_preview(&path, max_bytes.unwrap_or(51_200))
}

/// Delete a single file or directory entry. Requires user confirmation on the
/// frontend — this command performs the deletion without further prompts.
#[tauri::command]
pub fn cmd_delete_entry(path: String) -> Result<(), String> {
    delete_entry_at_path(&path)
}

/// Delete all contents of a directory without deleting the directory itself.
#[tauri::command]
pub fn cmd_delete_directory_contents(path: String) -> Result<usize, String> {
    delete_directory_contents_at_path(&path)
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
    use super::{cmd_delete_directory_contents, cmd_delete_entry};
    use std::path::PathBuf;

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

    #[test]
    fn delete_entry_removes_file() {
        let root = unique_temp_dir("delete-entry-file");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("program.nc");
        std::fs::write(&file, "G0 X0 Y0").unwrap();

        cmd_delete_entry(file.to_string_lossy().to_string()).unwrap();

        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_entry_removes_directory_recursively() {
        let root = unique_temp_dir("delete-entry-dir");
        let dir = root.join("sub");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("nested.txt"), "test").unwrap();

        cmd_delete_entry(dir.to_string_lossy().to_string()).unwrap();

        assert!(!dir.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_directory_contents_keeps_root_folder() {
        let root = unique_temp_dir("delete-all");
        std::fs::create_dir_all(root.join("nested")).unwrap();
        std::fs::write(root.join("program.nc"), "G0 X0").unwrap();
        std::fs::write(root.join("nested").join("note.txt"), "note").unwrap();

        let deleted = cmd_delete_directory_contents(root.to_string_lossy().to_string()).unwrap();

        assert_eq!(deleted, 2);
        assert!(root.exists());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "haas-connect-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}

fn delete_entry_at_path(path: &str) -> Result<(), String> {
    use std::path::Path;

    let entry_path = Path::new(path);

    if !entry_path.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    if entry_path.is_dir() {
        std::fs::remove_dir_all(entry_path).map_err(|e| format!("Delete failed: {e}"))?;
    } else {
        std::fs::remove_file(entry_path).map_err(|e| format!("Delete failed: {e}"))?;
    }

    Ok(())
}

fn delete_directory_contents_at_path(path: &str) -> Result<usize, String> {
    use std::path::Path;

    let dir_path = Path::new(path);

    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {path}"));
    }
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut deleted_count = 0usize;

    for entry_result in std::fs::read_dir(dir_path)
        .map_err(|e| format!("Cannot read directory '{path}': {e}"))?
    {
        let entry = entry_result.map_err(|e| format!("Cannot read directory entry: {e}"))?;
        let child_path = entry.path();
        if child_path.is_dir() {
            std::fs::remove_dir_all(&child_path).map_err(|e| format!("Delete failed: {e}"))?;
        } else {
            std::fs::remove_file(&child_path).map_err(|e| format!("Delete failed: {e}"))?;
        }
        deleted_count += 1;
    }

    Ok(deleted_count)
}
