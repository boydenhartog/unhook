//! Install a user-local, read-only native messaging host for Chromium browsers.
//! The host receives a snapshot, never a writable app API or browser history.
use crate::controller::AppStatus;
use std::{
    fs,
    path::{Path, PathBuf},
};
use unhook_core::{BrowserState, BROWSER_EXTENSION_ORIGIN, BROWSER_HOST_NAME};

pub struct Bridge {
    pub state_path: PathBuf,
    pub warning: Option<String>,
}

fn save_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid browser bridge location")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer(temporary.as_file(), value).map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn manifest(executable: &Path) -> serde_json::Value {
    serde_json::json!({
        "name": BROWSER_HOST_NAME,
        "description": "Unhook read-only browser bridge",
        "path": executable,
        "type": "stdio",
        "allowed_origins": [BROWSER_EXTENSION_ORIGIN]
    })
}

fn install_host() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let host = executable
        .parent()
        .ok_or("Invalid app location")?
        .join(if cfg!(windows) {
            "unhook-browser-host.exe"
        } else {
            "unhook-browser-host"
        });
    if !host.is_file() {
        return Err("The browser companion host is missing from this build.".into());
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let home = dirs::home_dir().ok_or("Cannot locate your home folder")?;
        #[cfg(target_os = "macos")]
        let roots = [
            home.join("Library/Application Support/Google/Chrome"),
            home.join("Library/Application Support/BraveSoftware/Brave-Browser"),
        ];
        #[cfg(not(target_os = "macos"))]
        let roots = {
            let config = dirs::config_dir().ok_or("Cannot locate your config folder")?;
            [
                config.join("google-chrome"),
                config.join("BraveSoftware/Brave-Browser"),
            ]
        };
        for root in roots {
            save_json(
                &root.join(format!("NativeMessagingHosts/{BROWSER_HOST_NAME}.json")),
                &manifest(&host),
            )?;
        }
    }
    #[cfg(target_os = "windows")]
    {
        let directory = dirs::data_dir()
            .ok_or("Cannot locate app data")?
            .join("org.unhook.desktop");
        let path = directory.join(format!("{BROWSER_HOST_NAME}.json"));
        save_json(&path, &manifest(&host))?;
        // The dedicated host has no UAC manifest and never changes system hosts.
        for browser in ["Google\\Chrome", "BraveSoftware\\Brave-Browser"] {
            let output = std::process::Command::new("reg")
                .args([
                    "ADD",
                    &format!(
                        "HKCU\\Software\\{browser}\\NativeMessagingHosts\\{BROWSER_HOST_NAME}"
                    ),
                    "/ve",
                    "/t",
                    "REG_SZ",
                    "/d",
                ])
                .arg(&path)
                .arg("/f")
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err("Could not register the browser companion host.".into());
            }
        }
    }
    Ok(())
}

impl Bridge {
    pub fn setup(directory: PathBuf, fixture: bool) -> Self {
        let warning = if fixture { None } else { install_host().err() };
        Self {
            state_path: directory.join("browser-state.json"),
            warning,
        }
    }
    pub fn publish(&self, status: &AppStatus, now: i64) -> Result<(), String> {
        let state = BrowserState {
            version: 1,
            domains: status.settings.domains.clone(),
            active: status.active && status.ends_at.is_some_and(|end| end > now),
            ends_at: status.ends_at,
            updated_at: now,
        };
        save_json(&self.state_path, &state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::Settings;
    #[test]
    fn snapshot_tracks_start_edits_and_stop_without_exposing_settings_controls() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::setup(dir.path().into(), true);
        let mut status = AppStatus {
            settings: Settings::default(),
            active: true,
            ends_at: Some(2000),
            remaining_seconds: 1,
            source: Some("manual"),
            warning: None,
            error: None,
            hosts_path: "fixture".into(),
        };
        status.settings.domains = vec!["marktplaats.nl".into()];
        bridge.publish(&status, 1000).unwrap();
        let read = || {
            serde_json::from_slice::<BrowserState>(&fs::read(&bridge.state_path).unwrap()).unwrap()
        };
        assert!(read().active);
        assert_eq!(read().domains, ["marktplaats.nl"]);
        status.settings.domains = vec!["example.com".into()];
        bridge.publish(&status, 1100).unwrap();
        assert_eq!(read().domains, ["example.com"]);
        status.active = false;
        bridge.publish(&status, 1200).unwrap();
        assert!(!read().active);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&bridge.state_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn registration_allows_only_our_extension_and_a_fixed_executable() {
        let value = manifest(Path::new("/test/unhook-browser-host"));
        assert_eq!(
            value["allowed_origins"],
            serde_json::json!([BROWSER_EXTENSION_ORIGIN])
        );
        assert_eq!(value["path"], "/test/unhook-browser-host");
    }
}
