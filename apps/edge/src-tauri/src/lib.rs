pub mod commands;
mod desktop;
#[cfg(test)]
mod durable_log;
mod machine;
#[cfg(test)]
mod packaged_runtime_tests;
pub mod providers;
#[cfg(test)]
pub mod supervisor;
mod window_layout;

use desktop::{
    cancel_provider_login, discover_ollama, get_provider_settings, get_provider_status,
    save_provider_settings, start_provider_login,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use commands::{
    check_app_update, check_headless_cli, get_app_version, get_desktop_status, AppState,
};

/// Bring the window back from the tray. Also the answer to launching the app a second time.
fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn shutdown(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        for provider in ["codex", "claude"] {
            let _ = state.providers.cancel_login(provider).await;
        }
        app.exit(0);
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            reveal(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::load())
        .setup(|app| {
            window_layout::fit_to_work_area(app)?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!(
                    "Zuri Local Runtime v{}",
                    app.package_info().version
                ))?;
                let _ = window.show();
            }

            let show = MenuItem::with_id(
                app,
                "show",
                "เปิดหน้าต่าง Zuri Local Runtime",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "ออกจากโปรแกรม", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("zuri-local-runtime")
                .tooltip("Zuri Local Runtime")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => reveal(app),
                    "quit" => shutdown(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            machine::get_machine_inventory,
            check_headless_cli,
            get_app_version,
            get_desktop_status,
            check_app_update,
            get_provider_settings,
            save_provider_settings,
            discover_ollama,
            get_provider_status,
            start_provider_login,
            cancel_provider_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zuri Local Runtime application");
}
