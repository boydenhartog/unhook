//! Install a user-local, read-only native messaging host for Chromium browsers.
//! The host receives a snapshot, never a writable app API or browser history.
use crate::controller::AppStatus;
use std::{
    fs,
    path::{Path, PathBuf},
};
use unhook_core::{
    browser_ack_compatible, BrowserState, BROWSER_EXTENSION_ORIGIN, BROWSER_HOST_NAME,
};

pub struct Bridge {
    pub state_path: PathBuf,
    pub warning: Option<String>,
    pub extension_path: Option<PathBuf>,
    pub extension_version: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connection {
    pub last_seen: i64,
    pub updated_at: i64,
    pub extension_version: String,
    #[serde(default)]
    pub protocol_version: Option<u32>,
}

const EXTENSION_FILES: &[&str] = &[
    "manifest.json",
    "background.js",
    "blocker.js",
    "reflection.js",
    "reflection-state.js",
    "blocked-context.js",
    "page-sender.js",
    "rules.js",
    "blocked.html",
    "blocked.css",
    "blocked.js",
    "popup.html",
    "popup.css",
    "popup.js",
];

fn export_extension(source: &Path, destination: &Path) -> Result<String, String> {
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(source.join("manifest.json"))
            .map_err(|e| format!("Bundled extension is missing: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let version = manifest["version"]
        .as_str()
        .ok_or("Invalid extension version")?
        .to_owned();
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for name in EXTENSION_FILES {
        let bytes = fs::read(source.join(name)).map_err(|e| e.to_string())?;
        let target = destination.join(name);
        if fs::read(&target).ok().as_deref() == Some(&bytes) {
            continue;
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(destination).map_err(|e| e.to_string())?;
        std::io::Write::write_all(temporary.as_file_mut(), &bytes).map_err(|e| e.to_string())?;
        temporary.persist(target).map_err(|e| e.to_string())?;
    }
    Ok(version)
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
    pub fn setup(directory: PathBuf, fixture: bool, resources: Option<&Path>) -> Self {
        let mut warning = if fixture { None } else { install_host().err() };
        let destination = directory.join("browser-extension");
        let exported = resources.map(|source| export_extension(source, &destination));
        let (extension_path, extension_version) = match exported {
            Some(Ok(version)) => (Some(destination), Some(version)),
            Some(Err(error)) => {
                warning = Some(warning.map(|old| format!("{old} {error}")).unwrap_or(error));
                (None, None)
            }
            None => (None, None),
        };
        Self {
            state_path: directory.join("browser-state.json"),
            warning,
            extension_path,
            extension_version,
        }
    }
    pub fn connection(&self, now: i64) -> Option<Connection> {
        let bytes = fs::read(self.state_path.parent()?.join("browser-connection.json")).ok()?;
        if bytes.len() > 1024 {
            return None;
        }
        let receipt: Connection = serde_json::from_slice(&bytes).ok()?;
        let fresh = |time: i64| time > 0 && time <= now && now - time <= 15_000;
        (fresh(receipt.last_seen)
            && fresh(receipt.updated_at)
            && browser_ack_compatible(&receipt.extension_version, receipt.protocol_version))
        .then_some(receipt)
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
        let bridge = Bridge::setup(dir.path().into(), true, None);
        let mut status = AppStatus {
            settings: Settings::default(),
            active: true,
            system_active: false,
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
    #[test]
    fn setup_exports_real_companion_and_connection_requires_supported_fresh_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
        let bridge = Bridge::setup(dir.path().into(), true, Some(&source));
        assert!(bridge
            .extension_path
            .as_ref()
            .unwrap()
            .join("manifest.json")
            .is_file());
        for entry in fs::read_dir(&source).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name();
            let name = name.to_str().unwrap();
            if !name.ends_with(".js") || name.ends_with(".test.js") {
                continue;
            }
            let exported = bridge.extension_path.as_ref().unwrap().join(name);
            assert_eq!(
                fs::read(exported).unwrap(),
                fs::read(source.join(name)).unwrap()
            );
        }
        assert!(!bridge
            .extension_path
            .as_ref()
            .unwrap()
            .join("blocker.test.js")
            .exists());
        let receipt = dir.path().join("browser-connection.json");
        let write = |version: &str, time| {
            save_json(
                &receipt,
                &serde_json::json!({"lastSeen":time,"updatedAt":time,"extensionVersion":version,"protocolVersion":1}),
            )
            .unwrap()
        };
        let version = bridge.extension_version.as_deref().unwrap();
        write(version, 1000);
        assert!(bridge.connection(2000).is_some());
        assert!(bridge.connection(16_001).is_none());
        assert!(bridge.connection(999).is_none());
        write("1..2", 1000);
        assert!(bridge.connection(2000).is_none());
    }

    #[test]
    fn compatible_protocol_survives_independent_extension_updates() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::setup(dir.path().into(), true, None);
        let receipt = dir.path().join("browser-connection.json");
        for version in ["0.2.2", "0.2.9", "1.4.0"] {
            save_json(
                &receipt,
                &serde_json::json!({
                    "lastSeen":1000,"updatedAt":1000,"extensionVersion":version,
                    "protocolVersion":1
                }),
            )
            .unwrap();
            assert!(bridge.connection(2000).is_some(), "{version}");
            assert!(bridge.connection(16_001).is_none());
            assert!(bridge.connection(999).is_none());
        }
    }

    #[test]
    fn connection_accepts_only_known_legacy_or_supported_protocol_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::setup(dir.path().into(), true, None);
        let receipt = dir.path().join("browser-connection.json");
        for version in ["0.2.0", "0.2.1"] {
            save_json(
                &receipt,
                &serde_json::json!({
                    "lastSeen":1000,"updatedAt":1000,"extensionVersion":version
                }),
            )
            .unwrap();
            assert!(bridge.connection(2000).is_some());
        }
        for (version, protocol) in [
            ("0.2.2", serde_json::Value::Null),
            ("0.2.0", serde_json::json!(2)),
            ("0.2.0", serde_json::json!(0)),
            ("0.2.0", serde_json::json!("1")),
            ("0.2.0", serde_json::json!(-1)),
            ("../hosts", serde_json::json!(1)),
            ("", serde_json::json!(1)),
            ("1..2", serde_json::json!(1)),
        ] {
            save_json(
                &receipt,
                &serde_json::json!({
                    "lastSeen":1000,"updatedAt":1000,"extensionVersion":version,
                    "protocolVersion":protocol
                }),
            )
            .unwrap();
            assert!(bridge.connection(2000).is_none(), "{version}/{protocol}");
        }
    }
}
