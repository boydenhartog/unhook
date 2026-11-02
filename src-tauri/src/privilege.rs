//! The elevated subprocess has a deliberately narrow interface: fixed system hosts
//! path, validated domain arguments, no frontend-supplied command or file path.
use serde::{Deserialize, Serialize};
use unhook_core::{flush_dns, normalize_domains, HostsManager, WriteOutcome};

#[derive(Debug, Serialize, Deserialize)]
pub struct HostChange {
    pub warning: Option<String>,
}

fn outcome_warning(outcome: WriteOutcome, fixture: bool) -> Option<String> {
    let mut warnings: Vec<String> = outcome.warning.into_iter().collect();
    if fixture {
        warnings.push("Development fixture mode: system hosts and DNS are untouched.".into());
    } else if outcome.changed {
        warnings.extend(flush_dns());
    }
    if warnings.is_empty() {
        None
    } else {
        Some(warnings.join(" "))
    }
}

pub fn run_helper_if_requested() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--unhook-helper") {
        return None;
    }
    let result = match args.get(1).map(String::as_str) {
        Some("apply") if args.len() > 2 && args.len() <= 502 => normalize_domains(&args[2..])
            .map_err(|e| e.to_string())
            .and_then(|domains| {
                HostsManager::system()
                    .apply(&domains)
                    .map(|outcome| HostChange {
                        warning: outcome_warning(outcome, false),
                    })
                    .map_err(|e| e.to_string())
            }),
        Some("restore") if args.len() == 2 => HostsManager::system()
            .restore()
            .map(|outcome| HostChange {
                warning: outcome_warning(outcome, false),
            })
            .map_err(|e| e.to_string()),
        _ => Err("Invalid Unhook helper arguments.".into()),
    };
    match result {
        Ok(change) => {
            println!("{}", serde_json::to_string(&change).unwrap());
            Some(0)
        }
        Err(error) => {
            eprintln!("{error}");
            Some(1)
        }
    }
}

pub(crate) fn native_manager() -> HostsManager {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("UNHOOK_TEST_HOSTS") {
        return HostsManager::new(path.into());
    }
    HostsManager::system()
}

fn direct_change_hosts(domains: Option<&[String]>) -> Result<HostChange, String> {
    let manager = native_manager();
    let result = match domains {
        Some(domains) => manager.apply(domains),
        None => manager.restore(),
    };
    match result {
        Ok(outcome) => {
            #[cfg(debug_assertions)]
            let fixture = std::env::var_os("UNHOOK_TEST_HOSTS").is_some();
            #[cfg(not(debug_assertions))]
            let fixture = false;
            Ok(HostChange {
                warning: outcome_warning(outcome, fixture),
            })
        }
        Err(error) if error.is_permission() => {
            #[cfg(debug_assertions)]
            if std::env::var_os("UNHOOK_TEST_HOSTS").is_some() {
                return Err(format!(
                    "Fixture write failed (elevation disabled): {error}"
                ));
            }
            elevate(domains)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Prefer the approved helper; development builds retain the OS password flow.
pub fn change_hosts(
    domains: Option<&[String]>,
    ends_at: Option<i64>,
) -> Result<HostChange, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("UNHOOK_TEST_HOSTS").is_some() {
        return direct_change_hosts(domains);
    }
    #[cfg(target_os = "macos")]
    {
        if crate::system_service::status().state == "passwordRequired" {
            return direct_change_hosts(domains);
        }
        crate::system_service::change(domains, ends_at).map(|warning| HostChange { warning })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = ends_at;
        direct_change_hosts(domains)
    }
}

pub fn refresh_hosts(domains: &[String], ends_at: i64) -> Result<HostChange, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("UNHOOK_TEST_HOSTS").is_some() {
        return Ok(HostChange { warning: None });
    }
    #[cfg(target_os = "macos")]
    {
        if crate::system_service::status().state == "passwordRequired" {
            // Password-based writes have no service lease. Reconciliation already
            // restores at the session deadline; polling must never open a prompt.
            return Ok(HostChange { warning: None });
        }
        crate::system_service::change(Some(domains), Some(ends_at))
            .map(|warning| HostChange { warning })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (domains, ends_at);
        Ok(HostChange { warning: None })
    }
}

/// Only the user's explicit recovery action may open the legacy admin dialog.
/// This removes Unhook's old hosts markers after upgrading from earlier versions.
pub fn restore_legacy_hosts() -> Result<HostChange, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("UNHOOK_TEST_HOSTS").is_some() {
        return direct_change_hosts(None);
    }
    #[cfg(target_os = "macos")]
    {
        let service = crate::system_service::status();
        if service.state == "ready" || service.management == "installer" {
            return crate::system_service::change(None, None).map(|warning| HostChange { warning });
        }
    }
    direct_change_hosts(None)
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn elevate(domains: Option<&[String]>) -> Result<HostChange, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut command = format!(
        "{} --unhook-helper {}",
        shell_quote(&exe.to_string_lossy()),
        if domains.is_some() {
            "apply"
        } else {
            "restore"
        }
    );
    if let Some(domains) = domains {
        for domain in domains {
            command.push(' ');
            command.push_str(&shell_quote(domain));
        }
    }
    // AppleScript has a separate string grammar from the nested POSIX shell.
    let literal = command.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("do shell script \"{literal}\" with administrator privileges");
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Could not open the macOS administrator prompt: {e}"))?;
    parse_helper_output(output)
}

#[cfg(target_os = "linux")]
fn elevate(domains: Option<&[String]>) -> Result<HostChange, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut command = std::process::Command::new("pkexec");
    command
        .arg(exe)
        .arg("--unhook-helper")
        .arg(if domains.is_some() {
            "apply"
        } else {
            "restore"
        });
    if let Some(domains) = domains {
        command.args(domains);
    }
    let output = command.output().map_err(|e| format!("Administrator permission is needed. Install polkit/pkexec and run Unhook in a desktop session with an authentication agent. {e}"))?;
    parse_helper_output(output)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn elevate(_: Option<&[String]>) -> Result<HostChange, String> {
    Err("Administrator permission is needed. Relaunch Unhook using Run as administrator.".into())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_helper_output(output: std::process::Output) -> Result<HostChange, String> {
    if !output.status.success() {
        return Err(format!(
            "Administrator operation did not complete. {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Administrator helper returned an invalid result: {e}"))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn quotes_paths_containing_spaces_and_shell_metacharacters() {
        assert_eq!(
            shell_quote("/Applications/O'Brien $(touch x).app"),
            "'/Applications/O'\\''Brien $(touch x).app'"
        );
    }
}
