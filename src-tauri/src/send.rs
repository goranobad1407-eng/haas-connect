use std::path::{Path, PathBuf};

use crate::availability::check_path_availability;
use crate::models::{AvailabilityStatus, TransferFileResult, TransferFileStatus};

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
            "Choose a source file first.".into(),
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
                "Source path does not point to a file.".into(),
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
            "Selected source file does not exist.".into(),
        );
    }

    if source.is_dir() {
        return result(
            TransferFileStatus::InvalidSource,
            source_path,
            destination_dir,
            None,
            file_name,
            "Source must be a file, not a folder.".into(),
        );
    }

    let extension = source
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();

    if let Some(allowed_extensions) = allowed_extensions {
        if allowed_extensions.is_empty() {
            return result(
                TransferFileStatus::InvalidExtension,
                source_path,
                destination_dir,
                None,
                file_name,
                "The destination profile has no allowed extensions configured.".into(),
            );
        }

        if !allowed_extensions.iter().any(|item| item == &extension) {
            return result(
                TransferFileStatus::InvalidExtension,
                source_path,
                destination_dir,
                None,
                file_name,
                format!(
                    "Extension '{}' is not allowed for the destination machine.",
                    if extension.is_empty() {
                        "(none)"
                    } else {
                        &extension
                    }
                ),
            );
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
                    message,
                )
            }
            Ok(true) => {}
        }
    }

    let destination_path = destination.join(&file_name);
    if destination_path.exists() && destination_path.is_dir() {
        return result(
            TransferFileStatus::InvalidDestination,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name,
            "Destination contains a folder with the same name.".into(),
        );
    }

    if destination_path.exists() && !overwrite {
        return result(
            TransferFileStatus::OverwriteRequired,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name.clone(),
            format!("'{}' already exists in the destination folder.", file_name),
        );
    }

    let source_for_copy = source.clone();
    let destination_for_copy = destination_path.clone();
    let copy_result = tokio::task::spawn_blocking(move || {
        if overwrite && destination_for_copy.exists() {
            std::fs::remove_file(&destination_for_copy)?;
        }

        std::fs::copy(&source_for_copy, &destination_for_copy)
    })
    .await;

    match copy_result {
        Ok(Ok(_)) => result(
            TransferFileStatus::Success,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name.clone(),
            format!("Copied '{}' into the destination folder.", file_name),
        ),
        Ok(Err(error)) => result(
            TransferFileStatus::CopyFailed,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name,
            format!("Copy failed: {error}"),
        ),
        Err(_) => result(
            TransferFileStatus::CopyFailed,
            source_path,
            destination_dir,
            Some(destination_path.to_string_lossy().to_string()),
            file_name,
            "Copy task failed unexpectedly.".into(),
        ),
    }
}

fn destination_offline_message(status: AvailabilityStatus) -> String {
    match status {
        AvailabilityStatus::Timeout => "Destination folder did not respond within the timeout.".into(),
        AvailabilityStatus::Offline => "Destination folder is offline or unreachable.".into(),
        AvailabilityStatus::Error => "Destination folder check failed.".into(),
        AvailabilityStatus::Checking => "Destination folder is still being checked.".into(),
        AvailabilityStatus::Unknown => "Destination folder has not been verified.".into(),
        AvailabilityStatus::Online => "Destination folder is online.".into(),
    }
}

fn ensure_destination_is_within_root(
    root: &str,
    destination_dir: &Path,
) -> Result<bool, String> {
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|error| format!("Could not resolve destination root '{}': {error}", root))?;
    let canonical_destination = std::fs::canonicalize(destination_dir).map_err(|error| {
        format!(
            "Could not resolve destination folder '{}': {error}",
            destination_dir.to_string_lossy()
        )
    })?;

    Ok(canonical_destination.starts_with(&canonical_root))
}

fn result(
    status: TransferFileStatus,
    source_path: String,
    destination_dir: String,
    destination_path: Option<String>,
    file_name: String,
    message: String,
) -> TransferFileResult {
    TransferFileResult {
        status,
        source_path,
        destination_dir,
        destination_path,
        file_name,
        message,
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
}
