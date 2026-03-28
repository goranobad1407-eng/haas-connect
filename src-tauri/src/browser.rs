use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::models::BrowserEntry;

/// Previewable extensions — files the app can show inline content for.
const PREVIEWABLE: &[&str] = &[".nc", ".tap", ".cnc", ".txt", ".pdf"];

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

fn is_previewable(extension: &str) -> bool {
    PREVIEWABLE.contains(&extension)
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
