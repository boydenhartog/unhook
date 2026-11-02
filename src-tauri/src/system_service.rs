//! macOS setup and the constrained launchd helper protocol. No privilege prompt is
//! used by ordinary requests; macOS owns approval during explicit setup.
#[cfg(any(target_os = "macos", test))]
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemServiceStatus {
    pub state: String,
    pub message: Option<String>,
    pub registered: bool,
    pub management: String,
}

impl SystemServiceStatus {
    pub fn can_block(&self) -> bool {
        matches!(self.state.as_str(), "ready" | "passwordRequired")
    }
}

fn state(state: &str, message: Option<&str>) -> SystemServiceStatus {
    SystemServiceStatus {
        state: state.into(),
        message: message.map(str::to_owned),
        registered: matches!(state, "ready" | "requiresApproval"),
        management: match state {
            "passwordRequired" => "password",
            "unsupported" => "unsupported",
            _ => "embedded",
        }
        .into(),
    }
}

#[cfg(any(target_os = "macos", test))]
fn approved_service_status(responding: bool) -> SystemServiceStatus {
    if responding {
        state("ready", None)
    } else {
        let mut result = state("unavailable", Some("The approved system blocker is not responding. Check Unhook in System Settings → General → Login Items & Extensions."));
        result.registered = true;
        result
    }
}

#[cfg(any(target_os = "macos", test))]
fn installed_service_status(protected: bool, responding: bool) -> SystemServiceStatus {
    SystemServiceStatus {
        state: if protected && responding {
            "ready"
        } else {
            "unavailable"
        }
        .into(),
        message: if protected && responding {
            None
        } else {
            Some("The package-installed system blocker is unavailable. Reinstall the Unhook package to repair the service or approve its background item in System Settings. No password fallback is used.".into())
        },
        registered: true,
        management: "installer".into(),
    }
}

#[cfg(any(target_os = "macos", test))]
fn parse_response(bytes: &[u8]) -> Result<Option<String>, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Response {
        ok: bool,
        warning: Option<String>,
        error: Option<String>,
    }
    if bytes.len() > 8192 {
        return Err("System blocker reply was too large.".into());
    }
    let response: Response = serde_json::from_slice(bytes)
        .map_err(|_| "System blocker returned an invalid reply.".to_string())?;
    if response.ok {
        Ok(response.warning)
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "System blocking did not complete.".into()))
    }
}

#[cfg(any(target_os = "macos", all(test, unix)))]
fn protected_metadata(metadata: &std::fs::Metadata, owner: u32, directory: bool) -> bool {
    use std::os::unix::fs::MetadataExt;
    metadata.uid() == owner
        && metadata.mode() & 0o022 == 0
        && if directory {
            metadata.is_dir()
        } else {
            metadata.is_file() && metadata.nlink() == 1
        }
}

#[cfg(any(target_os = "macos", all(test, unix)))]
fn protected_path(path: &std::path::Path, owner: u32, directory: bool) -> bool {
    if !std::fs::symlink_metadata(path)
        .is_ok_and(|metadata| protected_metadata(&metadata, owner, directory))
    {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        extern "C" {
            fn unhook_path_has_no_acl(path: *const std::os::raw::c_char) -> i32;
        }
        let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        // ACL metadata can be read without opening the root-private pin contents.
        unsafe { unhook_path_has_no_acl(path.as_ptr()) == 1 }
    }
    #[cfg(not(target_os = "macos"))]
    true
}

// Presence is conservative: incomplete or unsafe installations disable all other
// managers. Readiness additionally requires an authenticated daemon response.
#[cfg(any(target_os = "macos", all(test, unix)))]
fn inspect_installed_assets(
    paths: &[&std::path::Path],
    socket: &std::path::Path,
    owner: u32,
) -> Option<bool> {
    use std::{fs, io::ErrorKind};
    let present = |path: &std::path::Path| !matches!(fs::symlink_metadata(path), Err(error) if error.kind() == ErrorKind::NotFound);
    if !paths.iter().any(|path| present(path)) && !present(socket) {
        return None;
    }
    Some(paths.iter().all(|path| {
        if !protected_path(path, owner, false) {
            return false;
        }
        path.ancestors()
            .skip(1)
            .all(|parent| protected_path(parent, owner, true))
    }))
}

#[cfg(target_os = "macos")]
fn fixture_mode() -> bool {
    cfg!(debug_assertions) && std::env::var_os("UNHOOK_TEST_HOSTS").is_some()
}

#[cfg(any(target_os = "macos", test))]
fn fixture_status() -> SystemServiceStatus {
    state(
        "passwordRequired",
        Some("Development fixture mode: system services, hosts and DNS are untouched."),
    )
}

#[cfg(any(target_os = "macos", test))]
fn guarded_status(
    fixture: bool,
    native: impl FnOnce() -> SystemServiceStatus,
) -> SystemServiceStatus {
    if fixture {
        fixture_status()
    } else {
        native()
    }
}

#[cfg(any(target_os = "macos", test))]
fn guarded_mutation(
    fixture: bool,
    native: impl FnOnce() -> Result<SystemServiceStatus, String>,
) -> Result<SystemServiceStatus, String> {
    if fixture {
        Ok(fixture_status())
    } else {
        native()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::{
        io::{Read, Write},
        net::Shutdown,
        os::{fd::AsRawFd, unix::net::UnixStream},
        sync::Mutex,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    const SOCKET: &str = "/var/run/org.unhook.system-helper.sock";
    const INSTALLED_SOCKET: &str = "/var/run/org.unhook.installed-system-helper.sock";
    const INSTALLED_ASSETS: [&str; 3] = [
        "/Library/LaunchDaemons/org.unhook.installed-system-helper.plist",
        "/Library/PrivilegedHelperTools/org.unhook.installed-system-helper",
        "/Library/Application Support/Unhook/approved-code-hashes",
    ];
    fn installed_assets() -> Option<bool> {
        let paths = INSTALLED_ASSETS.map(std::path::Path::new);
        inspect_installed_assets(&paths, std::path::Path::new(INSTALLED_SOCKET), 0)
    }
    fn socket_for(service: &SystemServiceStatus) -> &'static str {
        if service.management == "installer" {
            INSTALLED_SOCKET
        } else {
            SOCKET
        }
    }
    static MANAGEMENT: Mutex<()> = Mutex::new(());
    extern "C" {
        fn unhook_service_status() -> i32;
        fn unhook_service_install() -> i32;
        fn unhook_service_uninstall() -> i32;
        fn unhook_service_open_settings() -> i32;
        fn unhook_peer_is_root(socket: i32) -> i32;
    }

    fn request(socket: &str, value: serde_json::Value) -> Result<Option<String>, String> {
        let mut stream = UnixStream::connect(socket).map_err(|_| {
            "The system blocker is not responding. Check its permission in System Settings."
                .to_string()
        })?;
        if unsafe { unhook_peer_is_root(stream.as_raw_fd()) } != 1 {
            return Err("Refusing an untrusted system blocker endpoint.".into());
        }
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        stream
            .write_all(&bytes)
            .map_err(|e| format!("Could not contact system blocker: {e}"))?;
        stream
            .shutdown(Shutdown::Write)
            .map_err(|e| e.to_string())?;
        let mut response = Vec::new();
        stream.take(8193).read_to_end(&mut response).map_err(|_| {
            "The system blocker did not reply. Check its permission in System Settings.".to_string()
        })?;
        parse_response(&response)
    }

    fn mapped(code: i32) -> SystemServiceStatus {
        match code {
            0 => state("passwordRequired", Some("System blocking is available with administrator permission for each hosts change. One-time approval needs macOS 13 or later.")),
            1 => state("notInstalled", None),
            2 => state("requiresApproval", Some("Allow Unhook in System Settings → General → Login Items & Extensions. macOS may ask for your administrator password once.")),
            3 => approved_service_status(request(SOCKET, serde_json::json!({"type":"ping"})).is_ok()),
            5 => installed_service_status(false, false),
            _ => state("passwordRequired", Some("System blocking is available with your administrator password when the hosts blocklist changes. Install the Unhook package for system blocking without routine password prompts, or use a signed build’s background service.")),
        }
    }

    pub fn status() -> SystemServiceStatus {
        let _lock = MANAGEMENT.lock().unwrap_or_else(|e| e.into_inner());
        guarded_status(fixture_mode(), || {
            if let Some(protected) = installed_assets() {
                return installed_service_status(
                    protected,
                    protected
                        && request(INSTALLED_SOCKET, serde_json::json!({"type":"ping"})).is_ok(),
                );
            }
            mapped(unsafe { unhook_service_status() })
        })
    }
    pub fn install() -> Result<SystemServiceStatus, String> {
        let _lock = MANAGEMENT.lock().unwrap_or_else(|e| e.into_inner());
        guarded_mutation(fixture_mode(), || {
            if let Some(protected) = installed_assets() {
                return Ok(installed_service_status(
                    protected,
                    protected
                        && request(INSTALLED_SOCKET, serde_json::json!({"type":"ping"})).is_ok(),
                ));
            }
            let code = unsafe { unhook_service_install() };
            if code == -1 {
                return Err("macOS could not register the system blocker. Check Unhook in System Settings → General → Login Items & Extensions, then try again.".into());
            }
            Ok(mapped(code))
        })
    }
    pub fn uninstall() -> Result<SystemServiceStatus, String> {
        let _lock = MANAGEMENT.lock().unwrap_or_else(|e| e.into_inner());
        // The controller must restore hosts before unregistering. An unavailable
        // endpoint must not prevent revoking an already registered daemon.
        guarded_mutation(fixture_mode(), || {
            if let Some(protected) = installed_assets() {
                if !protected {
                    return Err("The installed system service has unsafe or missing assets. Reinstall the Unhook package before removing it.".into());
                }
                request(INSTALLED_SOCKET, serde_json::json!({"type":"uninstall"}))?;
                let mut removed = state(
                    "notInstalled",
                    Some("Reinstall the Unhook package to use its system service again."),
                );
                removed.management = "installer".into();
                return Ok(removed);
            }
            let code = unsafe { unhook_service_uninstall() };
            if code == -1 {
                return Err("macOS could not remove the system blocker registration. Check Unhook in System Settings → General → Login Items & Extensions, then try again.".into());
            }
            Ok(mapped(code))
        })
    }
    pub fn open_settings() -> Result<(), String> {
        if fixture_mode() {
            return Err("System Settings cannot be opened from development fixture mode.".into());
        }
        if unsafe { unhook_service_open_settings() } == 1 {
            Ok(())
        } else {
            Err("System blocker setup needs macOS 13 or later.".into())
        }
    }
    pub fn change(
        domains: Option<&[String]>,
        ends_at: Option<i64>,
    ) -> Result<Option<String>, String> {
        if fixture_mode() {
            return Err("The system service is not used in development fixture mode.".into());
        }
        let service = status();
        if service.state != "ready" {
            return Err("System blocking is not ready. Complete its optional setup in Unhook, or use browser blocking.".into());
        }
        let value = match domains {
            Some(domains) => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_secs() as i64;
                let deadline = lease_deadline(now, ends_at)?;
                let canonical =
                    unhook_core::normalize_domains(domains).map_err(|e| e.to_string())?;
                if canonical != domains || domains.is_empty() || domains.len() > 500 {
                    return Err("Invalid system blocker domains.".into());
                }
                serde_json::json!({"type":"apply","domains":domains,"expiresAt":deadline})
            }
            None => serde_json::json!({"type":"restore"}),
        };
        request(socket_for(&service), value)
    }
}

#[cfg(any(target_os = "macos", test))]
fn lease_deadline(now: i64, ends_at_millis: Option<i64>) -> Result<i64, String> {
    // Controller deadlines are UNIX milliseconds; the native protocol uses
    // UNIX seconds. Round down so the system layer never outlives the session.
    let ends_at = ends_at_millis
        .map(|deadline| deadline.div_euclid(1000))
        .filter(|deadline| *deadline > now)
        .ok_or_else(|| "System blocking requires an unexpired focus session.".to_string())?;
    Ok(ends_at.min(now.saturating_add(15)))
}

#[cfg(target_os = "macos")]
pub use platform::{change, install, open_settings, status, uninstall};

#[cfg(not(target_os = "macos"))]
pub fn status() -> SystemServiceStatus {
    state("unsupported", Some("One-time system blocker setup is currently available on macOS 13 or later. Browser blocking is available."))
}
#[cfg(not(target_os = "macos"))]
pub fn install() -> Result<SystemServiceStatus, String> {
    Ok(status())
}
#[cfg(not(target_os = "macos"))]
pub fn uninstall() -> Result<SystemServiceStatus, String> {
    Ok(status())
}
#[cfg(not(target_os = "macos"))]
pub fn open_settings() -> Result<(), String> {
    Err("System blocker setup is not available on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn short_lease_never_exceeds_the_session_deadline() {
        assert_eq!(lease_deadline(100, Some(999_000)), Ok(115));
        assert_eq!(lease_deadline(100, Some(105_000)), Ok(105));
        assert_eq!(lease_deadline(100, Some(105_999)), Ok(105));
        assert!(lease_deadline(100, Some(100_999)).is_err());
        assert!(lease_deadline(100, None).is_err());
    }
    #[test]
    fn only_available_system_modes_can_be_enabled() {
        for name in ["ready", "passwordRequired"] {
            assert!(state(name, None).can_block());
        }
        for name in [
            "unavailable",
            "unsupported",
            "notInstalled",
            "requiresApproval",
        ] {
            assert!(!state(name, None).can_block());
        }
    }
    #[test]
    fn known_registration_states_can_be_removed_without_enabling_blocking() {
        assert!(state("ready", None).registered);
        assert!(state("requiresApproval", None).registered);
        assert!(!state("requiresApproval", None).can_block());
        assert!(!state("passwordRequired", None).registered);
        assert!(!state("notInstalled", None).registered);
    }
    #[test]
    fn registered_unresponsive_service_can_be_removed_but_cannot_block() {
        let unavailable = approved_service_status(false);
        assert_eq!(unavailable.state, "unavailable");
        assert!(unavailable.registered);
        assert!(!unavailable.can_block());
        assert!(approved_service_status(true).can_block());
    }
    #[test]
    fn installed_presence_never_falls_back_to_password_or_embedded_service() {
        let ready = installed_service_status(true, true);
        assert_eq!(ready.state, "ready");
        assert_eq!(ready.management, "installer");
        for (protected, responding) in [(false, false), (false, true), (true, false)] {
            let failed = installed_service_status(protected, responding);
            assert_eq!(failed.state, "unavailable");
            assert_eq!(failed.management, "installer");
            assert!(failed.registered);
            assert!(!failed.can_block());
        }
    }
    #[test]
    fn service_reply_requires_a_positive_bounded_protocol_response() {
        assert!(parse_response(br#"{"ok":true,"warning":null,"error":null}"#).is_ok());
        assert!(parse_response(br#"{"ok":false,"error":"Unapproved client"}"#).is_err());
        assert!(parse_response(br#"{"ok":true,"unexpected":true}"#).is_err());
        assert!(parse_response(&vec![b' '; 8193]).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn incomplete_and_malformed_installed_assets_claim_installer_ownership() {
        use std::{fs, os::unix::fs::symlink};
        let dir = tempfile::tempdir().unwrap();
        let asset = dir.path().join("asset");
        let socket = dir.path().join("socket");
        assert_eq!(inspect_installed_assets(&[&asset], &socket, 0), None);
        fs::write(&socket, b"stranded endpoint").unwrap();
        assert_eq!(inspect_installed_assets(&[&asset], &socket, 0), Some(false));
        fs::remove_file(&socket).unwrap();
        symlink(dir.path().join("absent"), &asset).unwrap();
        assert_eq!(inspect_installed_assets(&[&asset], &socket, 0), Some(false));
    }
    #[cfg(unix)]
    #[test]
    fn asset_metadata_rejects_wrong_owner_write_access_links_and_types() {
        use std::{
            fs,
            os::unix::fs::{symlink, MetadataExt, PermissionsExt},
        };
        let dir = tempfile::tempdir().unwrap();
        let asset = dir.path().join("asset");
        fs::write(&asset, b"protected").unwrap();
        fs::set_permissions(&asset, fs::Permissions::from_mode(0o600)).unwrap();
        let meta = fs::symlink_metadata(&asset).unwrap();
        let uid = meta.uid();
        assert!(protected_metadata(&meta, uid, false));
        assert!(!protected_metadata(&meta, uid.saturating_add(1), false));
        assert!(!protected_metadata(&meta, uid, true));
        fs::set_permissions(&asset, fs::Permissions::from_mode(0o620)).unwrap();
        assert!(!protected_metadata(
            &fs::symlink_metadata(&asset).unwrap(),
            uid,
            false
        ));
        fs::set_permissions(&asset, fs::Permissions::from_mode(0o600)).unwrap();
        fs::hard_link(&asset, dir.path().join("hardlink")).unwrap();
        assert!(!protected_metadata(
            &fs::symlink_metadata(&asset).unwrap(),
            uid,
            false
        ));
        symlink(&asset, dir.path().join("symlink")).unwrap();
        assert!(!protected_metadata(
            &fs::symlink_metadata(dir.path().join("symlink")).unwrap(),
            uid,
            false
        ));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn installer_assets_and_ancestors_reject_acl_grants_with_safe_posix_modes() {
        use std::{
            fs,
            os::unix::fs::{MetadataExt, PermissionsExt},
            process::Command,
        };
        let dir = tempfile::tempdir_in("/private/tmp").unwrap();
        let file = dir.path().join("pins");
        fs::write(&file, b"fixture").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let owner = fs::metadata(&file).unwrap().uid();
        assert!(protected_path(&file, owner, false));
        assert!(protected_path(dir.path(), owner, true));
        let user = std::env::var("USER").unwrap();
        for (path, directory) in [(&file as &std::path::Path, false), (dir.path(), true)] {
            assert!(Command::new("/bin/chmod")
                .arg("+a")
                .arg(format!("{user} allow write"))
                .arg(path)
                .status()
                .unwrap()
                .success());
            assert!(!protected_path(path, owner, directory));
            assert!(Command::new("/bin/chmod")
                .arg("-N")
                .arg(path)
                .status()
                .unwrap()
                .success());
            assert!(protected_path(path, owner, directory));
        }
    }
    #[test]
    fn fixtures_never_query_or_change_real_service_registration() {
        assert!(!guarded_status(true, || panic!("real service read")).registered);
        assert!(
            !guarded_mutation(true, || panic!("real service registration"))
                .unwrap()
                .registered
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn unsigned_test_runner_never_claims_an_authenticated_service() {
        let actual = status();
        if actual.management == "installer" {
            // Installed assets select this route even though the unpinned test
            // executable cannot authenticate. It must not use password fallback.
            assert_eq!(actual.state, "unavailable");
            assert!(actual.registered);
        } else {
            assert_eq!(actual.state, "passwordRequired");
            assert_eq!(actual.management, "password");
        }
    }
}
