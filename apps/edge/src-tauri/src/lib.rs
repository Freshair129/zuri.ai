pub mod commands;
mod credential_store;
mod desktop;
mod machine;
#[cfg(test)]
mod packaged_runtime_tests;
pub mod pairing;
pub mod providers;
pub mod supervisor;
mod window_layout;

use desktop::{
    cancel_provider_login, discover_ollama, get_provider_settings, get_provider_status,
    get_worker_status, save_provider_settings, start_provider_login, start_worker, stop_worker,
};
use tauri::Manager;

use commands::{
    check_app_update, check_headless_cli, connect_zuri, get_app_version, get_edge_status,
    import_pairing_payload, open_pairing_browser, poll_pairing, send_heartbeat_now, AppState,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::load())
        .setup(|app| {
            window_layout::fit_to_work_area(app)?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!(
                    "Zuri Edge Device v{} — Control & Zero-Trust Pair",
                    app.package_info().version
                ))?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                if app
                    .state::<AppState>()
                    .quitting
                    .swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    let _guard = state.lifecycle.lock().await;
                    let _ = state.supervisor.stop().await;
                    for provider in ["codex", "claude"] {
                        let _ = state.providers.cancel_login(provider).await;
                    }
                    app.exit(0);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_edge_status,
            machine::get_machine_inventory,
            connect_zuri,
            open_pairing_browser,
            poll_pairing,
            import_pairing_payload,
            send_heartbeat_now,
            check_headless_cli,
            get_app_version,
            check_app_update,
            get_provider_settings,
            save_provider_settings,
            discover_ollama,
            get_provider_status,
            start_provider_login,
            cancel_provider_login,
            get_worker_status,
            start_worker,
            stop_worker
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zuri Edge Device application");
}
