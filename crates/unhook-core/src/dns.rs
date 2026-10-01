use std::{path::PathBuf, process::Command};

pub fn system_hosts_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32")
            .join("drivers")
            .join("etc")
            .join("hosts")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/etc/hosts")
    }
}

fn run(program: &str, args: &[&str]) -> std::result::Result<(), String> {
    match Command::new(program).args(args).output() {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "{program} failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(error) => Err(format!("{program}: {error}")),
    }
}

/// Flush the native resolver; failure is a warning because the hosts write already succeeded.
/// Browsers with their own resolver/cache and existing connections may need a reload.
pub fn flush_dns() -> Option<String> {
    #[cfg(target_os = "windows")]
    let result = run("ipconfig", &["/flushdns"]);
    #[cfg(target_os = "macos")]
    let result = {
        let first = run("/usr/bin/dscacheutil", &["-flushcache"]);
        let second = run("/usr/bin/killall", &["-HUP", "mDNSResponder"]);
        first.and(second)
    };
    #[cfg(target_os = "linux")]
    let result = {
        // Linux distributions use different resolver services. A successful native flush
        // is sufficient; report all attempts when none is available.
        let mut failures = Vec::new();
        let mut success = false;
        for (program, args) in [
            ("resolvectl", vec!["flush-caches"]),
            ("systemd-resolve", vec!["--flush-caches"]),
            ("nscd", vec!["-i", "hosts"]),
        ] {
            match run(program, &args) {
                Ok(()) => {
                    success = true;
                    break;
                }
                Err(error) => failures.push(error),
            }
        }
        if success {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let result: std::result::Result<(), String> = Err("Unsupported resolver platform.".into());
    result.err().map(|error|format!("Hosts entries were updated, but DNS cache flushing failed: {error}. Reload the page; some browsers maintain their own DNS caches."))
}
