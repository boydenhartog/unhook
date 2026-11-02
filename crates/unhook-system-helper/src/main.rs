//! A launchd-owned endpoint with no caller-selectable paths or shell commands.
#[cfg(any(target_os = "macos", all(test, unix)))]
mod installed;
#[cfg(all(test, target_os = "macos"))]
mod native_tests;
#[cfg(any(target_os = "macos", test))]
use serde::Deserialize;
#[cfg(target_os = "macos")]
use serde::Serialize;
#[cfg(any(target_os = "macos", test))]
use unhook_core::{normalize_domains, HostsManager, WriteOutcome};

#[cfg(any(target_os = "macos", test))]
const MAX_REQUEST: usize = 128 * 1024;
#[cfg(any(target_os = "macos", test))]
const MAX_LEASE_SECONDS: i64 = 15;

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Apply {
        domains: Vec<String>,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
    },
    Restore {},
    Ping {},
    Uninstall {},
}

#[cfg(target_os = "macos")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    ok: bool,
    warning: Option<String>,
    error: Option<String>,
}

#[cfg(any(target_os = "macos", test))]
struct Service {
    hosts: HostsManager,
    expires_at: Option<i64>,
    lease_expires: Option<std::time::Instant>,
    fixture: bool,
}

#[cfg(any(target_os = "macos", test))]
impl Service {
    fn outcome(&self, outcome: WriteOutcome) -> Option<String> {
        let mut warnings: Vec<String> = outcome.warning.into_iter().collect();
        if outcome.changed && !self.fixture {
            warnings.extend(unhook_core::flush_dns());
        }
        if warnings.is_empty() {
            None
        } else {
            Some(warnings.join(" "))
        }
    }

    fn handle(&mut self, request: Request, now: i64) -> Result<Option<String>, String> {
        match request {
            Request::Ping {} => Ok(None),
            // File removal belongs to the installed daemon after successful restore.
            Request::Uninstall {} => Err("Uninstall requires the installed system service.".into()),
            Request::Restore {} => {
                let outcome = self.hosts.restore().map_err(|e| e.to_string())?;
                self.expires_at = None;
                self.lease_expires = None;
                Ok(self.outcome(outcome))
            }
            Request::Apply {
                domains,
                expires_at,
            } => {
                if domains.is_empty() || domains.len() > 500 {
                    return Err("Expected between 1 and 500 domains.".into());
                }
                let canonical = normalize_domains(&domains).map_err(|e| e.to_string())?;
                if canonical != domains {
                    return Err("Domains must be canonical, unique, and sorted.".into());
                }
                if expires_at <= now || expires_at > now.saturating_add(MAX_LEASE_SECONDS) {
                    return Err(
                        "System blocking requires a live lease of at most 15 seconds.".into(),
                    );
                }
                // A write can complete before an I/O error is reported. Arm recovery
                // before mutation so even that partial success has a bounded lease.
                self.expires_at = Some(expires_at);
                self.lease_expires = std::time::Instant::now()
                    .checked_add(std::time::Duration::from_secs((expires_at - now) as u64));
                let outcome = self.hosts.apply(&domains).map_err(|e| e.to_string())?;
                Ok(self.outcome(outcome))
            }
        }
    }

    fn initialize(
        &mut self,
        now: i64,
        validate: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        // Restoring fixed owned entries needs no client authority. Even damaged
        // installation pins must never prevent crash recovery.
        self.handle(Request::Restore {}, now)?;
        validate()
    }

    fn uninstall(
        &mut self,
        now: i64,
        remove: impl FnOnce() -> Result<(), String>,
    ) -> Result<Option<String>, String> {
        let warning = self.handle(Request::Restore {}, now)?;
        remove()?;
        Ok(warning)
    }

    fn expire(&mut self, now: i64) -> Result<(), String> {
        if self.expires_at.is_some_and(|deadline| deadline <= now)
            || self
                .lease_expires
                .is_some_and(|deadline| deadline <= std::time::Instant::now())
        {
            self.handle(Request::Restore {}, now)?;
        }
        Ok(())
    }
}

#[cfg(any(target_os = "macos", test))]
fn parse(bytes: &[u8]) -> Result<Request, String> {
    if bytes.len() > MAX_REQUEST {
        return Err("Request is too large.".into());
    }
    serde_json::from_slice(bytes).map_err(|_| "Invalid system blocker request.".into())
}

#[cfg(target_os = "macos")]
mod daemon {
    use super::*;
    use std::{
        io::{Read, Write},
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::net::UnixListener,
        },
        sync::atomic::{AtomicBool, Ordering},
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    static QUIT: AtomicBool = AtomicBool::new(false);
    extern "C" {
        fn launch_activate_socket(
            name: *const libc::c_char,
            sockets: *mut *mut libc::c_int,
            count: *mut libc::size_t,
        ) -> libc::c_int;
        fn unhook_authenticate_peer(socket: libc::c_int) -> libc::c_int;
        fn unhook_authenticate_installed_peer(
            socket: libc::c_int,
            pins: *const libc::c_char,
        ) -> libc::c_int;
    }
    extern "C" fn shutdown(_: libc::c_int) {
        QUIT.store(true, Ordering::Relaxed);
    }
    fn now() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }

    #[cfg(test)]
    #[test]
    fn unsigned_peer_is_never_authorized() {
        let (stream, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        assert_eq!(unsafe { unhook_authenticate_peer(stream.as_raw_fd()) }, 0);
    }

    pub fn run(installed_mode: bool) -> Result<(), String> {
        if unsafe { libc::geteuid() } != 0 {
            return Err("System helper must be started by launchd as root.".into());
        }
        let mut service = Service {
            hosts: HostsManager::system(),
            expires_at: None,
            lease_expires: None,
            fixture: false,
        };
        service.initialize(now(), || {
            if installed_mode {
                installed::read_pins().map(|_| ())
            } else {
                Ok(())
            }
        })?;
        let mut sockets = std::ptr::null_mut();
        let mut count = 0;
        // SAFETY: The socket name is NUL-terminated, and both output pointers
        // refer to live variables for the duration of the call.
        let code = unsafe { launch_activate_socket(c"Control".as_ptr(), &mut sockets, &mut count) };
        if code != 0 || count != 1 {
            return Err("Missing launchd control socket.".into());
        }
        // SAFETY: Successful activation returns an allocated array of `count`
        // socket descriptors. The sole descriptor is transferred exactly once
        // to the listener, which owns closing it.
        let listener = unsafe { UnixListener::from_raw_fd(*sockets) };
        // SAFETY: launch_activate_socket requires the caller to free its heap
        // array. Freeing the array does not close the transferred descriptor.
        unsafe {
            libc::free(sockets.cast());
        }
        // SAFETY: The handler has the required C ABI and a static lifetime. It
        // only stores to an atomic flag; it does not allocate or acquire locks.
        unsafe {
            libc::signal(libc::SIGTERM, shutdown as *const () as libc::sighandler_t);
            libc::signal(libc::SIGINT, shutdown as *const () as libc::sighandler_t);
        }
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        while !QUIT.load(Ordering::Relaxed) {
            if let Err(error) = service.expire(now()) {
                eprintln!("Could not restore expired Unhook entries: {error}");
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let authenticated = if installed_mode {
                        installed::read_pins().is_ok_and(|pins| unsafe {
                            unhook_authenticate_installed_peer(stream.as_raw_fd(), pins.as_ptr())
                                == 1
                        })
                    } else {
                        unsafe { unhook_authenticate_peer(stream.as_raw_fd()) == 1 }
                    };
                    if !authenticated {
                        continue;
                    }
                    if stream
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .is_err()
                        || stream
                            .set_write_timeout(Some(Duration::from_secs(1)))
                            .is_err()
                    {
                        continue;
                    }
                    let mut bytes = Vec::new();
                    let mut uninstall = false;
                    let result = (&mut stream)
                        .take((MAX_REQUEST + 1) as u64)
                        .read_to_end(&mut bytes)
                        .map_err(|e| e.to_string())
                        .and_then(|_| parse(&bytes))
                        .and_then(|request| {
                            if matches!(request, Request::Uninstall {}) && installed_mode {
                                let warning = service.uninstall(now(), installed::remove_files)?;
                                uninstall = true;
                                Ok(warning)
                            } else {
                                service.handle(request, now())
                            }
                        });
                    let response = match result {
                        Ok(warning) => Response {
                            ok: true,
                            warning,
                            error: None,
                        },
                        Err(error) => Response {
                            ok: false,
                            warning: None,
                            error: Some(error),
                        },
                    };
                    if let Ok(response) = serde_json::to_vec(&response) {
                        let _ = stream.write_all(&response);
                    }
                    drop(stream); // Deliver response EOF before launchd waits for shutdown.
                    if uninstall {
                        // Fixed executable and arguments; never accept commands from IPC.
                        let status = std::process::Command::new("/bin/launchctl")
                            .args(["bootout", "system/org.unhook.installed-system-helper"])
                            .status()
                            .map_err(|e| e.to_string())?;
                        if !status.success() {
                            eprintln!("Installed service files removed; launchd bootout failed.");
                        }
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        service.handle(Request::Restore {}, now())?;
        Ok(())
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    {
        let args: Vec<_> = std::env::args().skip(1).collect();
        let result = match args.as_slice() {
            [] => daemon::run(false),
            [mode] if mode == "--installed" => daemon::run(true),
            [mode] if mode == "--restore-installed" && unsafe { libc::geteuid() } == 0 => {
                // Installer-only fixed target recovery. No fixture/environment paths.
                HostsManager::system()
                    .restore()
                    .map(|outcome| {
                        if outcome.changed {
                            if let Some(warning) = unhook_core::flush_dns() {
                                eprintln!("{warning}");
                            }
                        }
                    })
                    .map_err(|e| e.to_string())
            }
            _ => Err("Invalid system helper mode or root authorization.".into()),
        };
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("The system helper is supported only on macOS.");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Service) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hosts");
        std::fs::write(
            &path,
            "127.0.0.1 localhost\n# User record\n192.0.2.3 example.test\n",
        )
        .unwrap();
        let service = Service {
            hosts: HostsManager::new(path),
            expires_at: None,
            lease_expires: None,
            fixture: true,
        };
        (directory, service)
    }
    #[test]
    fn startup_restores_stale_blocks_even_when_installation_pins_are_invalid() {
        let (_directory, mut service) = fixture();
        service
            .handle(
                Request::Apply {
                    domains: vec!["marktplaats.nl".into()],
                    expires_at: 115,
                },
                100,
            )
            .unwrap();
        assert!(service
            .initialize(105, || Err("damaged protected pins".into()))
            .is_err());
        assert!(!service.hosts.status().unwrap().active);
        assert_eq!(service.expires_at, None);
    }
    #[test]
    fn uninstall_never_removes_assets_if_restore_fails() {
        let (_directory, mut service) = fixture();
        std::fs::write(service.hosts.path(), "# BEGIN UNHOOK\nmalformed").unwrap();
        let mut removed = false;
        assert!(service
            .uninstall(100, || {
                removed = true;
                Ok(())
            })
            .is_err());
        assert!(!removed);
    }
    #[test]
    fn uninstall_restores_before_removal_and_retains_failure() {
        let (_directory, mut service) = fixture();
        service
            .handle(
                Request::Apply {
                    domains: vec!["marktplaats.nl".into()],
                    expires_at: 115,
                },
                100,
            )
            .unwrap();
        let hosts = service.hosts.path().to_path_buf();
        assert!(service
            .uninstall(105, || {
                assert!(!std::fs::read_to_string(hosts)
                    .unwrap()
                    .contains("# BEGIN UNHOOK"));
                Err("removal refused".into())
            })
            .is_err());
        assert_eq!(service.expires_at, None);
        assert!(!service.hosts.status().unwrap().active);
    }
    #[test]
    fn uninstall_is_a_bounded_fixed_operation() {
        assert!(parse(br#"{"type":"uninstall"}"#).is_ok());
        assert!(parse(br#"{"type":"uninstall","path":"/tmp/file"}"#).is_err());
    }
    #[test]
    fn refuses_extra_fields_arbitrary_commands_and_oversized_requests() {
        assert!(parse(br#"{"type":"restore","path":"/tmp/hosts"}"#).is_err());
        assert!(parse(br#"{"type":"shell","command":"id"}"#).is_err());
        assert!(parse(&vec![b' '; MAX_REQUEST + 1]).is_err());
    }
    #[test]
    fn leases_expire_and_preserve_unowned_records() {
        let (_directory, mut service) = fixture();
        let original = std::fs::read(service.hosts.path()).unwrap();
        service
            .handle(
                Request::Apply {
                    domains: vec!["marktplaats.nl".into()],
                    expires_at: 115,
                },
                100,
            )
            .unwrap();
        assert!(service.hosts.status().unwrap().active);
        service.expire(114).unwrap();
        assert!(service.hosts.status().unwrap().active);
        service.expire(115).unwrap();
        assert_eq!(std::fs::read(service.hosts.path()).unwrap(), original);
    }
    #[test]
    fn refuses_noncanonical_and_unbounded_intent_before_mutation() {
        let (_directory, mut service) = fixture();
        for (domains, expires_at) in [
            (vec!["www.marktplaats.nl".into()], 110),
            (vec!["marktplaats.nl".into()], 116),
            (vec!["marktplaats.nl".into()], 100),
            (vec![], 110),
        ] {
            assert!(service
                .handle(
                    Request::Apply {
                        domains,
                        expires_at
                    },
                    100
                )
                .is_err());
            assert!(!service.hosts.status().unwrap().active);
        }
    }
    #[test]
    fn backwards_wall_clock_does_not_extend_the_lease() {
        let (_directory, mut service) = fixture();
        service
            .handle(
                Request::Apply {
                    domains: vec!["marktplaats.nl".into()],
                    expires_at: 115,
                },
                100,
            )
            .unwrap();
        service.lease_expires = Some(std::time::Instant::now());
        service.expire(1).unwrap();
        assert!(!service.hosts.status().unwrap().active);
    }
    #[test]
    fn write_failure_still_arms_recovery() {
        let (_directory, mut service) = fixture();
        std::fs::write(service.hosts.path(), "# BEGIN UNHOOK\nmalformed").unwrap();
        assert!(service
            .handle(
                Request::Apply {
                    domains: vec!["marktplaats.nl".into()],
                    expires_at: 115
                },
                100
            )
            .is_err());
        assert_eq!(service.expires_at, Some(115));
        assert!(service.lease_expires.is_some());
    }
    #[test]
    fn refresh_extends_only_the_short_lease() {
        let (_directory, mut service) = fixture();
        for (now, expires_at) in [(100, 115), (105, 120)] {
            service
                .handle(
                    Request::Apply {
                        domains: vec!["marktplaats.nl".into()],
                        expires_at,
                    },
                    now,
                )
                .unwrap();
        }
        service.expire(115).unwrap();
        assert!(service.hosts.status().unwrap().active);
        service.expire(120).unwrap();
        assert!(!service.hosts.status().unwrap().active);
    }
}
