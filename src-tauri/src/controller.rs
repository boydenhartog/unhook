use crate::{
    privilege::{change_hosts, HostChange},
    session::{Desired, Persisted, Settings},
};
use chrono::{DateTime, Local};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use unhook_core::HostsStatus;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub settings: Settings,
    pub active: bool,
    pub source: Option<&'static str>,
    pub ends_at: Option<i64>,
    pub remaining_seconds: u64,
    pub warning: Option<String>,
    pub error: Option<String>,
    pub hosts_path: String,
}

pub trait Hosts: Send {
    fn inspect(&self) -> Result<HostsStatus, String>;
    fn change(&self, domains: Option<&[String]>) -> Result<HostChange, String>;
    fn path(&self) -> PathBuf;
}
pub struct NativeHosts;
impl Hosts for NativeHosts {
    fn inspect(&self) -> Result<HostsStatus, String> {
        crate::privilege::native_manager()
            .status()
            .map_err(|e| e.to_string())
    }
    fn change(&self, domains: Option<&[String]>) -> Result<HostChange, String> {
        change_hosts(domains)
    }
    fn path(&self) -> PathBuf {
        crate::privilege::native_manager().path().to_owned()
    }
}

pub struct Controller {
    pub persisted: Persisted,
    store: PathBuf,
    hosts: Box<dyn Hosts>,
    actual: Option<Desired>,
    active: bool,
    domains: Vec<String>,
    warning: Option<String>,
    error: Option<String>,
    failed_target: Option<String>,
}
impl Controller {
    pub fn load(store: PathBuf, hosts: Box<dyn Hosts>) -> Self {
        let (persisted, warning) = match fs::read(&store) {
            Ok(bytes) => match serde_json::from_slice::<Persisted>(&bytes).and_then(|mut state| {
                state.settings = state.settings.validated().map_err(serde::de::Error::custom)?;
                Ok(state)
            }) {
                Ok(state) => (state, None),
                Err(error) => (Persisted::default(), Some(format!("Saved settings could not be loaded; defaults are shown. The original file was retained. {error}"))),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Persisted::default(), None),
            Err(error) => (Persisted::default(), Some(format!("Saved settings could not be read: {error}"))),
        };
        let mut this = Self {
            persisted,
            store,
            hosts,
            actual: None,
            active: false,
            domains: vec![],
            warning,
            error: None,
            failed_target: None,
        };
        match this.hosts.inspect() {
            Ok(status) => {
                this.active = status.active;
                this.domains = status.domains;
            }
            Err(error) => {
                // Unknown hosts state must never be represented as safely restored.
                this.active = true;
                this.error = Some(error);
            }
        }
        this
    }
    pub fn status(&self, now: DateTime<Local>) -> AppStatus {
        let ends_at = self.actual.as_ref().map(|desired| desired.ends_at);
        AppStatus {
            settings: self.persisted.settings.clone(),
            active: self.active,
            source: self.actual.as_ref().map(|desired| desired.source),
            ends_at,
            remaining_seconds: ends_at
                .map(|end| ((end - now.timestamp_millis()).max(0) as u64).div_ceil(1000))
                .unwrap_or(0),
            warning: self.warning.clone(),
            error: self.error.clone(),
            hosts_path: self.hosts.path().display().to_string(),
        }
    }
    pub fn reconcile(&mut self, now: DateTime<Local>) {
        match self.hosts.inspect() {
            Ok(status) => {
                self.active = status.active;
                self.domains = status.domains;
                if !self.active {
                    self.actual = None;
                }
            }
            Err(error) => {
                // A malformed or unreadable hosts file has an unknown state. Keep
                // recovery visible and never report that websites are restored.
                self.active = true;
                self.error = Some(error);
                return;
            }
        }
        let desired = self.persisted.desired(now);
        let target_domains = if desired.is_some() {
            self.persisted.settings.domains.as_slice()
        } else {
            &[]
        };
        let target = format!("{:?}:{:?}", desired, target_domains);
        let matches = self.active == desired.is_some()
            && (!self.active || self.domains == self.persisted.settings.domains);
        if matches {
            self.actual = desired;
            if self.failed_target.is_some() {
                self.failed_target = None;
                self.error = None;
            }
            return;
        }
        if self.failed_target.as_ref() == Some(&target) {
            return;
        }
        let domains = desired
            .as_ref()
            .map(|_| self.persisted.settings.domains.as_slice());
        match self.hosts.change(domains) {
            Ok(change) => {
                self.active = desired.is_some();
                self.domains = domains.unwrap_or_default().to_vec();
                self.actual = desired;
                self.warning = change.warning;
                self.error = None;
                self.failed_target = None;
            }
            Err(error) => {
                // A directory-sync or DNS/helper transport error can occur after the
                // hosts replacement. Re-read before reporting the actual state.
                if let Ok(status) = self.hosts.inspect() {
                    self.active = status.active;
                    self.domains = status.domains;
                    if !self.active {
                        self.actual = None;
                    } else if desired.is_some() && self.domains == self.persisted.settings.domains {
                        self.actual = desired;
                    }
                }
                self.error = Some(error);
                self.failed_target = Some(target);
            }
        }
    }
    fn update(&mut self, next: Persisted, now: DateTime<Local>) -> Result<AppStatus, String> {
        // Persist intent first so a crash between the hosts write and the UI response
        // still has a deadline for recovery. No privileged process touches this file.
        save(&self.store, &next)?;
        let old = std::mem::replace(&mut self.persisted, next);
        self.failed_target = None;
        self.error = None;
        self.reconcile(now);
        if let Some(error) = self.error.clone() {
            self.persisted = old;
            if let Err(rollback) = save(&self.store, &self.persisted) {
                self.error = Some(format!("{error} Settings rollback also failed: {rollback}"));
            }
            return Err(self.error.clone().unwrap_or(error));
        }
        Ok(self.status(now))
    }
    pub fn save_settings(
        &mut self,
        settings: Settings,
        now: DateTime<Local>,
    ) -> Result<AppStatus, String> {
        let mut next = self.persisted.clone();
        next.settings = settings.validated()?;
        if next.settings.domains.is_empty()
            && next
                .manual_until
                .is_some_and(|end| end > now.timestamp_millis())
        {
            return Err("Stop focus before removing the final website.".into());
        }
        self.update(next, now)
    }
    pub fn start(&mut self, minutes: u32, now: DateTime<Local>) -> Result<AppStatus, String> {
        if !(1..=1440).contains(&minutes) {
            return Err("Choose a duration between 1 and 1,440 minutes.".into());
        }
        if self.persisted.settings.domains.is_empty() {
            return Err("Add at least one website before starting focus.".into());
        }
        let mut next = self.persisted.clone();
        next.manual_until = Some(now.timestamp_millis() + minutes as i64 * 60_000);
        self.update(next, now)
    }
    pub fn stop(&mut self, now: DateTime<Local>) -> Result<AppStatus, String> {
        let mut next = self.persisted.clone();
        next.stop(now);
        self.update(next, now)
    }
}
fn save(path: &Path, state: &Persisted) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid settings location.")?;
    fs::create_dir_all(parent).map_err(|e| format!("Could not create settings folder: {e}"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Could not prepare settings: {e}"))?;
    serde_json::to_writer_pretty(temp.as_file_mut(), state)
        .map_err(|e| format!("Could not serialize settings: {e}"))?;
    temp.as_file_mut()
        .write_all(b"\n")
        .map_err(|e| format!("Could not write settings: {e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("Could not save settings: {e}"))?;
    temp.persist(path)
        .map_err(|e| format!("Could not replace settings: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    struct FixtureHosts {
        active: Arc<Mutex<bool>>,
        fail: bool,
    }
    impl Hosts for FixtureHosts {
        fn inspect(&self) -> Result<HostsStatus, String> {
            Ok(HostsStatus {
                active: *self.active.lock().unwrap(),
                domains: vec![],
            })
        }
        fn change(&self, domains: Option<&[String]>) -> Result<HostChange, String> {
            if self.fail {
                return Err("permission cancelled".into());
            }
            *self.active.lock().unwrap() = domains.is_some();
            Ok(HostChange { warning: None })
        }
        fn path(&self) -> PathBuf {
            PathBuf::from("test-fixture-hosts")
        }
    }
    #[test]
    fn failed_restore_preserves_active_status_and_persisted_intent() {
        let dir = tempfile::tempdir().unwrap();
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(FixtureHosts {
                active: Arc::new(Mutex::new(true)),
                fail: true,
            }),
        );
        let now = Local::now();
        controller.persisted.manual_until = Some(now.timestamp_millis() + 60_000);
        assert!(controller.stop(now).is_err());
        assert!(controller.status(now).active);
        assert!(controller.persisted.manual_until.is_some());
        assert!(controller.status(now).error.is_some());
    }
    #[test]
    fn startup_recovers_stale_hosts_without_valid_session() {
        let dir = tempfile::tempdir().unwrap();
        let active = Arc::new(Mutex::new(true));
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(FixtureHosts {
                active: active.clone(),
                fail: false,
            }),
        );
        controller.reconcile(Local::now());
        assert!(!*active.lock().unwrap());
        assert!(!controller.status(Local::now()).active);
    }
    #[test]
    fn persistence_failure_never_mutates_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let active = Arc::new(Mutex::new(false));
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(FixtureHosts {
                active: active.clone(),
                fail: false,
            }),
        );
        fs::create_dir(controller.store.clone()).unwrap();
        assert!(controller.start(25, Local::now()).is_err());
        assert!(!*active.lock().unwrap());
    }
    struct CountingHosts {
        manager: unhook_core::HostsManager,
        writes: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl Hosts for CountingHosts {
        fn inspect(&self) -> Result<HostsStatus, String> {
            self.manager.status().map_err(|e| e.to_string())
        }
        fn change(&self, domains: Option<&[String]>) -> Result<HostChange, String> {
            self.writes
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            match domains {
                Some(domains) => self.manager.apply(domains),
                None => self.manager.restore(),
            }
            .map(|outcome| HostChange {
                warning: outcome.warning,
            })
            .map_err(|e| e.to_string())
        }
        fn path(&self) -> PathBuf {
            self.manager.path().to_owned()
        }
    }
    #[test]
    fn default_focus_does_not_rewrite_hosts_on_every_scheduler_tick() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hosts");
        fs::write(&path, "127.0.0.1 localhost\n").unwrap();
        let writes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(CountingHosts {
                manager: unhook_core::HostsManager::new(path),
                writes: writes.clone(),
            }),
        );
        let now = Local::now();
        controller.start(25, now).unwrap();
        controller.reconcile(now);
        controller.reconcile(now);
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
    #[test]
    fn expired_manual_session_restores_hosts_in_background() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hosts");
        fs::write(&path, "127.0.0.1 localhost\n").unwrap();
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(CountingHosts {
                manager: unhook_core::HostsManager::new(path.clone()),
                writes: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            }),
        );
        let now = Local::now();
        controller.start(1, now).unwrap();
        controller.reconcile(now + chrono::Duration::seconds(61));
        assert!(
            !controller
                .status(now + chrono::Duration::seconds(61))
                .active
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "127.0.0.1 localhost\n");
    }
    #[test]
    fn failed_background_restore_does_not_repeat_authorization_prompt() {
        struct FailingHosts {
            attempts: Arc<std::sync::atomic::AtomicUsize>,
        }
        impl Hosts for FailingHosts {
            fn inspect(&self) -> Result<HostsStatus, String> {
                Ok(HostsStatus {
                    active: true,
                    domains: vec![],
                })
            }
            fn change(&self, _: Option<&[String]>) -> Result<HostChange, String> {
                self.attempts
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Err("authorization cancelled".into())
            }
            fn path(&self) -> PathBuf {
                PathBuf::from("fixture")
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(FailingHosts {
                attempts: attempts.clone(),
            }),
        );
        let now = Local::now();
        controller.reconcile(now);
        controller.reconcile(now + chrono::Duration::seconds(1));
        controller.reconcile(now + chrono::Duration::seconds(2));
        assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(controller.status(now).active);
        assert!(controller.stop(now).is_err());
        assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
}
