use std::ffi::OsStr;
use std::path::{Component, Path};

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedPath {
    prefix: String,
    segments: Vec<String>,
}

pub fn normalize_machine_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut normalized = trimmed.replace('/', "\\");

    if let Some(stripped) = normalized.strip_prefix(r"\\?\UNC\") {
        normalized = format!(r"\\{stripped}");
    } else if let Some(stripped) = normalized.strip_prefix(r"\??\UNC\") {
        normalized = format!(r"\\{stripped}");
    } else if let Some(stripped) = normalized.strip_prefix(r"\\?\") {
        normalized = stripped.to_string();
    } else if let Some(stripped) = normalized.strip_prefix(r"\??\") {
        normalized = stripped.to_string();
    }

    if has_drive_prefix(&normalized) && !has_root_after_drive(&normalized) {
        normalized.insert(2, '\\');
    }

    if normalized.starts_with('\\') && !normalized.starts_with(r"\\") {
        normalized.insert(0, '\\');
    }

    if normalized.starts_with(r"\\") {
        let without_leading = normalized.trim_start_matches('\\');
        normalized = format!(r"\\{}", without_leading);
    }

    while normalized.ends_with('\\') && !is_windows_root_path(&normalized) {
        normalized.pop();
    }

    normalized
}

pub fn path_is_within_root(root: &str, target: &Path) -> Result<bool, String> {
    let normalized_root = normalize_absolute_path(Path::new(root))?;
    let normalized_target = normalize_absolute_path(target)?;

    if normalized_root.prefix != normalized_target.prefix {
        return Ok(false);
    }

    if normalized_target.segments.len() < normalized_root.segments.len() {
        return Ok(false);
    }

    Ok(normalized_target
        .segments
        .iter()
        .zip(normalized_root.segments.iter())
        .all(|(target_part, root_part)| target_part == root_part))
}

pub fn paths_refer_to_same_location(left: &str, right: &Path) -> Result<bool, String> {
    let normalized_left = normalize_absolute_path(Path::new(left))?;
    let normalized_right = normalize_absolute_path(right)?;
    Ok(normalized_left == normalized_right)
}

fn normalize_absolute_path(path: &Path) -> Result<NormalizedPath, String> {
    let normalized_input = normalize_machine_path(&path.to_string_lossy());
    let normalized_path = Path::new(&normalized_input);

    if !normalized_path.is_absolute() {
        return Err(format!("Path must be absolute: {}", normalized_input));
    }

    let mut prefix: Option<String> = None;
    let mut has_root = false;
    let mut segments: Vec<String> = Vec::new();

    for component in normalized_path.components() {
        match component {
            Component::Prefix(value) => {
                prefix = Some(normalize_component(value.as_os_str()));
            }
            Component::RootDir => {
                has_root = true;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if segments.pop().is_none() {
                    return Err(format!("Path escapes its root: {}", normalized_input));
                }
            }
            Component::Normal(value) => {
                segments.push(normalize_component(value));
            }
        }
    }

    let prefix = prefix.ok_or_else(|| {
        format!(
            "Path must include a drive letter or network share: {}",
            normalized_input
        )
    })?;

    if !has_root {
        return Err(format!(
            "Path must include a root separator: {}",
            normalized_input
        ));
    }

    Ok(NormalizedPath { prefix, segments })
}

fn has_drive_prefix(path: &str) -> bool {
    path.len() >= 2
        && path.as_bytes()[1] == b':'
        && path
            .chars()
            .next()
            .map(|ch| ch.is_ascii_alphabetic())
            .unwrap_or(false)
}

fn has_root_after_drive(path: &str) -> bool {
    matches!(path.as_bytes().get(2), Some(b'\\'))
}

fn is_windows_root_path(path: &str) -> bool {
    if has_drive_prefix(path) && path.len() == 3 && path.ends_with('\\') {
        return true;
    }

    if !path.starts_with(r"\\") {
        return false;
    }

    let segments = path
        .trim_start_matches('\\')
        .split('\\')
        .filter(|segment| !segment.is_empty())
        .count();

    segments <= 2
}

fn normalize_component(value: &OsStr) -> String {
    value
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{normalize_machine_path, path_is_within_root, paths_refer_to_same_location};
    use std::path::Path;

    #[test]
    fn accepts_mapped_drive_paths_with_mixed_separators() {
        let root = r"Z:\jobs";
        let target = Path::new(r"Z:/jobs/sub/program.nc");

        assert!(path_is_within_root(root, target).unwrap());
    }

    #[test]
    fn accepts_unc_paths_with_mixed_separators() {
        let root = r"\\server\share\jobs";
        let target = Path::new(r"//server/share/jobs/sub/program.nc");

        assert!(path_is_within_root(root, target).unwrap());
    }

    #[test]
    fn rejects_path_outside_root() {
        let root = r"Z:\jobs";
        let target = Path::new(r"Z:\other\program.nc");

        assert!(!path_is_within_root(root, target).unwrap());
    }

    #[test]
    fn rejects_cross_share_unc_path() {
        let root = r"\\server\share\jobs";
        let target = Path::new(r"\\server\other-share\jobs\program.nc");

        assert!(!path_is_within_root(root, target).unwrap());
    }

    #[test]
    fn compares_paths_case_insensitively() {
        let left = r"z:\JOBS\Parts";
        let right = Path::new(r"Z:/jobs/parts");

        assert!(paths_refer_to_same_location(left, right).unwrap());
    }

    #[test]
    fn normalizes_drive_root_without_separator() {
        assert_eq!(normalize_machine_path("Z:"), r"Z:\");
    }

    #[test]
    fn normalizes_drive_relative_child_to_rooted_path() {
        assert_eq!(
            normalize_machine_path(r"Z:jobs\part.nc"),
            r"Z:\jobs\part.nc"
        );
    }

    #[test]
    fn normalizes_verbatim_unc_path() {
        assert_eq!(
            normalize_machine_path(r"\\?\UNC\server\share\jobs\part.nc"),
            r"\\server\share\jobs\part.nc"
        );
    }

    #[test]
    fn accepts_drive_relative_mapped_paths_after_normalization() {
        let root = "Z:";
        let target = Path::new(r"Z:jobs\program.nc");

        assert!(path_is_within_root(root, target).unwrap());
    }

    #[test]
    fn accepts_verbatim_unc_path_as_same_share() {
        let root = r"\\server\share";
        let target = Path::new(r"\\?\UNC\server\share\jobs\program.nc");

        assert!(path_is_within_root(root, target).unwrap());
    }
}
