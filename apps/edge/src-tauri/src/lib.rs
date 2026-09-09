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
    get_worker_log, get_worker_status, save_provider_settings, start_provider_login, start_worker,
    stop_worker,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use commands::{
    check_app_update, check_headless_cli, connect_zuri, get_app_version, get_edge_status,
    import_pairing_payload, open_pairing_browser, poll_pairing, send_heartbeat_now, AppState,
};

/// True when this launch should come up in the tray rather than on screen.
///
/// Autostart passes `--minimized` (see the plugin registration below), and at logon the operator
/// did not ask to look at anything — they asked for the device to answer.
pub fn starts_hidden<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().skip(1).any(|arg| arg == "--minimized")
}

/// Bring the window back from the tray. Also the answer to launching the app a second time.
fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The one path that actually ends the process, and the only one that stops the worker.
///
/// Closing the window no longer comes here: it hides to the tray instead. That distinction is the
/// point of the tray — before it, closing the window silently took the device off LINE, and nothing
/// on screen said so because there was no longer anything on screen.
fn shutdown(app: &AppHandle) {
    if app
        .state::<AppState>()
        .quitting
        .swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
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

pub fn run() {
    tauri::Builder::default()
        // Launching it again while it sits in the tray should bring it back, not do nothing —
        // that is how someone who forgot it was running will try to open it.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| reveal(app)))
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
            // Resume the worker when that was the operator's last explicit intent. Autostart
            // launches this app at logon with --minimized, and until now that produced a device
            // that looked paired and healthy while claiming nothing, because only a click on
            // "เริ่มรับงาน" ever started the child. Spawned rather than awaited: setup must not
            // block the window, and the resume waits on local services coming up alongside it.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                desktop::resume_worker(&handle.state::<AppState>()).await;
            });

            // The tray is what makes "keeps answering" survive the window being closed. Without
            // it, closing the window stopped the worker and quit, so the device went off LINE with
            // nothing left on screen to say so — which is exactly how it went quiet on 2026-09-10.
            let show = MenuItem::with_id(app, "show", "เปิดหน้าต่าง Zuri Edge Device", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "หยุดรับงานและออกจากโปรแกรม", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("zuri-edge-device")
                .tooltip("Zuri Edge Device — กำลังรับงานอยู่")
                .menu(&menu)
                // Left click reveals; the menu belongs on right click, where Windows users expect it.
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

            // Autostart hands us --minimized. With a tray to live in, honour it literally: come up
            // in the tray, answer LINE, and stay out of the way until someone asks for the window.
            //
            // The window is configured `visible: false`, so a hidden start needs no action; a
            // manual launch is the case that has to ask for the window.
            //
            // Verify this by enumerating the process's windows, not by `MainWindowHandle`: the
            // single-instance plugin owns a zero-size always-visible helper window named
            // `ai.zuri.edge.device-siw`, and that is the one `MainWindowHandle` returns.
            if !starts_hidden(std::env::args()) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide, never quit. Quitting is the tray menu's "หยุดรับงานและออกจากโปรแกรม",
                // which is the only place that stops the worker on purpose.
                api.prevent_close();
                let _ = window.hide();
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
            get_worker_log,
            start_worker,
            stop_worker
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zuri Edge Device application");
}

#[cfg(test)]
mod tray_tests {
    use super::starts_hidden;

    fn args(rest: &[&str]) -> Vec<String> {
        // argv[0] is the executable; a path that happens to contain the flag must not count.
        let mut all = vec![r"C:\Users\pc\ZuriEdgeDesktop\0.3.2\zuri-edge-device.exe".to_string()];
        all.extend(rest.iter().map(|value| value.to_string()));
        all
    }

    #[test]
    fn autostart_starts_in_the_tray_and_a_manual_launch_does_not() {
        assert!(starts_hidden(args(&["--minimized"])));
        assert!(starts_hidden(args(&["--other", "--minimized"])));
        assert!(!starts_hidden(args(&[])));
        assert!(!starts_hidden(args(&["--minimize"])));
        // The executable path is skipped, so a directory named for the flag cannot trigger it.
        assert!(!starts_hidden(vec!["--minimized".to_string()]));
    }
}
