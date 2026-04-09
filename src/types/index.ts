// TypeScript types matching Rust models.
// All names use snake_case to match serde serialisation from the backend.

export type LocationType = "local" | "network_share" | "usb";

export type Language = "en" | "hr";

export type AvailabilityStatus =
  | "unknown"
  | "checking"
  | "online"
  | "offline"
  | "timeout"
  | "error";

export type PreviewKind =
  | "gcode_text"
  | "plain_text"
  | "pdf"
  | "directory"
  | "unsupported";

export interface MachineProfile {
  id: string;
  name: string;
  path: string;
  location_type: LocationType;
  allowed_extensions: string[];
  protected: boolean;
  notes: string;
}

export interface MachineProfilesValidation {
  profiles: MachineProfile[];
  errors: string[];
  warnings: string[];
}

export interface AppConfig {
  version: string;
  machines: MachineProfile[];
  check_timeout_secs: number;
  preview_max_bytes: number;
  default_local_path: string | null;
  language: string;
}

export interface BrowserEntry {
  name: string;
  path: string;
  relative_path: string | null;
  is_dir: boolean;
  size: number | null;
  modified: number | null; // Unix timestamp in seconds
  extension: string;
  previewable: boolean;
}

export interface PreviewData {
  kind: PreviewKind;
  title: string;
  content: string | null;
  metadata: string | null;
  size: number | null;
  error: string | null;
}

export type PaneKind = "machine" | "local";

export interface ActivePaneSelection {
  pane: PaneKind;
  entry: BrowserEntry;
}

export type TransferFileStatus =
  | "success"
  | "overwrite_required"
  | "invalid_source"
  | "invalid_extension"
  | "invalid_destination"
  | "destination_offline"
  | "copy_failed";

export interface TransferFileResult {
  status: TransferFileStatus;
  source_path: string;
  destination_dir: string;
  destination_path: string | null;
  file_name: string;
  is_directory: boolean;
  message: string;
  copied_count?: number;
  skipped_count?: number;
}

export interface DeleteEntriesResult {
  deleted: number;
  skipped: number;
  failed: number;
  first_error?: string;
}

// Internal app state shape — not serialised.

export interface AppState {
  config: AppConfig | null;
  config_warnings: string[];
  selected_machine: MachineProfile | null;
  machine_statuses: Map<string, AvailabilityStatus>;
  machine_current_path: string | null;
  machine_breadcrumb: string[];
  machine_entries: BrowserEntry[];
  selected_machine_entry: BrowserEntry | null;
  selected_machine_entries: BrowserEntry[];
  local_root: string | null;
  local_current_path: string | null;
  local_breadcrumb: string[];
  local_entries: BrowserEntry[];
  local_search_results: BrowserEntry[] | null;
  selected_local_entry: BrowserEntry | null;
  selected_local_entries: BrowserEntry[];
  active_selection: ActivePaneSelection | null;
  preview: PreviewData | null;
  is_loading_machine_directory: boolean;
  is_loading_local_directory: boolean;
  is_loading_local_search: boolean;
  is_checking: boolean;
  is_loading_preview: boolean;
  status_message: string;
  language: Language;
}
