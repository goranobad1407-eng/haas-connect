use std::path::{Path, PathBuf};

use crate::availability::check_path_availability;
use crate::models::{AvailabilityStatus, TransferFileResult, TransferFileStatus};
use crate::path_guard::path_is_within_root;

pub async fn transfer_file(
    source_path: String,
    destination_dir: String,
    overwrite: bool,
    timeout_secs: u64,
    allowed_extensions: Option<Vec<String>>,
    destination_root: Option<String>,
) -> TransferFileResult {
    let source_path = source_path.trim().to_string();
    let destination_dir = destination_dir.trim().to_string();
    let source = PathBuf::from(&source_path);
    let destination = PathBuf::from(&destination_dir);

    if source_path.is_empty() {
        return result(
            TransferFileStatus::InvalidSource,
            source_path,
            destination_dir,
            None,
            String::new(),
            false,
            "Choose a source file or folder first.".into(),
        );
    }

    let file_name = match source.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => {
            return result(
                TransferFileStatus::InvalidSource,
                source_path,
                destination_dir,
                None,
                String::new(),
                false,
                "Source path does not point to a file or folder.".into(),
            )
        }
    };

    if !source.exists() {
        return result(
            TransferFileStatus::InvalidSource,
            source_path,
            destination_dir,
            None,
            file_name,
            false,
            "Selected source path does not exist.".into(),
        );
    }

    let source_is_directory = source.is_dir();
    if !source_is_directory && !source.is_file() {
        return result(
            TransferFileStatus::InvalidSource,
            source_path,
            destination_dir,
            None,
            file_name,
            false,
            "Source must be a regular file or folder.".into(),
        );
    }

    if let Some(ref exts) = allowed_extensions {
        if exts.is_empty() {
            return result(
                TransferFileStatus::InvalidExtension,
                source_path,
                destination_dir,
                None,
                file_name,
                source_is_directory,
                "The destination profile has no allowed extensions configured.".into(),
            );
        }
        // For single files, reject disallowed extensions upfront.
        // For directories, disallowed files are skipped during copy.
        if !source_is_directory {
            if let Err(message) = validate_file_extension(&source, exts) {
                return result(
                    TransferFileStatus::InvalidExtension,
                    source_path,
                    destination_dir,
                    None,
                    file_name,
                    source_is_directory,
                    message,
                );
            }
        }
    }

    let availability = check_path_availability(destination_dir.clone(), timeout_secs).await;
    if availability != AvailabilityStatus::Online {
        return result(
            TransferFileStatus::DestinationOffline,
            source_path,
            destination_dir,
            None,
            file_name,
            source_is_directory,
            destination_offline_message(availability),
        );
    }

    if !destination.exists() {
        return result(
            TransferFileStatus::InvalidDestination,
            source_path,
            destination_dir,
            None,
            file_name,
            source_is_directory,
            "Destination folder does not exist.".into(),
        );
    }

    if !destination.is_dir() {
        return result(
            TransferFileStatus::InvalidDestination,
            source_path,
            destination_dir,
            None,
            file_name,
            source_is_directory,
            "Destination must be a folder.".into(),
        );
    }

    if let Some(root) = destination_root {
        match ensure_destination_is_within_root(&root, &destination) {
            Ok(false) => {
                return result(
                    TransferFileStatus::InvalidDestination,
                    source_path,
                    destination_dir,
                    None,
                    file_name,
                    source_is_directory,
                    "Destination must stay inside the selected machine location.".into(),
                )
            }
            Err(message) => {
                return result(
                    TransferFileStatus::InvalidDestination,
                    source_path,
                    destination_dir,
                    None,
                    file_name,
                    source_is_directory,
                    message,
                )
            }
            Ok(true) => {}
        }
    }

    let destination_path = destination.join(&file_name);
    let destination_path_string = destination_path.to_string_lossy().to_string();

    if source_is_directory {
        if destination_path.exists() && !destination_path.is_dir() {
            return result(
                TransferFileStatus::InvalidDestination,
                source_path,
                destination_dir,
                Some(destination_path_string),
                file_name,
                true,
                "Destination contains a file with the same folder name.".into(),
            );
        }

        if destination_path.exists() && !overwrite {
            return result(
                TransferFileStatus::OverwriteRequired,
                source_path,
                destination_dir,
                Some(destination_path_string),
                file_name,
                true,
                format!(
                    "Folder '{}' already exists in the destination folder.",
                    source.file_name().unwrap().to_string_lossy()
                ),
            );
        }
    } else {
        if destination_path.exists() && destination_path.is_dir() {
            return result(
                TransferFileStatus::InvalidDestination,
                source_path,
                destination_dir,
                Some(destination_path_string),
                file_name,
                false,
                "Destination contains a folder with the same file name.".into(),
            );
        }

        if destination_path.exists() && !overwrite {
            return result(
                TransferFileStatus::OverwriteRequired,
                source_path,
                destination_dir,
                Some(destination_path_string),
                file_name,
                false,
                format!(
                    "'{}' already exists in the destination folder.",
                    source.file_name().unwrap().to_string_lossy()
                ),
            );
        }
    }

    let source_for_copy = source.clone();
    let destination_for_copy = destination_path.clone();
    let allowed_ext_for_copy = allowed_extensions;
    let copy_result = tokio::task::spawn_blocking(move || {
        if source_for_copy.is_dir() {
            copy_directory_tree(
                &source_for_copy,
                &destination_for_copy,
                overwrite,
                allowed_ext_for_copy.as_deref(),
            )
        } else {
            copy_single_file(&source_for_copy, &destination_for_copy, overwrite).map(|_| {
                CopyDirectoryStats {
                    copied: 1,
                    skipped_disallowed: 0,
                }
            })
        }
    })
    .await;

    match copy_result {
        Ok(Ok(stats)) => {
            let message = if source_is_directory && stats.skipped_disallowed > 0 {
                format!(
                    "Copied folder '{}': {} file(s) copied, {} skipped (extension not allowed).",
                    file_name, stats.copied, stats.skipped_disallowed
                )
            } else if source_is_directory {
                format!("Copied folder '{}' into the destination folder.", file_name)
            } else {
                format!("Copied '{}' into the destination folder.", file_name)
            };
            let mut r = result(
                TransferFileStatus::Success,
                source_path,
                destination_dir,
                Some(destination_path.to_string_lossy().to_string()),
                file_name,
                source_is_directory,
                message,
            );
            if source_is_directory {
                r.copied_count = Some(stats.copied);
                r.skipped_count = Some(stats.skipped_disallowed);
            }
            r
        }
        Ok(Err(error)) => result(
            TransferFileStatus::CopyFailed,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name,
            source_is_directory,
            format!("Copy failed: {error}"),
        ),
        Err(_) => result(
            TransferFileStatus::CopyFailed,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name,
            source_is_directory,
            "Copy task failed unexpectedly.".into(),
        ),
    }
}

struct CopyDirectoryStats {
    copied: usize,
    skipped_disallowed: usize,
}

fn is_extension_allowed(file: &Path, allowed_extensions: &[String]) -> bool {
    let extension = file
        .extension()
        .map(|v| format!(".{}", v.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    allowed_extensions.iter().any(|item| item == &extension)
}

fn validate_file_extension(file: &Path, allowed_extensions: &[String]) -> Result<(), String> {
    let extension = file
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();

    if allowed_extensions.iter().any(|item| item == &extension) {
        return Ok(());
    }

    let display_extension = if extension.is_empty() {
        "(none)".to_string()
    } else {
        extension
    };

    Err(format!(
        "Extension '{}' is not allowed for '{}'.",
        display_extension,
        file.to_string_lossy()
    ))
}

fn copy_directory_tree(
    source: &Path,
    destination: &Path,
    overwrite: bool,
    allowed_extensions: Option<&[String]>,
) -> Result<CopyDirectoryStats, std::io::Error> {
    if destination.exists() && !destination.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!(
                "Destination '{}' is a file, not a folder.",
                destination.to_string_lossy()
            ),
        ));
    }

    std::fs::create_dir_all(destination)?;

    let mut stats = CopyDirectoryStats {
        copied: 0,
        skipped_disallowed: 0,
    };

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if source_path.is_dir() {
            let sub = copy_directory_tree(
                &source_path,
                &destination_path,
                overwrite,
                allowed_extensions,
            )?;
            stats.copied += sub.copied;
            stats.skipped_disallowed += sub.skipped_disallowed;
        } else if source_path.is_file() {
            if let Some(allowed) = allowed_extensions {
                if !is_extension_allowed(&source_path, allowed) {
                    stats.skipped_disallowed += 1;
                    continue;
                }
            }
            copy_single_file(&source_path, &destination_path, overwrite)?;
            stats.copied += 1;
        }
    }

    Ok(stats)
}

fn copy_single_file(source: &Path, destination: &Path, overwrite: bool) -> std::io::Result<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if destination.exists() {
        if destination.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!(
                    "Destination '{}' is a folder, not a file.",
                    destination.to_string_lossy()
                ),
            ));
        }

        if overwrite {
            std::fs::remove_file(destination)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!(
                    "Destination file '{}' already exists.",
                    destination.to_string_lossy()
                ),
            ));
        }
    }

    std::fs::copy(source, destination).map(|_| ())
}

fn destination_offline_message(status: AvailabilityStatus) -> String {
    match status {
        AvailabilityStatus::Timeout => {
            "Destination folder did not respond within the timeout.".into()
        }
        AvailabilityStatus::Offline => "Destination folder is offline or unreachable.".into(),
        AvailabilityStatus::Error => "Destination folder check failed.".into(),
        AvailabilityStatus::Checking => "Destination folder is still being checked.".into(),
        AvailabilityStatus::Unknown => "Destination folder has not been verified.".into(),
        AvailabilityStatus::Online => "Destination folder is online.".into(),
    }
}

fn ensure_destination_is_within_root(root: &str, destination_dir: &Path) -> Result<bool, String> {
    path_is_within_root(root, destination_dir)
}

fn result(
    status: TransferFileStatus,
    source_path: String,
    destination_dir: String,
    destination_path: Option<String>,
    file_name: String,
    is_directory: bool,
    message: String,
) -> TransferFileResult {
    TransferFileResult {
        status,
        source_path,
        destination_dir,
        destination_path,
        file_name,
        is_directory,
        message,
        copied_count: None,
        skipped_count: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let value = format!(
            "haas-transfer-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(value);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[tokio::test]
    async fn rejects_disallowed_extension() {
        let root = unique_temp_dir("ext-root");
        let source_dir = unique_temp_dir("ext-source");
        let source = source_dir.join("program.txt");
        std::fs::write(&source, "hello").unwrap();

        let result = transfer_file(
            source.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into(), ".tap".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::InvalidExtension);

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn returns_overwrite_required_when_destination_exists() {
        let root = unique_temp_dir("overwrite-root");
        let source_dir = unique_temp_dir("overwrite-source");
        let source = source_dir.join("program.nc");
        let destination = root.join("program.nc");

        std::fs::write(&source, "new").unwrap();
        std::fs::write(&destination, "old").unwrap();

        let result = transfer_file(
            source.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::OverwriteRequired);
        assert!(!result.is_directory);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "old");

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn overwrites_when_confirmed() {
        let root = unique_temp_dir("overwrite-confirm-root");
        let source_dir = unique_temp_dir("overwrite-confirm-source");
        let source = source_dir.join("program.nc");
        let destination = root.join("program.nc");

        std::fs::write(&source, "new").unwrap();
        std::fs::write(&destination, "old").unwrap();

        let result = transfer_file(
            source.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            true,
            1,
            Some(vec![".nc".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn rejects_invalid_source() {
        let root = unique_temp_dir("invalid-source-root");
        let source = root.join("missing.nc");

        let result = transfer_file(
            source.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::InvalidSource);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn rejects_offline_destination() {
        let root = unique_temp_dir("offline-root");
        let source_dir = unique_temp_dir("offline-source");
        let source = source_dir.join("program.nc");
        std::fs::write(&source, "hello").unwrap();

        let destination = root.join("missing-folder");
        let result = transfer_file(
            source.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::DestinationOffline);

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn copies_successfully_into_destination() {
        let root = unique_temp_dir("success-root");
        let source_dir = unique_temp_dir("success-source");
        let source = source_dir.join("program.nc");
        let destination = root.join("nested");
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(&source, "G01 X1").unwrap();

        let result = transfer_file(
            source.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert_eq!(
            std::fs::read_to_string(destination.join("program.nc")).unwrap(),
            "G01 X1"
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn copies_successfully_to_local_folder_without_machine_rules() {
        let local_root = unique_temp_dir("local-root");
        let source_dir = unique_temp_dir("machine-source");
        let source = source_dir.join("program.tap");
        std::fs::write(&source, "M30").unwrap();

        let result = transfer_file(
            source.to_string_lossy().to_string(),
            local_root.to_string_lossy().to_string(),
            false,
            1,
            None,
            None,
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert_eq!(
            std::fs::read_to_string(local_root.join("program.tap")).unwrap(),
            "M30"
        );

        let _ = std::fs::remove_dir_all(local_root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn copies_directory_recursively_into_destination() {
        let root = unique_temp_dir("dir-success-root");
        let source_dir = unique_temp_dir("dir-success-source");
        let source_folder = source_dir.join("job");
        let nested = source_folder.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(source_folder.join("program.nc"), "G0 X1").unwrap();
        std::fs::write(nested.join("notes.txt"), "setup").unwrap();

        let result = transfer_file(
            source_folder.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into(), ".txt".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert!(result.is_directory);
        assert_eq!(
            std::fs::read_to_string(root.join("job").join("program.nc")).unwrap(),
            "G0 X1"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("job").join("sub").join("notes.txt")).unwrap(),
            "setup"
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn directory_requires_overwrite_when_destination_exists() {
        let root = unique_temp_dir("dir-overwrite-root");
        let source_dir = unique_temp_dir("dir-overwrite-source");
        let source_folder = source_dir.join("job");
        std::fs::create_dir_all(&source_folder).unwrap();
        std::fs::write(source_folder.join("program.nc"), "new").unwrap();

        let existing = root.join("job");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(existing.join("program.nc"), "old").unwrap();

        let result = transfer_file(
            source_folder.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::OverwriteRequired);
        assert!(result.is_directory);
        assert_eq!(
            std::fs::read_to_string(existing.join("program.nc")).unwrap(),
            "old"
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn directory_merge_overwrites_conflicting_files_when_confirmed() {
        let root = unique_temp_dir("dir-overwrite-confirm-root");
        let source_dir = unique_temp_dir("dir-overwrite-confirm-source");
        let source_folder = source_dir.join("job");
        let source_nested = source_folder.join("sub");
        std::fs::create_dir_all(&source_nested).unwrap();
        std::fs::write(source_folder.join("program.nc"), "new").unwrap();
        std::fs::write(source_nested.join("setup.txt"), "fresh").unwrap();

        let existing = root.join("job");
        let existing_nested = existing.join("sub");
        std::fs::create_dir_all(&existing_nested).unwrap();
        std::fs::write(existing.join("program.nc"), "old").unwrap();
        std::fs::write(existing_nested.join("keep.txt"), "keep").unwrap();

        let result = transfer_file(
            source_folder.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            true,
            1,
            Some(vec![".nc".into(), ".txt".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert_eq!(
            std::fs::read_to_string(existing.join("program.nc")).unwrap(),
            "new"
        );
        assert_eq!(
            std::fs::read_to_string(existing_nested.join("setup.txt")).unwrap(),
            "fresh"
        );
        assert_eq!(
            std::fs::read_to_string(existing_nested.join("keep.txt")).unwrap(),
            "keep"
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn directory_with_only_disallowed_files_succeeds_with_zero_copied() {
        let root = unique_temp_dir("dir-ext-root");
        let source_dir = unique_temp_dir("dir-ext-source");
        let source_folder = source_dir.join("job");
        std::fs::create_dir_all(&source_folder).unwrap();
        std::fs::write(source_folder.join("program.exe"), "bad").unwrap();

        let result = transfer_file(
            source_folder.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into(), ".txt".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert!(result.is_directory);
        assert_eq!(result.copied_count, Some(0));
        assert_eq!(result.skipped_count, Some(1));
        // program.exe should NOT be copied
        assert!(!root.join("job").join("program.exe").exists());

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[tokio::test]
    async fn directory_copies_allowed_and_skips_disallowed_files() {
        let root = unique_temp_dir("dir-mixed-root");
        let source_dir = unique_temp_dir("dir-mixed-source");
        let source_folder = source_dir.join("job");
        let nested = source_folder.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(source_folder.join("program.nc"), "G0 X1").unwrap();
        std::fs::write(source_folder.join("readme.exe"), "bad").unwrap();
        std::fs::write(nested.join("notes.txt"), "setup").unwrap();
        std::fs::write(nested.join("hidden.dll"), "skip").unwrap();

        let result = transfer_file(
            source_folder.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            false,
            1,
            Some(vec![".nc".into(), ".txt".into()]),
            Some(root.to_string_lossy().to_string()),
        )
        .await;

        assert_eq!(result.status, TransferFileStatus::Success);
        assert!(result.is_directory);
        // Allowed files ARE copied
        assert_eq!(
            std::fs::read_to_string(root.join("job").join("program.nc")).unwrap(),
            "G0 X1"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("job").join("sub").join("notes.txt")).unwrap(),
            "setup"
        );
        // Disallowed files are NOT copied
        assert!(!root.join("job").join("readme.exe").exists());
        assert!(!root.join("job").join("sub").join("hidden.dll").exists());
        // Structured counts
        assert_eq!(result.copied_count, Some(2));
        assert_eq!(result.skipped_count, Some(2));
        // Message mentions skipped files
        assert!(result.message.contains("skipped"));

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(source_dir);
    }
}
