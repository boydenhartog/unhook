mod browser;
mod controller;
pub mod privilege;
mod session;

use chrono::Local;
use controller::{AppStatus, Controller, NativeHosts};
use session::Settings;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

struct Desktop {
    controller: Mutex<Controller>,
    snapshot: Mutex<AppStatus>,
    status_menu: MenuItem<tauri::Wry>,
    may_exit: AtomicBool,
    browser: browser::Bridge,
}

fn publish(app: &tauri::AppHandle, mut status: AppStatus) {
    let desktop = app.state::<Desktop>();
    let publish_warning = desktop
        .browser
        .publish(&status, Local::now().timestamp_millis())
        .err();
    let browser_warning = desktop.browser.warning.clone().or(publish_warning);
    if let Some(warning) = browser_warning {
        let message = format!("Browser companion could not connect: {warning}");
        status.warning = Some(
            status
                .warning
                .map(|previous| format!("{previous} {message}"))
                .unwrap_or(message),
        );
    }
    let text = if status.error.is_some() {
        "Unhook · action needed".to_owned()
    } else if status.active {
        format!(
            "Focus on · {} min left",
            status.remaining_seconds.div_ceil(60)
        )
    } else {
        "Focus off".to_owned()
    };
    let _ = desktop.status_menu.set_text(&text);
    if let Some(tray) = app.tray_by_id("unhook") {
        let _ = tray.set_tooltip(Some(&text));
    }
    *desktop.snapshot.lock().unwrap_or_else(|e| e.into_inner()) = status.clone();
    let _ = app.emit("status-changed", status);
}

#[tauri::command]
fn get_status(app: tauri::AppHandle) -> AppStatus {
    // A pending administrator prompt must not freeze read-only status polling.
    let mut status = app
        .state::<Desktop>()
        .snapshot
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    status.remaining_seconds = status
        .ends_at
        .map(|end| ((end - Local::now().timestamp_millis()).max(0) as u64).div_ceil(1000))
        .unwrap_or(0);
    status
}

async fn operate(
    app: tauri::AppHandle,
    action: impl FnOnce(&mut Controller) -> Result<AppStatus, String> + Send + 'static,
) -> Result<AppStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result;
        let status;
        {
            let desktop = app.state::<Desktop>();
            let mut controller = desktop.controller.lock().unwrap_or_else(|e| e.into_inner());
            result = action(&mut controller);
            status = controller.status(Local::now());
        }
        publish(&app, status);
        result
    })
    .await
    .map_err(|e| format!("The desktop operation could not finish: {e}"))?
}
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<AppStatus, String> {
    operate(app, move |controller| {
        controller.save_settings(settings, Local::now())
    })
    .await
}
#[tauri::command]
async fn start_focus(app: tauri::AppHandle, minutes: u32) -> Result<AppStatus, String> {
    operate(app, move |controller| {
        controller.start(minutes, Local::now())
    })
    .await
}
#[tauri::command]
async fn stop_focus(app: tauri::AppHandle) -> Result<AppStatus, String> {
    operate(app, |controller| controller.stop(Local::now())).await
}
#[tauri::command]
async fn restore_hosts(app: tauri::AppHandle) -> Result<AppStatus, String> {
    stop_focus(app).await
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn request_quit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match stop_focus(app.clone()).await {
            Ok(_) => {
                app.state::<Desktop>()
                    .may_exit
                    .store(true, Ordering::SeqCst);
                app.exit(0);
            }
            Err(_) => show(&app),
        }
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .invoke_handler(tauri::generate_handler![
            get_status,
            save_settings,
            start_focus,
            stop_focus,
            restore_hosts
        ])
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("settings.json");
            #[cfg(debug_assertions)]
            let path = if std::env::var_os("UNHOOK_TEST_HOSTS").is_some() {
                std::env::var_os("UNHOOK_TEST_STATE")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| std::env::temp_dir().join("unhook-fixture-settings.json"))
            } else {
                path
            };
            let fixture = cfg!(debug_assertions) && std::env::var_os("UNHOOK_TEST_HOSTS").is_some();
            let browser = browser::Bridge::setup(
                path.parent().ok_or("Invalid app data location")?.into(),
                fixture,
            );
            let controller = Controller::load(path, Box::new(NativeHosts));
            let initial = controller.status(Local::now());
            let status_menu = MenuItem::with_id(app, "status", "Focus off", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "show", "Open Unhook", true, None::<&str>)?;
            let stop = MenuItem::with_id(
                app,
                "stop",
                "Stop focus / restore websites",
                true,
                None::<&str>,
            )?;
            let quit =
                MenuItem::with_id(app, "quit", "Restore websites and quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status_menu, &open, &stop, &quit])?;
            TrayIconBuilder::with_id("unhook")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray.png"
                ))?)
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("Unhook")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "stop" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = stop_focus(app.clone()).await;
                            show(&app);
                        });
                    }
                    "quit" => request_quit(app),
                    _ => {}
                })
                .build(app)?;
            app.manage(Desktop {
                controller: Mutex::new(controller),
                snapshot: Mutex::new(initial.clone()),
                status_menu,
                may_exit: AtomicBool::new(false),
                browser,
            });
            publish(app.handle(), initial);
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let status = {
                    let desktop = handle.state::<Desktop>();
                    if desktop.may_exit.load(Ordering::SeqCst) {
                        break;
                    }
                    let mut controller =
                        desktop.controller.lock().unwrap_or_else(|e| e.into_inner());
                    controller.reconcile(Local::now());
                    controller.status(Local::now())
                };
                publish(&handle, status);
                std::thread::sleep(std::time::Duration::from_secs(1));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to start the Unhook desktop app");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Desktop>().may_exit.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit(app);
            }
        }
    });
}
