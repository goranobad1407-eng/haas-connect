use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::models::{AppConfig, LocationType, MachineProfile, MachineProfilesValidation};

const CONFIG_FILENAME: &str = "machines.json";
const LEGACY_FILENAME: &str = "config.json";
const APP_CONFIG_DIRNAME: &str = "HAAS CNC Connect";

/// Legacy format written by the Python/PySide6 app.
#[derive(Deserialize)]
struct LegacyConfig {
    paths: Vec<String>,
    custom_names: Option<HashMap<String, String>>,
}

/// Search order for the config file:
/// 1. machines.json next to the executable or in the current working directory,
///    but only outside Program Files (portable/dev override)
/// 2. config.json in those same local locations (legacy)
/// 3. machines.json in the user's Local AppData folder
/// 4. config.json in the user's Local AppData folder (legacy)
pub fn find_config_path() -> Option<PathBuf> {
    config_search_candidates().into_iter().find(|p| p.exists())
}

/// Default write path:
/// - portable/dev: keep writing to a local machines.json if one already exists
/// - installed app: write to Local AppData so Program Files stays read-only
pub fn default_config_write_path() -> PathBuf {
    if let Some(existing) = find_config_path() {
        if is_local_v2_config_path(&existing) {
            return existing;
        }
    }

    local_app_config_path().unwrap_or_else(|| PathBuf::from(CONFIG_FILENAME))
}

/// Load config from disk. Returns default config (empty machine list) on any
/// failure so the app always starts cleanly.
pub fn load_config() -> AppConfig {
    let path = match find_config_path() {
        Some(p) => p,
        None => return AppConfig::default(),
    };

    load_config_from_path(&path)
}

fn load_config_from_path(path: &Path) -> AppConfig {
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return AppConfig::default(),
    };

    // Try the v2 format first.
    if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
        return config;
    }

    // Fall back to the legacy Python app format.
    if let Ok(legacy) = serde_json::from_str::<LegacyConfig>(&content) {
        return migrate_legacy(legacy);
    }

    // Unrecognised format — return default rather than crashing.
    AppConfig::default()
}

pub fn load_machine_profiles() -> Vec<MachineProfile> {
    normalize_machine_profiles(&load_config().machines)
}

pub fn save_config(config: &AppConfig, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory '{}': {e}", parent.display()))?;
    }
    let json =
        serde_json::to_string_pretty(config).map_err(|e| format!("Serialisation error: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Write error: {e}"))
}

fn config_search_candidates() -> Vec<PathBuf> {
    let mut candidates = local_config_candidates();

    if let Some(app_dir) = local_app_config_dir() {
        candidates.push(app_dir.join(CONFIG_FILENAME));
        candidates.push(app_dir.join(LEGACY_FILENAME));
    }

    candidates
}

fn local_config_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            push_local_candidates(&mut candidates, exe_dir);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        push_local_candidates(&mut candidates, &cwd);
    }

    candidates
}

fn push_local_candidates(candidates: &mut Vec<PathBuf>, dir: &Path) {
    if is_under_program_files(dir) {
        return;
    }

    let machine_path = dir.join(CONFIG_FILENAME);
    let legacy_path = dir.join(LEGACY_FILENAME);

    if !candidates.iter().any(|candidate| candidate == &machine_path) {
        candidates.push(machine_path);
    }
    if !candidates.iter().any(|candidate| candidate == &legacy_path) {
        candidates.push(legacy_path);
    }
}

fn local_app_config_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join(APP_CONFIG_DIRNAME))
}

fn local_app_config_path() -> Option<PathBuf> {
    local_app_config_dir().map(|dir| dir.join(CONFIG_FILENAME))
}

fn is_local_v2_config_path(path: &Path) -> bool {
    local_config_candidates()
        .into_iter()
        .any(|candidate| candidate == path && candidate.file_name() == Some(OsStr::new(CONFIG_FILENAME)))
}

fn is_under_program_files(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let roots = [
            std::env::var_os("ProgramFiles"),
            std::env::var_os("ProgramFiles(x86)"),
            std::env::var_os("ProgramW6432"),
        ];

        return roots
            .into_iter()
            .flatten()
            .map(PathBuf::from)
            .any(|root| path_starts_with_case_insensitive(path, &root));
    }

    #[allow(unreachable_code)]
    false
}

fn path_starts_with_case_insensitive(path: &Path, root: &Path) -> bool {
    let path = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    let root = root
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();

    path == root || path.starts_with(&format!("{root}\\"))
}

pub fn validate_machine_profiles(profiles: &[MachineProfile]) -> MachineProfilesValidation {
    let normalized_profiles = normalize_machine_profiles(profiles);
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if normalized_profiles.is_empty() {
        warnings.push("No machines configured. Add a machine before browsing files.".into());
    }

    let mut ids_seen = HashSet::new();
    let mut names_seen = HashSet::new();

    for (index, (raw_machine, machine)) in profiles
        .iter()
        .zip(normalized_profiles.iter())
        .enumerate()
    {
        let entry_label = format!("Entry {}", index + 1);
        let machine_label = if machine.name.is_empty() {
            entry_label.clone()
        } else {
            format!("{entry_label} ('{}')", machine.name)
        };

        if machine.id.is_empty() {
            errors.push(format!("{entry_label}: machine id is required."));
        } else if !ids_seen.insert(machine.id.to_ascii_lowercase()) {
            errors.push(format!("Duplicate machine id '{}'.", machine.id));
        }

        if machine.name.is_empty() {
            errors.push(format!("{entry_label}: machine name is required."));
        } else if !names_seen.insert(machine.name.to_ascii_lowercase()) {
            errors.push(format!("Duplicate machine name '{}'.", machine.name));
        }

        if machine.path.is_empty() {
            errors.push(format!(
                "{}: machine path is required{}",
                entry_label,
                if machine.name.is_empty() {
                    ".".to_string()
                } else {
                    format!(" for '{}'.", machine.name)
                }
            ));
        } else {
            match machine.location_type {
                LocationType::Local => {
                    if is_unc_path(&machine.path) {
                        errors.push(format!(
                            "{}: local machine path cannot use a UNC network path.",
                            machine_label
                        ));
                    }
                }
                LocationType::NetworkShare => {
                    if is_unc_path(&machine.path) && !is_valid_unc_path(&machine.path) {
                        errors.push(format!(
                            "{}: network share path must use valid UNC format like \\\\server\\share.",
                            machine_label
                        ));
                    }
                }
                LocationType::Usb => {}
            }
        }

        for extension in &raw_machine.allowed_extensions {
            let trimmed = extension.trim();
            if trimmed.is_empty() {
                continue;
            }

            let candidate = trimmed.trim_start_matches('.');
            if candidate.is_empty()
                || !candidate
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric())
            {
                errors.push(format!(
                    "{}: invalid extension '{}'. Use values like .nc or .tap.",
                    machine_label, trimmed
                ));
            }
        }
    }

    MachineProfilesValidation {
        profiles: normalized_profiles,
        errors,
        warnings,
    }
}

pub fn save_machine_profiles(
    profiles: Vec<MachineProfile>,
    confirmed_protected_removals: &[String],
    path: &Path,
) -> Result<(AppConfig, Vec<String>), String> {
    let existing = if path.exists() {
        load_config_from_path(path)
    } else {
        load_config()
    };
    let validation = validate_machine_profiles(&profiles);

    if !validation.errors.is_empty() {
        return Err(validation.errors.join("\n"));
    }

    let confirmed: HashSet<String> = confirmed_protected_removals
        .iter()
        .map(|id| id.trim().to_ascii_lowercase())
        .collect();
    let next_ids: HashSet<String> = validation
        .profiles
        .iter()
        .map(|machine| machine.id.to_ascii_lowercase())
        .collect();

    let blocked_removals: Vec<String> = existing
        .machines
        .iter()
        .filter(|machine| {
            machine.protected
                && !next_ids.contains(&machine.id.to_ascii_lowercase())
                && !confirmed.contains(&machine.id.to_ascii_lowercase())
        })
        .map(|machine| format!("{} ({})", machine.name, machine.id))
        .collect();

    if !blocked_removals.is_empty() {
        return Err(format!(
            "Protected machines require confirmation before removal: {}",
            blocked_removals.join(", ")
        ));
    }

    let mut updated = existing;
    updated.machines = validation.profiles;
    save_config(&updated, path)?;
    Ok((updated, validation.warnings))
}

/// Convert old Python-app config into the new format. Preserves paths and
/// custom names; guesses location type from the path string.
fn migrate_legacy(legacy: LegacyConfig) -> AppConfig {
    let machines = legacy
        .paths
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let name = legacy
                .custom_names
                .as_ref()
                .and_then(|m| m.get(path))
                .cloned()
                .unwrap_or_else(|| format!("Machine {}", i + 1));

            let location_type = guess_location_type(path);

            MachineProfile {
                id: format!("machine-{}", i + 1),
                name,
                path: path.clone(),
                location_type,
                allowed_extensions: vec![".nc".into(), ".tap".into(), ".txt".into(), ".pdf".into()],
                protected: false,
                notes: String::new(),
            }
        })
        .collect();

    AppConfig {
        version: "2.0".into(),
        machines,
        check_timeout_secs: 3,
        preview_max_bytes: 51_200,
        default_local_path: None,
        language: "hr".to_string(),
    }
}

fn guess_location_type(path: &str) -> LocationType {
    if path.starts_with("\\\\") || path.starts_with("//") {
        LocationType::NetworkShare
    } else {
        // Drive letter paths (Z:/ etc.) are treated as network shares because
        // in CNC shops they are almost always mapped network drives.
        LocationType::NetworkShare
    }
}

pub fn normalize_machine_profiles(profiles: &[MachineProfile]) -> Vec<MachineProfile> {
    profiles
        .iter()
        .cloned()
        .map(normalize_machine_profile)
        .collect()
}

fn normalize_machine_profile(mut profile: MachineProfile) -> MachineProfile {
    profile.id = profile.id.trim().to_string();
    profile.name = profile.name.trim().to_string();
    profile.path = profile.path.trim().to_string();
    profile.notes = profile.notes.trim().to_string();
    profile.allowed_extensions = normalize_allowed_extensions(&profile.allowed_extensions);
    profile
}

fn normalize_allowed_extensions(extensions: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();

    for ext in extensions {
        let trimmed = ext.trim().trim_start_matches('.').to_ascii_lowercase();
        if trimmed.is_empty() {
            continue;
        }

        let value = format!(".{trimmed}");
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }

    normalized
}

fn is_unc_path(path: &str) -> bool {
    path.starts_with("\\\\") || path.starts_with("//")
}

fn is_valid_unc_path(path: &str) -> bool {
    let trimmed = path.trim_start_matches('\\').trim_start_matches('/');
    let mut parts = trimmed
        .split(['\\', '/'])
        .filter(|segment| !segment.is_empty());

    matches!((parts.next(), parts.next()), (Some(_server), Some(_share)))
}

/// Validate a config for obvious problems. Returns a list of warning strings
/// (not errors — the app keeps running with a bad entry).
pub fn validate_config(config: &AppConfig) -> Vec<String> {
    let validation = validate_machine_profiles(&config.machines);
    let mut warnings = validation.warnings;
    warnings.extend(validation.errors);
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_empty_legacy() {
        let legacy = LegacyConfig {
            paths: vec![],
            custom_names: None,
        };
        let config = migrate_legacy(legacy);
        assert_eq!(config.version, "2.0");
        assert!(config.machines.is_empty());
        assert_eq!(config.language, "hr");
    }

    #[test]
    fn migrate_legacy_preserves_custom_names() {
        let mut names = HashMap::new();
        names.insert("Z:/".to_string(), "HAAS 1".to_string());

        let legacy = LegacyConfig {
            paths: vec!["Z:/".into(), "C:/CNC".into()],
            custom_names: Some(names),
        };
        let config = migrate_legacy(legacy);

        assert_eq!(config.machines.len(), 2);
        assert_eq!(config.machines[0].name, "HAAS 1");
        assert_eq!(config.machines[1].name, "Machine 2");
    }

    #[test]
    fn migrate_legacy_assigns_network_share_type() {
        let legacy = LegacyConfig {
            paths: vec!["Z:/".into()],
            custom_names: None,
        };
        let config = migrate_legacy(legacy);
        assert_eq!(config.machines[0].location_type, LocationType::NetworkShare);
    }

    #[test]
    fn validate_catches_empty_machine_list() {
        let config = AppConfig::default();
        assert_eq!(config.language, "hr");
        let warnings = validate_config(&config);
        assert!(!warnings.is_empty());
    }

    #[test]
    fn validate_catches_duplicate_ids() {
        let mut config = AppConfig::default();
        config.machines.push(MachineProfile {
            id: "dup".into(),
            name: "A".into(),
            path: "Z:/".into(),
            location_type: LocationType::NetworkShare,
            allowed_extensions: vec![],
            protected: false,
            notes: String::new(),
        });
        config.machines.push(MachineProfile {
            id: "dup".into(),
            name: "B".into(),
            path: "Y:/".into(),
            location_type: LocationType::NetworkShare,
            allowed_extensions: vec![],
            protected: false,
            notes: String::new(),
        });
        let warnings = validate_config(&config);
        assert!(warnings.iter().any(|w| w.contains("Duplicate")));
    }

    #[test]
    fn validate_normalizes_allowed_extensions() {
        let validation = validate_machine_profiles(&[MachineProfile {
            id: "haas-1".into(),
            name: "HAAS 1".into(),
            path: "Z:/".into(),
            location_type: LocationType::NetworkShare,
            allowed_extensions: vec!["NC".into(), ".tap".into(), " tap ".into(), "".into()],
            protected: false,
            notes: String::new(),
        }]);

        assert!(validation.errors.is_empty());
        assert_eq!(
            validation.profiles[0].allowed_extensions,
            vec![".nc", ".tap"]
        );
    }

    #[test]
    fn validate_catches_duplicate_names() {
        let validation = validate_machine_profiles(&[
            MachineProfile {
                id: "haas-1".into(),
                name: "HAAS 1".into(),
                path: "Z:/".into(),
                location_type: LocationType::NetworkShare,
                allowed_extensions: vec![],
                protected: false,
                notes: String::new(),
            },
            MachineProfile {
                id: "haas-2".into(),
                name: " haas 1 ".into(),
                path: "Y:/".into(),
                location_type: LocationType::NetworkShare,
                allowed_extensions: vec![],
                protected: false,
                notes: String::new(),
            },
        ]);

        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("Duplicate machine name")));
    }

    #[test]
    fn validate_rejects_local_unc_mismatch() {
        let validation = validate_machine_profiles(&[MachineProfile {
            id: "haas-1".into(),
            name: "HAAS 1".into(),
            path: "\\\\server\\share".into(),
            location_type: LocationType::Local,
            allowed_extensions: vec![".nc".into()],
            protected: false,
            notes: String::new(),
        }]);

        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("local machine path cannot use a UNC")));
    }

    #[test]
    fn validate_rejects_non_unc_network_share_path() {
        let validation = validate_machine_profiles(&[MachineProfile {
            id: "haas-1".into(),
            name: "HAAS 1".into(),
            path: "\\\\server".into(),
            location_type: LocationType::NetworkShare,
            allowed_extensions: vec![".nc".into()],
            protected: false,
            notes: String::new(),
        }]);

        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("network share path must use valid UNC")));
    }

    #[test]
    fn validate_rejects_invalid_extension_tokens() {
        let validation = validate_machine_profiles(&[MachineProfile {
            id: "haas-1".into(),
            name: "HAAS 1".into(),
            path: "\\\\server\\share".into(),
            location_type: LocationType::NetworkShare,
            allowed_extensions: vec![".n/c".into()],
            protected: false,
            notes: String::new(),
        }]);

        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("invalid extension")));
    }

    #[test]
    fn save_blocks_unconfirmed_protected_removal() {
        let file_name = format!(
            "haas-connect-test-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(file_name);

        let config = AppConfig {
            version: "2.0".into(),
            machines: vec![MachineProfile {
                id: "protected-machine".into(),
                name: "Protected".into(),
                path: "Z:/".into(),
                location_type: LocationType::NetworkShare,
                allowed_extensions: vec![".nc".into()],
                protected: true,
                notes: String::new(),
            }],
            check_timeout_secs: 3,
            preview_max_bytes: 51_200,
            default_local_path: None,
            language: "hr".to_string(),
        };

        save_config(&config, &path).unwrap();

        let result = save_machine_profiles(Vec::new(), &[], &path);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Protected machines require confirmation"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn save_machine_profiles_persists_normalized_values() {
        let file_name = format!(
            "haas-connect-test-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(file_name);

        save_config(&AppConfig::default(), &path).unwrap();

        let (saved, warnings) = save_machine_profiles(
            vec![MachineProfile {
                id: " haas-1 ".into(),
                name: " HAAS 1 ".into(),
                path: " Z:/Programs ".into(),
                location_type: LocationType::NetworkShare,
                allowed_extensions: vec!["NC".into(), ".pdf".into()],
                protected: false,
                notes: " Main machine ".into(),
            }],
            &[],
            &path,
        )
        .unwrap();

        assert!(warnings.is_empty());
        assert_eq!(saved.machines[0].id, "haas-1");
        assert_eq!(saved.machines[0].name, "HAAS 1");
        assert_eq!(saved.machines[0].path, "Z:/Programs");
        assert_eq!(saved.machines[0].allowed_extensions, vec![".nc", ".pdf"]);
        assert_eq!(saved.machines[0].notes, "Main machine");

        let loaded =
            serde_json::from_str::<AppConfig>(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(loaded.machines[0].id, "haas-1");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn save_config_creates_missing_parent_directory() {
        let root = std::env::temp_dir().join(format!(
            "haas-connect-config-dir-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let nested = root.join("nested").join(CONFIG_FILENAME);

        save_config(&AppConfig::default(), &nested).unwrap();

        assert!(nested.exists());

        let _ = std::fs::remove_file(&nested);
        let _ = std::fs::remove_dir_all(root);
    }
}
