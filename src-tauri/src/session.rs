#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};
    fn monday(hour: u32, minute: u32) -> chrono::DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 10, 5, hour, minute, 0)
            .single()
            .unwrap()
    }
    #[test]
    fn manual_session_overrides_schedule_break() {
        let mut state = Persisted::default();
        state.settings.schedule.enabled = true;
        state.manual_until = Some(monday(13, 15).timestamp_millis());
        assert_eq!(state.desired(monday(12, 45)).unwrap().source, "manual");
    }
    #[test]
    fn stopping_schedule_suppresses_both_sides_of_break() {
        let mut state = Persisted::default();
        state.settings.schedule.enabled = true;
        state.stop(monday(10, 0));
        assert!(state.desired(monday(11, 0)).is_none());
        assert!(state.desired(monday(13, 30)).is_none());
        assert!(state
            .desired(
                Local
                    .with_ymd_and_hms(2026, 10, 6, 10, 0, 0)
                    .single()
                    .unwrap()
            )
            .is_some());
    }
    #[test]
    fn schedule_timer_ends_at_break_start_and_resumes_after_break() {
        let mut state = Persisted::default();
        state.settings.schedule.enabled = true;
        assert_eq!(
            state.desired(monday(10, 0)).unwrap().ends_at,
            monday(12, 30).timestamp_millis()
        );
        assert!(state.desired(monday(12, 45)).is_none());
        assert_eq!(
            state.desired(monday(13, 0)).unwrap().ends_at,
            monday(17, 0).timestamp_millis()
        );
    }
    #[test]
    fn expired_manual_session_does_not_claim_focus() {
        let state = Persisted {
            manual_until: Some(monday(10, 0).timestamp_millis()),
            ..Persisted::default()
        };
        assert!(state.desired(monday(10, 0)).is_none());
    }
}

use chrono::{DateTime, Datelike, Local, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use unhook_core::{normalize_domains, Schedule};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub domains: Vec<String>,
    pub schedule: Schedule,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            domains: [
                "facebook.com",
                "instagram.com",
                "reddit.com",
                "x.com",
                "youtube.com",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            schedule: Schedule::default(),
        }
    }
}
impl Settings {
    pub fn validated(mut self) -> Result<Self, String> {
        if self.domains.len() > 500 {
            return Err("The blocklist supports at most 500 domains.".into());
        }
        self.domains = normalize_domains(&self.domains).map_err(|e| e.to_string())?;
        self.schedule.validate().map_err(|e| e.to_string())?;
        if self.schedule.enabled && self.domains.is_empty() {
            return Err("Add at least one website before enabling a schedule.".into());
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Persisted {
    pub settings: Settings,
    pub manual_until: Option<i64>,
    pub suppressed_until: Option<i64>,
    pub system_blocking_enabled: bool,
    pub setup_completed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Desired {
    pub source: &'static str,
    pub ends_at: i64,
}
impl Persisted {
    pub fn desired(&self, now: DateTime<Local>) -> Option<Desired> {
        if let Some(end) = self
            .manual_until
            .filter(|end| *end > now.timestamp_millis())
        {
            return Some(Desired {
                source: "manual",
                ends_at: end,
            });
        }
        if self
            .suppressed_until
            .is_some_and(|end| end > now.timestamp_millis())
        {
            return None;
        }
        let minute = (now.hour() * 60 + now.minute()) as u16;
        let end = self
            .settings
            .schedule
            .active_until_minute(now.weekday().num_days_from_monday(), minute)?;
        let ends_at = local_time(now, end)?;
        Some(Desired {
            source: "schedule",
            ends_at,
        })
    }
    pub fn stop(&mut self, now: DateTime<Local>) {
        self.manual_until = None;
        let schedule = &self.settings.schedule;
        let minute = (now.hour() * 60 + now.minute()) as u16;
        let parse = |time: &str| -> Option<u16> {
            let (h, m) = time.split_once(':')?;
            Some(h.parse::<u16>().ok()? * 60 + m.parse::<u16>().ok()?)
        };
        if schedule.enabled
            && schedule
                .days
                .contains(&now.weekday().num_days_from_monday())
        {
            if let (Some(start), Some(end)) = (parse(&schedule.start), parse(&schedule.end)) {
                if minute >= start && minute < end {
                    self.suppressed_until = local_time(now, end);
                }
            }
        }
    }
}
fn local_time(now: DateTime<Local>, minute: u16) -> Option<i64> {
    let local = now
        .date_naive()
        .and_hms_opt((minute / 60) as u32, (minute % 60) as u32, 0)?;
    Local
        .from_local_datetime(&local)
        .latest()
        .map(|date| date.timestamp_millis())
}
