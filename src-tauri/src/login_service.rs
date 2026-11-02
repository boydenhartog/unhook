//! macOS owns launch-at-login state and approval. No preference is persisted.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginServiceStatus {
    pub state: String,
    pub message: Option<String>,
}

fn state(state: &str, message: Option<&str>) -> LoginServiceStatus {
    LoginServiceStatus {
        state: state.into(),
        message: message.map(str::to_owned),
    }
}

#[cfg(any(target_os = "macos", test))]
fn mapped(code: i32) -> LoginServiceStatus {
    match code {
        0 => state("unsupported", Some("Launch at login is available on macOS 13 or later.")),
        1 => state("disabled", None),
        2 => state("requiresApproval", Some("Allow Unhook in System Settings → General → Login Items & Extensions to launch at login.")),
        3 => state("enabled", None),
        4 => state("unavailable", Some("Install Unhook in Applications and open it there before setting up launch at login.")),
        _ => state("unavailable", Some("macOS could not find Unhook's login service. Reinstall Unhook, then check Login Items & Extensions in System Settings.")),
    }
}

#[cfg(any(target_os = "macos", test))]
fn mutation_result(code: i32) -> Result<LoginServiceStatus, String> {
    if code < 0 {
        Err("macOS could not change launch at login. Check Unhook in System Settings → General → Login Items & Extensions, then try again.".into())
    } else {
        Ok(mapped(code))
    }
}

#[cfg(target_os = "macos")]
fn fixture_mode() -> bool {
    cfg!(debug_assertions) && std::env::var_os("UNHOOK_TEST_HOSTS").is_some()
}

#[cfg(any(target_os = "macos", test))]
fn read_status(fixture: bool, native: impl FnOnce() -> i32) -> LoginServiceStatus {
    if fixture {
        state(
            "disabled",
            Some("Development fixture mode: macOS login items are untouched."),
        )
    } else {
        mapped(native())
    }
}

#[cfg(any(target_os = "macos", test))]
fn change_status(
    fixture: bool,
    native: impl FnOnce() -> i32,
) -> Result<LoginServiceStatus, String> {
    if fixture {
        Err("Launch at login cannot be changed in development fixture mode. macOS login items are untouched.".into())
    } else {
        mutation_result(native())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::sync::Mutex;
    static MANAGEMENT: Mutex<()> = Mutex::new(());
    extern "C" {
        fn unhook_login_status() -> i32;
        fn unhook_login_set_enabled(enabled: i32) -> i32;
    }

    pub fn status() -> LoginServiceStatus {
        let _lock = MANAGEMENT.lock().unwrap_or_else(|e| e.into_inner());
        read_status(fixture_mode(), || unsafe { unhook_login_status() })
    }

    pub fn set_enabled(enabled: bool) -> Result<LoginServiceStatus, String> {
        let _lock = MANAGEMENT.lock().unwrap_or_else(|e| e.into_inner());
        change_status(fixture_mode(), || unsafe {
            unhook_login_set_enabled(i32::from(enabled))
        })
    }
}

#[cfg(target_os = "macos")]
pub use platform::{set_enabled, status};

#[cfg(not(target_os = "macos"))]
pub fn status() -> LoginServiceStatus {
    state(
        "unsupported",
        Some("Launch at login setup is currently available on macOS 13 or later."),
    )
}

#[cfg(not(target_os = "macos"))]
pub fn set_enabled(_enabled: bool) -> Result<LoginServiceStatus, String> {
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_approval_and_revocation_are_reflected_in_status() {
        assert_eq!(mapped(1).state, "disabled");
        assert_eq!(mapped(2).state, "requiresApproval");
        assert_eq!(mapped(3).state, "enabled");
        assert_eq!(mapped(0).state, "unsupported");
        assert_eq!(mapped(4).state, "unavailable");
        assert_eq!(mapped(99).state, "unavailable");
    }

    #[test]
    fn unavailable_setup_explains_installation_without_claiming_approval() {
        assert!(mapped(4).message.unwrap().contains("Applications"));
        assert!(mapped(5).message.unwrap().contains("Reinstall"));
        assert!(mapped(2).message.unwrap().contains("System Settings"));
    }

    #[test]
    fn registration_errors_do_not_claim_login_is_enabled() {
        assert!(mutation_result(-1)
            .unwrap_err()
            .contains("could not change"));
        assert_eq!(mutation_result(2).unwrap().state, "requiresApproval");
    }

    #[test]
    fn fixture_read_and_write_never_contact_macos() {
        assert_eq!(
            read_status(true, || panic!("real macOS read")).state,
            "disabled"
        );
        assert!(change_status(true, || panic!("real macOS registration")).is_err());
    }
}
