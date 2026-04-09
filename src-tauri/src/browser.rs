use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use crate::models::BrowserEntry;
use crate::path_guard::normalize_machine_path;

/// Previewable extensions — files the app can show inline content for.
const PREVIEWABLE: &[&str] = &[".nc", ".tap", ".cnc", ".txt", ".pdf"];
pub const LOCAL_SEARCH_CANCELLED_ERROR: &str = "__local_search_cancelled__";
static ACTIVE_LOCAL_SEARCH_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// Maximum number of search results to return to prevent UI freeze.
const MAX_SEARCH_RESULTS: usize = 500;

/// List the immediate children of `path`. Non-recursive.
///
/// Rules:
/// - Returns Err if the path does not exist or is not a directory.
/// - Skips individual entries that cannot be read (permissions, broken links).
/// - Sorts: directories first, then files — both groups alphabetical.
/// - Does NOT recurse. One level only.
pub fn list_directory(path_str: &str) -> Result<Vec<BrowserEntry>, String> {
    let normalized_path = normalize_machine_path(path_str);
    let path = Path::new(&normalized_path);

    if !path.exists() {
        return Err(format!("Path does not exist: {normalized_path}"));
    }

    if !path.is_dir() {
        return Err(format!("Not a directory: {normalized_path}"));
    }

    let read_dir = std::fs::read_dir(path)
        .map_err(|e| format!("Cannot read directory '{normalized_path}': {e}"))?;

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
        let full_path = normalize_machine_path(&entry.path().to_string_lossy());
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
    let mut matches = Vec::with_capacity(MAX_SEARCH_RESULTS);
    let mut total_scanned = 0usize;
    let mut capped = false;

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

            // Queue directories for traversal BEFORE checking if this entry matches.
            // This ensures we search the entire tree even if a folder's name doesn't match.
            if is_dir {
                pending.push(entry_path.clone());
            }

            let name = entry.file_name().to_string_lossy().to_string();
            total_scanned += 1;

            // Check if entry name matches query (case-insensitive substring)
            if !name.to_lowercase().contains(&normalized_query) {
                continue;
            }

            // Respect result cap to keep UI responsive
            if matches.len() >= MAX_SEARCH_RESULTS {
                capped = true;
                continue; // Keep scanning to get accurate total, but don't collect more
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
                name: name.clone(),
                path: full_path,
                relative_path: relative_entry_path(root, &entry_path, is_dir),
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

    // Sort: folders first, then files; within each group, by relative path then name
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

    // Store capped flag and total in thread-local or return via extension?
    // For now, log it; UI can infer from result count == MAX_SEARCH_RESULTS
    if capped {
        eprintln!(
            "search_directory_recursive: capped at {} results (scanned {} entries)",
            MAX_SEARCH_RESULTS, total_scanned
        );
    }

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

/// Compute the relative path for a search result entry.
/// For folders: returns the path to the folder itself (so user can navigate there).
/// For files: returns the parent directory path (same as before).
fn relative_entry_path(root: &Path, entry_path: &Path, is_dir: bool) -> Option<String> {
    if is_dir {
        // For folders, show path to the folder itself
        let relative = entry_path.strip_prefix(root).ok()?;
        path_to_relative_string(relative)
    } else {
        // For files, show parent path (existing behavior)
        relative_parent_path(root, entry_path)
    }
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
    use std::sync::{Mutex, MutexGuard};

    static SEARCH_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn search_test_guard() -> MutexGuard<'static, ()> {
        SEARCH_TEST_LOCK.lock().unwrap()
    }

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
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-basic");
        let nested = root.join("Jobs").join("403");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("Part403.NC"), "G0 X0").unwrap();
        std::fs::write(root.join("ignore.txt"), "noop").unwrap();

        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "403", 1).unwrap();
        let paths = results
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();

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
        let _guard = search_test_guard();

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
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-direct-child");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("403.nc"), "G0").unwrap();

        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "403", 3).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recursive_search_returns_folders_with_correct_is_dir_flag() {
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-folder-flag");
        std::fs::create_dir_all(&root).unwrap();
        let nested = root.join("CNC_Programs").join("2024");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("part.nc"), "G0 X0").unwrap();

        // Search for "2024" - should find the folder
        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "2024", 1).unwrap();

        let folder_entry = results.iter().find(|e| e.name == "2024");
        assert!(
            folder_entry.is_some(),
            "Should find folder named '2024', got: {:?}",
            results
        );
        let folder = folder_entry.unwrap();
        assert!(folder.is_dir, "Folder entry should have is_dir=true");
        assert_eq!(folder.size, None, "Folders should have size=None");
        assert_eq!(
            folder.relative_path.as_deref(),
            Some("CNC_Programs/2024"),
            "Folder relative_path should point to the folder itself"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recursive_search_finds_both_files_and_folders() {
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-mixed");
        // Create structure: root/ProjectA/Jobs/job1.nc
        let jobs = root.join("ProjectA").join("Jobs");
        std::fs::create_dir_all(&jobs).unwrap();
        std::fs::write(jobs.join("job1.nc"), "G0").unwrap();
        std::fs::write(root.join("ProjectA").join("readme.txt"), "docs").unwrap();

        // Search for "ProjectA" - should find the folder
        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "ProjectA", 1).unwrap();

        let folder_match = results.iter().find(|e| e.name == "ProjectA" && e.is_dir);
        assert!(folder_match.is_some(), "Should find folder 'ProjectA'");

        // Search for "job" - should find job1.nc file
        let results2 =
            search_directory_recursive(root.to_string_lossy().as_ref(), "job", 2).unwrap();
        let file_match = results2.iter().find(|e| e.name == "job1.nc" && !e.is_dir);
        assert!(file_match.is_some(), "Should find file 'job1.nc'");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recursive_search_folders_appear_first_in_results() {
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-order");
        // Create folder and file with same search term
        let folder = root.join("Alpha");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(root.join("Alpha.txt"), "test").unwrap();
        std::fs::write(folder.join("content.nc"), "G0").unwrap();

        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "alpha", 1).unwrap();

        assert_eq!(results.len(), 2);
        // Folders should come first
        assert!(results[0].is_dir, "First result should be a folder");
        assert!(!results[1].is_dir, "Second result should be a file");
        assert_eq!(results[0].name, "Alpha");
        assert_eq!(results[1].name, "Alpha.txt");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recursive_search_is_case_insensitive() {
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-case");
        std::fs::create_dir_all(root.join("UPPERCASE")).unwrap();
        std::fs::write(root.join("MiXeD.CaSe.NC"), "G0").unwrap();
        std::fs::write(root.join("lowercase.nc"), "G0").unwrap();

        // Search with lowercase query - should find all variations
        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "case", 1).unwrap();
        let names: Vec<&str> = results.iter().map(|e| e.name.as_str()).collect();
        assert!(
            names.contains(&"MiXeD.CaSe.NC"),
            "Should find mixed case file"
        );

        // Search with uppercase query
        let results2 =
            search_directory_recursive(root.to_string_lossy().as_ref(), "UPPERCASE", 2).unwrap();
        assert!(
            results2.iter().any(|e| e.name == "UPPERCASE" && e.is_dir),
            "Should find uppercase folder"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recursive_search_respects_max_results_limit() {
        let _guard = search_test_guard();

        let root = unique_temp_dir("recursive-search-limit");
        std::fs::create_dir_all(&root).unwrap();
        // Create more than MAX_SEARCH_RESULTS files with same pattern
        // Use fewer extra files on Windows to avoid path length issues
        let extra_files = 50usize;
        for i in 0..MAX_SEARCH_RESULTS + extra_files {
            let filename = format!("part{:04}.nc", i);
            let filepath = root.join(&filename);
            std::fs::write(&filepath, "G0").unwrap();
        }

        let results =
            search_directory_recursive(root.to_string_lossy().as_ref(), "part", 1).unwrap();

        assert_eq!(
            results.len(),
            MAX_SEARCH_RESULTS,
            "Should cap results at MAX_SEARCH_RESULTS (expected {}, got {})",
            MAX_SEARCH_RESULTS,
            results.len()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    // Note: Cancellation is tested implicitly by the token-based invalidation in the frontend.
    // The backend cancellation mechanism uses an atomic that gets reset on each search call,
    // making it difficult to test in a single-threaded context without race conditions.

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
