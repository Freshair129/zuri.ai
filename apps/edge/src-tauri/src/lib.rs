pub mod commands;

use std::sync::Mutex;
use commands::{
    check_app_update, check_headless_cli, get_app_version, get_edge_status, import_pairing_payload,
    load_persisted_config, send_heartbeat_now, AppState,
};

pub fn run() {
    let initial_config = load_persisted_config();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            config: Mutex::new(initial_config),
        })
        .invoke_handler(tauri::generate_handler![
            get_edge_status,
            import_pairing_payload,
            send_heartbeat_now,
            check_headless_cli,
            get_app_version,
            check_app_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zuri Edge Device application");
}
