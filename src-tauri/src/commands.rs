use crate::availability::check_path_availability;
use crate::browser::{list_directory, search_directory_recursive, set_active_local_search_request};
use crate::config::{
    default_config_write_path, load_config, load_machine_profiles, save_config,
    save_machine_profiles, validate_config, validate_machine_profiles,
};
use crate::models::{
    AppConfig, AvailabilityStatus, BrowserEntry, DeleteEntriesResult, MachineProfile,
    MachineProfilesValidation, PreviewData, TransferFileResult,
};
use crate::path_guard::{path_is_within_root, paths_refer_to_same_location};
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
pub fn cmd_delete_entry(path: String, machine_root: String) -> Result<(), String> {
    delete_entry_at_path(&path, &machine_root)
}

/// Delete all contents of a directory without deleting the directory itself.
#[tauri::command]
pub fn cmd_delete_directory_contents(path: String, machine_root: String) -> Result<usize, String> {
    delete_directory_contents_at_path(&path, &machine_root)
}

/// Batch delete multiple entries. Returns summary of deleted/skipped/failed counts.
#[tauri::command]
pub fn cmd_delete_entries(
    paths: Vec<String>,
    machine_root: String,
) -> Result<DeleteEntriesResult, String> {
    let mut deleted = 0usize;
    let skipped = 0usize;
    let mut failed = 0usize;
    let mut first_error: Option<String> = None;

    for path in paths {
        match delete_entry_at_path(&path, &machine_root) {
            Ok(_) => deleted += 1,
            Err(error) => {
                failed += 1;
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    Ok(DeleteEntriesResult {
        deleted,
        skipped,
        failed,
        first_error,
    })
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
    use super::{cmd_delete_directory_contents, cmd_delete_entry, delete_entry_at_path};
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

        cmd_delete_entry(
            file.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        )
        .unwrap();

        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_entry_removes_directory_recursively() {
        let root = unique_temp_dir("delete-entry-dir");
        let dir = root.join("sub");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("nested.txt"), "test").unwrap();

        cmd_delete_entry(
            dir.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        )
        .unwrap();

        assert!(!dir.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_directory_contents_keeps_root_folder() {
        let root = unique_temp_dir("delete-all");
        std::fs::create_dir_all(root.join("nested")).unwrap();
        std::fs::write(root.join("program.nc"), "G0 X0").unwrap();
        std::fs::write(root.join("nested").join("note.txt"), "note").unwrap();

        let deleted = cmd_delete_directory_contents(
            root.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(deleted, 2);
        assert!(root.exists());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_entry_rejects_path_outside_machine_root() {
        let root = unique_temp_dir("delete-entry-root");
        let outside_root = unique_temp_dir("delete-entry-outside");
        let outside_file = outside_root.join("program.nc");

        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside_root).unwrap();
        std::fs::write(&outside_file, "G0 X0").unwrap();

        let error = delete_entry_at_path(&outside_file.to_string_lossy(), &root.to_string_lossy())
            .unwrap_err();

        assert!(error.contains("selected machine location"));
        assert!(outside_file.exists());

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside_root);
    }

    #[test]
    fn delete_entry_rejects_machine_root_itself() {
        let root = unique_temp_dir("delete-entry-root-self");
        std::fs::create_dir_all(&root).unwrap();

        let error =
            delete_entry_at_path(&root.to_string_lossy(), &root.to_string_lossy()).unwrap_err();

        assert!(error.contains("machine location itself"));
        assert!(root.exists());

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

fn delete_entry_at_path(path: &str, machine_root: &str) -> Result<(), String> {
    use std::path::Path;

    let normalized_entry_path = crate::path_guard::normalize_machine_path(path);
    let normalized_machine_root = crate::path_guard::normalize_machine_path(machine_root);
    let entry_path = Path::new(&normalized_entry_path);

    log_delete_event(
        "delete_entry",
        "request",
        path,
        &normalized_entry_path,
        machine_root,
        &normalized_machine_root,
        None,
    );

    if !entry_path.exists() {
        let error = format!("Path does not exist: {normalized_entry_path}");
        log_delete_event(
            "delete_entry",
            "missing",
            path,
            &normalized_entry_path,
            machine_root,
            &normalized_machine_root,
            Some(&error),
        );
        return Err(error);
    }

    let within_root = path_is_within_root(&normalized_machine_root, entry_path)?;
    log_delete_event(
        "delete_entry",
        "guard",
        path,
        &normalized_entry_path,
        machine_root,
        &normalized_machine_root,
        Some(if within_root { "accepted" } else { "rejected" }),
    );
    if !within_root {
        let error = format!(
            "Delete path must stay inside the selected machine location: {normalized_entry_path}"
        );
        log_delete_event(
            "delete_entry",
            "guard_rejected",
            path,
            &normalized_entry_path,
            machine_root,
            &normalized_machine_root,
            Some(&error),
        );
        return Err(error);
    }

    if paths_refer_to_same_location(&normalized_machine_root, entry_path)? {
        let error = "Cannot delete the selected machine location itself.".to_string();
        log_delete_event(
            "delete_entry",
            "same_as_root",
            path,
            &normalized_entry_path,
            machine_root,
            &normalized_machine_root,
            Some(&error),
        );
        return Err(error);
    }

    if entry_path.is_dir() {
        log_delete_event(
            "delete_entry",
            "remove_dir_all",
            path,
            &normalized_entry_path,
            machine_root,
            &normalized_machine_root,
            None,
        );
        std::fs::remove_dir_all(entry_path).map_err(|e| {
            let error = format!("Delete failed: {e}");
            log_delete_event(
                "delete_entry",
                "remove_dir_all_error",
                path,
                &normalized_entry_path,
                machine_root,
                &normalized_machine_root,
                Some(&error),
            );
            error
        })?;
    } else {
        log_delete_event(
            "delete_entry",
            "remove_file",
            path,
            &normalized_entry_path,
            machine_root,
            &normalized_machine_root,
            None,
        );
        std::fs::remove_file(entry_path).map_err(|e| {
            let error = format!("Delete failed: {e}");
            log_delete_event(
                "delete_entry",
                "remove_file_error",
                path,
                &normalized_entry_path,
                machine_root,
                &normalized_machine_root,
                Some(&error),
            );
            error
        })?;
    }

    log_delete_event(
        "delete_entry",
        "success",
        path,
        &normalized_entry_path,
        machine_root,
        &normalized_machine_root,
        None,
    );
    Ok(())
}

fn delete_directory_contents_at_path(path: &str, machine_root: &str) -> Result<usize, String> {
    use std::path::Path;

    let normalized_dir_path = crate::path_guard::normalize_machine_path(path);
    let normalized_machine_root = crate::path_guard::normalize_machine_path(machine_root);
    let dir_path = Path::new(&normalized_dir_path);

    log_delete_event(
        "delete_all",
        "request",
        path,
        &normalized_dir_path,
        machine_root,
        &normalized_machine_root,
        None,
    );

    if !dir_path.exists() {
        let error = format!("Directory does not exist: {normalized_dir_path}");
        log_delete_event(
            "delete_all",
            "missing",
            path,
            &normalized_dir_path,
            machine_root,
            &normalized_machine_root,
            Some(&error),
        );
        return Err(error);
    }
    if !dir_path.is_dir() {
        let error = format!("Not a directory: {normalized_dir_path}");
        log_delete_event(
            "delete_all",
            "not_directory",
            path,
            &normalized_dir_path,
            machine_root,
            &normalized_machine_root,
            Some(&error),
        );
        return Err(error);
    }

    let within_root = path_is_within_root(&normalized_machine_root, dir_path)?;
    log_delete_event(
        "delete_all",
        "guard",
        path,
        &normalized_dir_path,
        machine_root,
        &normalized_machine_root,
        Some(if within_root { "accepted" } else { "rejected" }),
    );
    if !within_root {
        let error = format!(
            "Folder to clear must stay inside the selected machine location: {normalized_dir_path}"
        );
        log_delete_event(
            "delete_all",
            "guard_rejected",
            path,
            &normalized_dir_path,
            machine_root,
            &normalized_machine_root,
            Some(&error),
        );
        return Err(error);
    }

    let mut deleted_count = 0usize;

    for entry_result in std::fs::read_dir(dir_path)
        .map_err(|e| format!("Cannot read directory '{normalized_dir_path}': {e}"))?
    {
        let entry = entry_result.map_err(|e| format!("Cannot read directory entry: {e}"))?;
        let child_path = entry.path();
        if child_path.is_dir() {
            std::fs::remove_dir_all(&child_path).map_err(|e| {
                let error = format!("Delete failed: {e}");
                log_delete_event(
                    "delete_all",
                    "remove_dir_all_error",
                    path,
                    &normalized_dir_path,
                    machine_root,
                    &normalized_machine_root,
                    Some(&error),
                );
                error
            })?;
        } else {
            std::fs::remove_file(&child_path).map_err(|e| {
                let error = format!("Delete failed: {e}");
                log_delete_event(
                    "delete_all",
                    "remove_file_error",
                    path,
                    &normalized_dir_path,
                    machine_root,
                    &normalized_machine_root,
                    Some(&error),
                );
                error
            })?;
        }
        deleted_count += 1;
    }

    let success_detail = format!("deleted_count={deleted_count}");
    log_delete_event(
        "delete_all",
        "success",
        path,
        &normalized_dir_path,
        machine_root,
        &normalized_machine_root,
        Some(&success_detail),
    );
    Ok(deleted_count)
}

fn log_delete_event(
    operation: &str,
    stage: &str,
    raw_path: &str,
    normalized_path: &str,
    raw_root: &str,
    normalized_root: &str,
    detail: Option<&str>,
) {
    match detail {
        Some(detail) => eprintln!(
            "[haas-delete] op={operation} stage={stage} raw_path={raw_path:?} path={normalized_path:?} raw_root={raw_root:?} root={normalized_root:?} detail={detail}"
        ),
        None => eprintln!(
            "[haas-delete] op={operation} stage={stage} raw_path={raw_path:?} path={normalized_path:?} raw_root={raw_root:?} root={normalized_root:?}"
        ),
    }
}

/// Check whether a path points to a directory (folder) or a file.
/// Returns true if path is a directory, false if it's a file or doesn't exist.
#[tauri::command]
pub fn cmd_is_directory(path: String) -> bool {
    let path = std::path::PathBuf::from(path.trim());
    path.is_dir()
}
