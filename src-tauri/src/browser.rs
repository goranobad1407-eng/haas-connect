use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use crate::models::BrowserEntry;

/// Previewable extensions — files the app can show inline content for.
const PREVIEWABLE: &[&str] = &[".nc", ".tap", ".cnc", ".txt", ".pdf"];
pub const LOCAL_SEARCH_CANCELLED_ERROR: &str = "__local_search_cancelled__";
static ACTIVE_LOCAL_SEARCH_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// List the immediate children of `path`. Non-recursive.
///
/// Rules:
/// - Returns Err if the path does not exist or is not a directory.
/// - Skips individual entries that cannot be read (permissions, broken links).
/// - Sorts: directories first, then files — both groups alphabetical.
/// - Does NOT recurse. One level only.
pub fn list_directory(path_str: &str) -> Result<Vec<BrowserEntry>, String> {
    let path = Path::new(path_str);

    if !path.exists() {
        return Err(format!("Path does not exist: {path_str}"));
    }

    if !path.is_dir() {
        return Err(format!("Not a directory: {path_str}"));
    }

    let read_dir =
        std::fs::read_dir(path).map_err(|e| format!("Cannot read directory '{path_str}': {e}"))?;

    let mut entries = Vec::new();

    for entry_result in read_dir {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue, // skip unreadable entry
        };

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // skip entries with unreadable metadata
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        let size = if is_dir { None } else { Some(metadata.len()) };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        let extension = if is_dir {
            String::new()
        } else {
            entry
                .path()
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default()
        };

        let previewable = !is_dir && is_previewable(&extension);

        entries.push(BrowserEntry {
            name,
            path: full_path,
            relative_path: None,
            is_dir,
            size,
            modified,
            extension,
            previewable,
        });
    }

    // Directories first, then files — both sorted case-insensitively.
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

pub fn set_active_local_search_request(request_id: u64) {
    ACTIVE_LOCAL_SEARCH_REQUEST_ID.store(request_id, Ordering::Relaxed);
}

pub fn search_directory_recursive(
    path_str: &str,
    query: &str,
    request_id: u64,
) -> Result<Vec<BrowserEntry>, String> {
    let root = Path::new(path_str);
    let normalized_query = query.trim().to_lowercase();

    if !root.exists() {
        return Err(format!("Path does not exist: {path_str}"));
    }

    if !root.is_dir() {
        return Err(format!("Not a directory: {path_str}"));
    }

    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    set_active_local_search_request(request_id);

    let mut pending = vec![root.to_path_buf()];
    let mut matches = Vec::new();

    while let Some(dir_path) = pending.pop() {
        if !is_active_local_search_request(request_id) {
            return Err(LOCAL_SEARCH_CANCELLED_ERROR.to_string());
        }

        let read_dir = match std::fs::read_dir(&dir_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry_result in read_dir {
            if !is_active_local_search_request(request_id) {
                return Err(LOCAL_SEARCH_CANCELLED_ERROR.to_string());
            }

            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };

            let entry_path = entry.path();
            let is_dir = file_type.is_dir();
            if is_dir {
                pending.push(entry_path.clone());
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().contains(&normalized_query) {
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let full_path = entry_path.to_string_lossy().to_string();
            let size = if is_dir { None } else { Some(metadata.len()) };
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            let extension = if is_dir {
                String::new()
            } else {
                entry_path
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                    .unwrap_or_default()
            };
            let previewable = !is_dir && is_previewable(&extension);

            matches.push(BrowserEntry {
                name,
                path: full_path,
                relative_path: relative_parent_path(root, &entry_path),
                is_dir,
                size,
                modified,
                extension,
                previewable,
            });
        }
    }

    if !is_active_local_search_request(request_id) {
        return Err(LOCAL_SEARCH_CANCELLED_ERROR.to_string());
    }

    matches.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => {
            let a_parent = a.relative_path.as_deref().unwrap_or("");
            let b_parent = b.relative_path.as_deref().unwrap_or("");
            a_parent
                .to_lowercase()
                .cmp(&b_parent.to_lowercase())
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        }
    });

    Ok(matches)
}

fn is_previewable(extension: &str) -> bool {
    PREVIEWABLE.contains(&extension)
}

fn is_active_local_search_request(request_id: u64) -> bool {
    ACTIVE_LOCAL_SEARCH_REQUEST_ID.load(Ordering::Relaxed) == request_id
}

fn relative_parent_path(root: &Path, entry_path: &Path) -> Option<String> {
    let parent = entry_path.parent()?;
    let relative = parent.strip_prefix(root).ok()?;
    path_to_relative_string(relative)
}

fn path_to_relative_string(path: &Path) -> Option<String> {
    if path.as_os_str().is_empty() {
        return None;
    }

    Some(
        path.components()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<String>>()
            .join("/"),
    )
}

/// Format a file size into a human-readable string.
pub fn format_size(bytes: u64) -> String {
    const KB: u64 = 1_024;
    const MB: u64 = 1_024 * KB;

    if bytes < KB {
        format!("{bytes} B")
    } else if bytes < MB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_temp_dir_does_not_error() {
        let tmp = std::env::temp_dir().to_string_lossy().to_string();
        // The temp dir always exists — we just check it doesn't panic or error.
        let result = list_directory(&tmp);
        assert!(result.is_ok(), "Expected Ok, got: {result:?}");
    }

    #[test]
    fn list_nonexistent_path_returns_err() {
        let result = list_directory("C:/this/does/not/exist/haas_xyz_test");
        assert!(result.is_err());
    }

    #[test]
    fn recursive_search_finds_nested_folders_and_files_case_insensitively() {
        let root = unique_temp_dir("recursive-search-basic");
        let nested = root.join("Jobs").join("403");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("Part403.NC"), "G0 X0").unwrap();
        std::fs::write(root.join("ignore.txt"), "noop").unwrap();

        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "403", 1).unwrap();
        let paths = results.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>();

        assert_eq!(results.len(), 2);
        assert!(paths.iter().any(|path| path.ends_with("403")));
        assert!(paths.iter().any(|path| path.ends_with("Part403.NC")));

        let file_entry = results
            .iter()
            .find(|entry| entry.name == "Part403.NC")
            .unwrap();
        assert_eq!(file_entry.relative_path.as_deref(), Some("Jobs/403"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recursive_search_stays_scoped_to_requested_root() {
        let base = unique_temp_dir("recursive-search-scope");
        let scoped_root = base.join("scope");
        let outside_root = base.join("outside");
        std::fs::create_dir_all(scoped_root.join("nested")).unwrap();
        std::fs::create_dir_all(&outside_root).unwrap();
        std::fs::write(scoped_root.join("nested").join("match403.nc"), "G0").unwrap();
        std::fs::write(outside_root.join("match403.nc"), "G0").unwrap();

        let results =
            search_directory_recursive(scoped_root.to_string_lossy().as_ref(), "403", 2).unwrap();

        assert_eq!(results.len(), 1);
        assert!(results[0].path.contains("scope"));
        assert!(!results[0].path.contains("outside"));

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn recursive_search_uses_none_relative_path_for_direct_children() {
        let root = unique_temp_dir("recursive-search-direct-child");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("403.nc"), "G0").unwrap();

        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "403", 3).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, None);

        let _ = std::fs::remove_dir_all(root);
    }

    fn unique_temp_dir(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "haas-connect-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn format_size_bytes() {
        assert_eq!(format_size(512), "512 B");
    }

    #[test]
    fn format_size_kb() {
        assert_eq!(format_size(2048), "2.0 KB");
    }

    #[test]
    fn format_size_mb() {
        assert_eq!(format_size(1_572_864), "1.5 MB");
    }

    #[test]
    fn is_previewable_nc() {
        assert!(is_previewable(".nc"));
        assert!(is_previewable(".tap"));
        assert!(is_previewable(".pdf"));
        assert!(is_previewable(".txt"));
    }

    #[test]
    fn is_previewable_image_is_false() {
        assert!(!is_previewable(".jpg"));
        assert!(!is_previewable(".png"));
        assert!(!is_previewable(".exe"));
    }
}
