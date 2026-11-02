mod browser;
mod controller;
mod login_service;
pub mod privilege;
mod session;
mod system_service;

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
    setup_flags: Mutex<(bool, bool)>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupStatus {
    completed: bool,
    browser_connected: bool,
    extension_path: Option<String>,
    extension_version: Option<String>,
    browser_last_seen: Option<i64>,
    system_blocking_enabled: bool,
    system: system_service::SystemServiceStatus,
    login: login_service::LoginServiceStatus,
}

fn read_setup_status(app: &tauri::AppHandle) -> SetupStatus {
    let desktop = app.state::<Desktop>();
    let (completed, system_blocking_enabled) = *desktop
        .setup_flags
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let receipt = desktop.browser.connection(Local::now().timestamp_millis());
    SetupStatus {
        completed,
        browser_connected: receipt.is_some(),
        extension_path: desktop
            .browser
            .extension_path
            .as_ref()
            .map(|path| path.display().to_string()),
        extension_version: receipt
            .as_ref()
            .map(|receipt| receipt.extension_version.clone())
            .or_else(|| desktop.browser.extension_version.clone()),
        browser_last_seen: receipt.map(|receipt| receipt.last_seen),
        system_blocking_enabled,
        system: system_service::status(),
        login: login_service::status(),
    }
}

#[tauri::command]
async fn get_setup_status(app: tauri::AppHandle) -> Result<SetupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || read_setup_status(&app))
        .await
        .map_err(|e| e.to_string())
}

fn launch_browser(browser: &str) -> Result<(), String> {
    let browser = match browser {
        "brave" => "Brave Browser",
        "chrome" => "Google Chrome",
        _ => return Err("Choose Chrome or Brave.".into()),
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("/usr/bin/open");
        command.args(["-a", browser, "chrome://extensions/"]);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new(if browser == "Brave Browser" {
            "brave-browser"
        } else {
            "google-chrome"
        });
        command.arg("chrome://extensions/");
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new(if browser == "Brave Browser" {
            "brave.exe"
        } else {
            "chrome.exe"
        });
        command.arg("chrome://extensions/");
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    return Err(format!("Open the Extensions page in {browser}."));
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        {
            let result = command.status().map_err(|error| format!("Could not open {browser}. Open its Extensions page from the browser menu. {error}"))?;
            if !result.success() {
                return Err(format!(
                    "Could not open {browser}. Open its Extensions page from the browser menu."
                ));
            }
        }
        #[cfg(not(target_os = "macos"))]
        command.spawn().map_err(|error| {
            format!(
                "Could not open {browser}. Open its Extensions page from the browser menu. {error}"
            )
        })?;
        Ok(())
    }
}

#[tauri::command]
async fn open_browser_setup(app: tauri::AppHandle, browser: String) -> Result<SetupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app.state::<Desktop>().browser.extension_path.is_none() {
            return Err("The companion folder is missing. Reinstall this Unhook build.".into());
        }
        launch_browser(&browser)?;
        Ok(read_setup_status(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn reveal_extension(app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .state::<Desktop>()
        .browser
        .extension_path
        .clone()
        .ok_or("The companion folder is missing from this build.")?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("/usr/bin/open");
        #[cfg(target_os = "windows")]
        let mut command = std::process::Command::new("explorer.exe");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut command = std::process::Command::new("xdg-open");
        command
            .arg(path)
            .status()
            .map_err(|e| format!("Could not show the companion folder: {e}"))?
            .success()
            .then_some(())
            .ok_or("Could not show the companion folder.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn complete_setup(app: tauri::AppHandle) -> Result<SetupStatus, String> {
    operate(app.clone(), |controller| {
        controller.complete_setup(Local::now())
    })
    .await?;
    get_setup_status(app).await
}

#[tauri::command]
async fn install_system_blocker(app: tauri::AppHandle) -> Result<SetupStatus, String> {
    tauri::async_runtime::spawn_blocking(system_service::install)
        .await
        .map_err(|e| e.to_string())??;
    get_setup_status(app).await
}

#[tauri::command]
async fn uninstall_system_blocker(app: tauri::AppHandle) -> Result<SetupStatus, String> {
    // Restore the system layer before removing the service. The accepted browser
    // session remains active, and a failed restore must prevent unregistration.
    // Hold the controller lock through removal so a concurrent enable cannot
    // reapply hosts between restoration and unregistration.
    operate(app.clone(), |controller| {
        let status = controller.restore_system_hosts(Local::now())?;
        system_service::uninstall()?;
        Ok(status)
    })
    .await?;
    get_setup_status(app).await
}

#[tauri::command]
async fn set_launch_at_login(app: tauri::AppHandle, enabled: bool) -> Result<SetupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || login_service::set_enabled(enabled))
        .await
        .map_err(|e| e.to_string())??;
    get_setup_status(app).await
}

#[tauri::command]
async fn open_system_settings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(system_service::open_settings)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_system_blocking(app: tauri::AppHandle, enabled: bool) -> Result<AppStatus, String> {
    operate(app, move |controller| {
        if enabled && !system_service::status().can_block() {
            return Err("Approve the system blocker in setup before enabling it.".into());
        }
        controller.set_system_blocking(enabled, Local::now())
    })
    .await
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
            *desktop
                .setup_flags
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = (
                controller.persisted.setup_completed,
                controller.persisted.system_blocking_enabled,
            );
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
    operate(app, |controller| {
        controller.restore_system_hosts(Local::now())
    })
    .await
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
            restore_hosts,
            get_setup_status,
            open_browser_setup,
            reveal_extension,
            complete_setup,
            install_system_blocker,
            uninstall_system_blocker,
            set_launch_at_login,
            open_system_settings,
            set_system_blocking
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
                Some(&app.path().resource_dir()?.join("browser-extension")),
            );
            let controller = Controller::load(path, Box::new(NativeHosts));
            let initial = controller.status(Local::now());
            let setup_flags = (
                controller.persisted.setup_completed,
                controller.persisted.system_blocking_enabled,
            );
            let status_menu = MenuItem::with_id(app, "status", "Focus off", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "show", "Open Unhook", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop focus", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Stop focus and quit", true, None::<&str>)?;
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
                setup_flags: Mutex::new(setup_flags),
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
