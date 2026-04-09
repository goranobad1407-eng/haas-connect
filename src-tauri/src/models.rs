use serde::{Deserialize, Serialize};

/// Where a machine/location lives physically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocationType {
    Local,
    NetworkShare,
    Usb,
}

/// A configured machine or location the operator can browse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineProfile {
    pub id: String,
    pub name: String,
    /// Filesystem path: drive letter ("Z:/"), UNC ("\\\\server\\share"), or local dir.
    pub path: String,
    pub location_type: LocationType,
    /// File extensions this machine/location is expected to hold.
    pub allowed_extensions: Vec<String>,
    /// If true, delete operations are blocked for this location.
    pub protected: bool,
    pub notes: String,
}

/// Normalized machine profile validation result returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineProfilesValidation {
    pub profiles: Vec<MachineProfile>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Current reachability state of a machine path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityStatus {
    /// Not yet checked.
    Unknown,
    /// Check is in progress.
    Checking,
    /// Path is accessible.
    Online,
    /// Path exists in OS but returned an error (permissions, etc.).
    Offline,
    /// Availability check exceeded the configured timeout.
    Timeout,
    /// An unexpected error occurred during the check.
    Error,
}

/// One entry in a directory listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserEntry {
    pub name: String,
    /// Full absolute path.
    pub path: String,
    /// Parent path relative to the current search root. None for direct children.
    #[serde(default)]
    pub relative_path: Option<String>,
    pub is_dir: bool,
    /// File size in bytes; None for directories.
    pub size: Option<u64>,
    /// Last-modified as Unix timestamp (seconds); None if unavailable.
    pub modified: Option<u64>,
    /// Lowercase extension including dot, e.g. ".nc". Empty string for dirs or no ext.
    pub extension: String,
    /// Whether the app can show inline preview content for this file.
    pub previewable: bool,
}

/// Kind of preview content returned for a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewKind {
    GcodeText,
    PlainText,
    Pdf,
    Directory,
    Unsupported,
}

/// Preview data returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewData {
    pub kind: PreviewKind,
    pub title: String,
    /// Raw text excerpt (for text/gcode kinds).
    pub content: Option<String>,
    /// Human-readable summary: line count, axis ranges, G/M codes, page count…
    pub metadata: Option<String>,
    /// File size in bytes.
    pub size: Option<u64>,
    /// Non-fatal read error description.
    pub error: Option<String>,
}

/// G-code analysis result, embedded in PreviewData.metadata as formatted string.
#[derive(Debug, Default)]
pub struct GcodeAnalysis {
    pub line_count: u32,
    pub g_codes: Vec<u32>,
    pub m_codes: Vec<u32>,
    pub x_range: Option<(f64, f64)>,
    pub y_range: Option<(f64, f64)>,
    pub z_range: Option<(f64, f64)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferFileStatus {
    Success,
    OverwriteRequired,
    InvalidSource,
    InvalidExtension,
    InvalidDestination,
    DestinationOffline,
    CopyFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferFileResult {
    pub status: TransferFileStatus,
    pub source_path: String,
    pub destination_dir: String,
    pub destination_path: Option<String>,
    pub file_name: String,
    pub is_directory: bool,
    pub message: String,
}

/// Full application config stored in machines.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub machines: Vec<MachineProfile>,
    /// How long (seconds) to wait for a path availability check.
    pub check_timeout_secs: u64,
    /// Maximum bytes read from a file for inline preview.
    pub preview_max_bytes: u64,
    /// Default local folder auto-loaded on startup. None = not configured.
    #[serde(default)]
    pub default_local_path: Option<String>,
    /// UI language: "en" (English) or "hr" (Croatian). Defaults to "hr".
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_language() -> String {
    "hr".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            version: "2.0".to_string(),
            machines: Vec::new(),
            check_timeout_secs: 3,
            preview_max_bytes: 51_200,
            default_local_path: None,
            language: "hr".to_string(),
        }
    }
}
