pub mod availability;
pub mod browser;
pub mod commands;
pub mod config;
pub mod models;
pub mod preview;
pub mod send;

use commands::{
    cmd_check_availability, cmd_delete_file, cmd_get_config_path, cmd_get_preview,
    cmd_list_directory, cmd_load_config, cmd_load_machine_profiles, cmd_open_external, cmd_save_config,
    cmd_save_machine_profiles, cmd_transfer_file, cmd_validate_machine_profiles,
};

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cmd_load_config,
            cmd_load_machine_profiles,
            cmd_validate_machine_profiles,
            cmd_save_config,
            cmd_save_machine_profiles,
            cmd_get_config_path,
            cmd_check_availability,
            cmd_list_directory,
            cmd_get_preview,
            cmd_delete_file,
            cmd_open_external,
            cmd_transfer_file,
        ])
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running HAAS CNC Connect");
}
