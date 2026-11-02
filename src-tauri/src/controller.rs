use crate::{
    privilege::{change_hosts, HostChange},
    session::{Persisted, Settings},
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
    pub system_active: bool,
    pub source: Option<&'static str>,
    pub ends_at: Option<i64>,
    pub remaining_seconds: u64,
    pub warning: Option<String>,
    pub error: Option<String>,
    pub hosts_path: String,
}

pub trait Hosts: Send {
    fn inspect(&self) -> Result<HostsStatus, String>;
    fn change(
        &self,
        domains: Option<&[String]>,
        ends_at: Option<i64>,
    ) -> Result<HostChange, String>;
    fn restore(&self) -> Result<HostChange, String> {
        self.change(None, None)
    }
    fn refresh(&self, _: &[String], _: i64) -> Result<HostChange, String> {
        Ok(HostChange { warning: None })
    }
    fn path(&self) -> PathBuf;
}
pub struct NativeHosts;
impl Hosts for NativeHosts {
    fn inspect(&self) -> Result<HostsStatus, String> {
        crate::privilege::native_manager()
            .status()
            .map_err(|e| e.to_string())
    }
    fn change(
        &self,
        domains: Option<&[String]>,
        ends_at: Option<i64>,
    ) -> Result<HostChange, String> {
        change_hosts(domains, ends_at)
    }
    fn restore(&self) -> Result<HostChange, String> {
        crate::privilege::restore_legacy_hosts()
    }
    fn refresh(&self, domains: &[String], ends_at: i64) -> Result<HostChange, String> {
        crate::privilege::refresh_hosts(domains, ends_at)
    }
    fn path(&self) -> PathBuf {
        crate::privilege::native_manager().path().to_owned()
    }
}

pub struct Controller {
    pub persisted: Persisted,
    store: PathBuf,
    hosts: Box<dyn Hosts>,
    system_active: bool,
    domains: Vec<String>,
    warning: Option<String>,
    error: Option<String>,
    failed_target: Option<String>,
    last_refresh: Option<i64>,
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
            system_active: false,
            domains: vec![],
            warning,
            error: None,
            failed_target: None,
            last_refresh: None,
        };
        match this.hosts.inspect() {
            Ok(status) => {
                this.system_active = status.active;
                this.domains = status.domains;
            }
            Err(error) => {
                // Unknown hosts state must never be represented as safely restored.
                this.system_active = true;
                this.error = Some(error);
            }
        }
        this
    }
    pub fn status(&self, now: DateTime<Local>) -> AppStatus {
        let desired = self.persisted.desired(now);
        let ends_at = desired.as_ref().map(|desired| desired.ends_at);
        let mut warnings: Vec<String> = self.warning.clone().into_iter().collect();
        if !self.persisted.system_blocking_enabled && self.system_active {
            warnings.push("System blocking from an earlier session needs cleanup. Use Restore system access in setup; browser focus remains controlled by Unhook.".into());
        }
        AppStatus {
            settings: self.persisted.settings.clone(),
            active: desired.is_some(),
            system_active: self.system_active,
            source: desired.as_ref().map(|desired| desired.source),
            ends_at,
            remaining_seconds: ends_at
                .map(|end| ((end - now.timestamp_millis()).max(0) as u64).div_ceil(1000))
                .unwrap_or(0),
            warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
            error: self.error.clone(),
            hosts_path: self.hosts.path().display().to_string(),
        }
    }
    fn inspect_hosts(&mut self) -> Result<(), String> {
        match self.hosts.inspect() {
            Ok(status) => {
                self.system_active = status.active;
                self.domains = status.domains;
                Ok(())
            }
            Err(error) => {
                // Treat unreadable or malformed owned blocks as needing recovery.
                self.system_active = true;
                self.error = Some(error.clone());
                Err(error)
            }
        }
    }
    pub fn reconcile(&mut self, now: DateTime<Local>) {
        if self.inspect_hosts().is_err() {
            return;
        }
        // The browser companion handles focus by default. In particular, migration
        // must never trigger an administrator prompt to restore an older block.
        if !self.persisted.system_blocking_enabled {
            return;
        }
        let desired = self.persisted.desired(now);
        let target_domains = if desired.is_some() {
            self.persisted.settings.domains.as_slice()
        } else {
            &[]
        };
        let target = format!("{:?}:{:?}", desired, target_domains);
        let matches = self.system_active == desired.is_some()
            && (!self.system_active || self.domains == self.persisted.settings.domains);
        if matches {
            if let Some(desired) = desired.as_ref() {
                let refresh_due = self.last_refresh.is_none_or(|last| {
                    now.timestamp_millis() < last
                        || now.timestamp_millis().saturating_sub(last) >= 5_000
                });
                if refresh_due {
                    self.last_refresh = Some(now.timestamp_millis());
                    if let Err(error) = self.hosts.refresh(target_domains, desired.ends_at) {
                        self.error = Some(error);
                        return;
                    }
                }
            } else {
                self.last_refresh = None;
            }
            self.failed_target = None;
            self.error = None;
            return;
        }
        if self.failed_target.as_ref() == Some(&target) {
            return;
        }
        let domains = desired
            .as_ref()
            .map(|_| self.persisted.settings.domains.as_slice());
        match self
            .hosts
            .change(domains, desired.as_ref().map(|value| value.ends_at))
        {
            Ok(change) => {
                self.last_refresh = desired.as_ref().map(|_| now.timestamp_millis());
                self.system_active = desired.is_some();
                self.domains = domains.unwrap_or_default().to_vec();
                self.warning = change.warning;
                self.error = None;
                self.failed_target = None;
            }
            Err(error) => {
                // An operation can report transport/DNS failure after replacement.
                // Preserve actual system state independently from the focus timer.
                let _ = self.inspect_hosts();
                self.error = Some(error);
                self.failed_target = Some(target);
            }
        }
    }
    fn rollback(&mut self, old: Persisted, error: String) -> String {
        self.persisted = old;
        self.error = Some(error.clone());
        if let Err(rollback) = save(&self.store, &self.persisted) {
            self.error = Some(format!("{error} Settings rollback also failed: {rollback}"));
        }
        self.error.clone().unwrap_or(error)
    }
    fn update(&mut self, next: Persisted, now: DateTime<Local>) -> Result<AppStatus, String> {
        // Persist intent before privileged work so recovery retains a deadline.
        save(&self.store, &next)?;
        let old = std::mem::replace(&mut self.persisted, next);
        self.failed_target = None;
        self.error = None;
        self.reconcile(now);
        if self.persisted.system_blocking_enabled {
            if let Some(error) = self.error.clone() {
                return Err(self.rollback(old, error));
            }
        }
        Ok(self.status(now))
    }
    pub fn complete_setup(&mut self, now: DateTime<Local>) -> Result<AppStatus, String> {
        let mut next = self.persisted.clone();
        next.setup_completed = true;
        save(&self.store, &next)?;
        self.persisted = next;
        Ok(self.status(now))
    }
    pub fn set_system_blocking(
        &mut self,
        enabled: bool,
        now: DateTime<Local>,
    ) -> Result<AppStatus, String> {
        if !enabled {
            return self.restore_system_hosts(now);
        }
        let mut next = self.persisted.clone();
        next.system_blocking_enabled = true;
        self.update(next, now)
    }
    pub fn restore_system_hosts(&mut self, now: DateTime<Local>) -> Result<AppStatus, String> {
        let mut next = self.persisted.clone();
        next.system_blocking_enabled = false;
        save(&self.store, &next)?;
        let old = std::mem::replace(&mut self.persisted, next);
        self.failed_target = None;
        self.error = None;
        // This is an explicit user action; automatic browser-only reconciliation
        // never calls the legacy elevated restore path.
        match self.hosts.inspect() {
            Ok(status) if !status.active => {
                self.system_active = false;
                self.domains.clear();
                Ok(self.status(now))
            }
            _ => match self.hosts.restore() {
                Ok(change) => {
                    self.system_active = false;
                    self.domains.clear();
                    self.warning = change.warning;
                    Ok(self.status(now))
                }
                Err(error) => {
                    let _ = self.inspect_hosts();
                    Err(self.rollback(old, error))
                }
            },
        }
    }
    pub fn save_settings(
        &mut self,
        settings: Settings,
        now: DateTime<Local>,
    ) -> Result<AppStatus, String> {
        let mut next = self.persisted.clone();
        next.settings = settings.validated()?;
        if next.settings.schedule != self.persisted.settings.schedule {
            next.suppressed_until = None;
        }
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
        fn change(
            &self,
            domains: Option<&[String]>,
            _ends_at: Option<i64>,
        ) -> Result<HostChange, String> {
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
        controller.persisted.system_blocking_enabled = true;
        controller.persisted.manual_until = Some(now.timestamp_millis() + 60_000);
        assert!(controller.stop(now).is_err());
        assert!(controller.status(now).active);
        assert!(controller.persisted.manual_until.is_some());
        assert!(controller.status(now).error.is_some());
    }
    #[test]
    fn browser_mode_keeps_legacy_cleanup_explicit() {
        let dir = tempfile::tempdir().unwrap();
        let active = Arc::new(Mutex::new(true));
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(FixtureHosts {
                active: active.clone(),
                fail: false,
            }),
        );
        let now = Local::now();
        controller.reconcile(now);
        assert!(*active.lock().unwrap());
        assert!(!controller.status(now).active);
        assert!(controller.status(now).system_active);
        assert!(controller.status(now).warning.is_some());
        controller.restore_system_hosts(now).unwrap();
        assert!(!*active.lock().unwrap());
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
        fn change(
            &self,
            domains: Option<&[String]>,
            _ends_at: Option<i64>,
        ) -> Result<HostChange, String> {
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
    fn optional_system_focus_does_not_rewrite_hosts_on_every_scheduler_tick() {
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
        controller.set_system_blocking(true, now).unwrap();
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
        controller.set_system_blocking(true, now).unwrap();
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
            fn change(&self, _: Option<&[String]>, _: Option<i64>) -> Result<HostChange, String> {
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
        controller.persisted.system_blocking_enabled = true;
        controller.reconcile(now);
        controller.reconcile(now + chrono::Duration::seconds(1));
        controller.reconcile(now + chrono::Duration::seconds(2));
        assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(!controller.status(now).active);
        assert!(controller.status(now).system_active);
        assert!(controller.stop(now).is_err());
        assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
    fn counting_controller(dir: &Path) -> (Controller, Arc<std::sync::atomic::AtomicUsize>) {
        let path = dir.join("hosts");
        fs::write(&path, "127.0.0.1 localhost\n").unwrap();
        let writes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let controller = Controller::load(
            dir.join("settings.json"),
            Box::new(CountingHosts {
                manager: unhook_core::HostsManager::new(path),
                writes: writes.clone(),
            }),
        );
        (controller, writes)
    }
    #[test]
    fn saving_a_changed_schedule_resumes_a_stopped_window() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 10, 5, 10, 0, 0)
            .single()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let (mut controller, writes) = counting_controller(dir.path());
        let mut settings = controller.persisted.settings.clone();
        settings.schedule.enabled = true;
        controller.save_settings(settings.clone(), now).unwrap();
        controller.stop(now).unwrap();
        assert!(!controller.status(now).active);

        settings.schedule.enabled = false;
        controller.save_settings(settings.clone(), now).unwrap();
        settings.schedule.enabled = true;
        let resumed = controller.save_settings(settings, now).unwrap();
        assert_eq!(resumed.source, Some("schedule"));
        assert_eq!(resumed.remaining_seconds, 2 * 3600 + 30 * 60);
        let reloaded = Controller::load(
            controller.store.clone(),
            Box::new(FixtureHosts {
                active: Arc::new(Mutex::new(false)),
                fail: false,
            }),
        );
        assert_eq!(reloaded.status(now).source, Some("schedule"));
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
    #[test]
    fn blocklist_edits_preserve_the_stopped_schedule_window() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 10, 5, 10, 0, 0)
            .single()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let (mut controller, _) = counting_controller(dir.path());
        let mut settings = controller.persisted.settings.clone();
        settings.schedule.enabled = true;
        controller.save_settings(settings.clone(), now).unwrap();
        controller.stop(now).unwrap();
        settings.domains = vec!["marktplaats.nl".into()];
        assert!(!controller.save_settings(settings, now).unwrap().active);
        assert!(controller.persisted.suppressed_until.is_some());
    }
    #[test]
    fn browser_focus_start_edit_expire_stop_and_setup_never_write_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let (mut controller, writes) = counting_controller(dir.path());
        let now = Local::now();
        let started = controller.start(1, now).unwrap();
        assert!(started.active);
        assert!(!started.system_active);
        assert_eq!(started.source, Some("manual"));
        controller.complete_setup(now).unwrap();
        let mut settings = controller.persisted.settings.clone();
        settings.domains = vec!["marktplaats.nl".into()];
        controller.save_settings(settings, now).unwrap();
        controller.reconcile(now + chrono::Duration::seconds(61));
        assert!(
            !controller
                .status(now + chrono::Duration::seconds(61))
                .active
        );
        controller
            .stop(now + chrono::Duration::seconds(62))
            .unwrap();
        assert!(controller.persisted.setup_completed);
        let disk: Persisted =
            serde_json::from_slice(&fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
        assert!(disk.setup_completed);
        assert!(!disk.system_blocking_enabled);
        assert_eq!(disk.settings.domains, vec!["marktplaats.nl"]);
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
    #[test]
    fn disabling_system_layer_restores_hosts_and_keeps_browser_focus() {
        let dir = tempfile::tempdir().unwrap();
        let (mut controller, writes) = counting_controller(dir.path());
        let now = Local::now();
        controller.start(25, now).unwrap();
        let before = controller.status(now).ends_at;
        controller.set_system_blocking(true, now).unwrap();
        assert!(controller.status(now).system_active);
        let status = controller.set_system_blocking(false, now).unwrap();
        assert!(status.active);
        assert!(!status.system_active);
        assert_eq!(status.ends_at, before);
        controller.reconcile(now + chrono::Duration::seconds(6));
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
    #[test]
    fn failed_enable_retains_browser_session_and_rolls_back_mode_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut controller = Controller::load(
            path.clone(),
            Box::new(FixtureHosts {
                active: Arc::new(Mutex::new(false)),
                fail: true,
            }),
        );
        let now = Local::now();
        controller.start(25, now).unwrap();
        assert!(controller.set_system_blocking(true, now).is_err());
        assert!(controller.status(now).active);
        assert!(!controller.status(now).system_active);
        assert!(!controller.persisted.system_blocking_enabled);
        let disk: Persisted = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert!(!disk.system_blocking_enabled);
        assert_eq!(disk.manual_until, controller.persisted.manual_until);
    }
    #[test]
    fn old_settings_migrate_to_browser_mode_without_losing_session_or_schedule() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let now = Local::now();
        let mut old = Persisted::default();
        old.settings.domains = vec!["marktplaats.nl".into()];
        old.settings.schedule.enabled = true;
        old.manual_until = Some(now.timestamp_millis() + 60_000);
        let mut json = serde_json::to_value(&old).unwrap();
        json.as_object_mut()
            .unwrap()
            .remove("systemBlockingEnabled");
        json.as_object_mut().unwrap().remove("setupCompleted");
        fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
        let mut controller = Controller::load(
            path,
            Box::new(FixtureHosts {
                active: Arc::new(Mutex::new(false)),
                fail: true,
            }),
        );
        controller.reconcile(now);
        assert!(controller.status(now).active);
        assert!(!controller.persisted.system_blocking_enabled);
        assert!(!controller.persisted.setup_completed);
        assert_eq!(
            controller.persisted.settings.domains,
            vec!["marktplaats.nl"]
        );
        assert!(controller.persisted.settings.schedule.enabled);
        assert_eq!(controller.persisted.manual_until, old.manual_until);
    }
    #[test]
    fn system_lease_refreshes_without_rewriting_hosts_on_every_tick() {
        struct LeaseHosts {
            manager: unhook_core::HostsManager,
            refreshes: Arc<std::sync::atomic::AtomicUsize>,
        }
        impl Hosts for LeaseHosts {
            fn inspect(&self) -> Result<HostsStatus, String> {
                self.manager.status().map_err(|error| error.to_string())
            }
            fn change(
                &self,
                domains: Option<&[String]>,
                _: Option<i64>,
            ) -> Result<HostChange, String> {
                match domains {
                    Some(domains) => self.manager.apply(domains),
                    None => self.manager.restore(),
                }
                .map(|outcome| HostChange {
                    warning: outcome.warning,
                })
                .map_err(|error| error.to_string())
            }
            fn refresh(&self, _: &[String], _: i64) -> Result<HostChange, String> {
                self.refreshes
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(HostChange { warning: None })
            }
            fn path(&self) -> PathBuf {
                self.manager.path().to_owned()
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hosts");
        fs::write(&path, "127.0.0.1 localhost\n").unwrap();
        let refreshes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut controller = Controller::load(
            dir.path().join("settings.json"),
            Box::new(LeaseHosts {
                manager: unhook_core::HostsManager::new(path),
                refreshes: refreshes.clone(),
            }),
        );
        let now = Local::now();
        controller.set_system_blocking(true, now).unwrap();
        controller.start(25, now).unwrap();
        for seconds in 1..=11 {
            controller.reconcile(now + chrono::Duration::seconds(seconds));
        }
        assert_eq!(refreshes.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
    #[test]
    fn unknown_system_hosts_do_not_prevent_browser_only_focus() {
        struct UnreadableHosts;
        impl Hosts for UnreadableHosts {
            fn inspect(&self) -> Result<HostsStatus, String> {
                Err("Malformed owned hosts block; manual recovery required".into())
            }
            fn change(&self, _: Option<&[String]>, _: Option<i64>) -> Result<HostChange, String> {
                panic!("Browser-only focus must not attempt a hosts write");
            }
            fn path(&self) -> PathBuf {
                PathBuf::from("fixture")
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let mut controller =
            Controller::load(dir.path().join("settings.json"), Box::new(UnreadableHosts));
        let now = Local::now();
        let started = controller.start(25, now).unwrap();
        assert!(started.active);
        assert!(started.system_active);
        assert!(started.error.is_some());
        let stopped = controller.stop(now).unwrap();
        assert!(!stopped.active);
        assert!(stopped.system_active);
        assert!(stopped.error.is_some());
    }
}
