use crate::{Error, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Schedule {
    pub enabled: bool,
    pub days: Vec<u32>,
    pub start: String,
    pub end: String,
    pub break_enabled: bool,
    pub break_start: String,
    pub break_end: String,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: false,
            days: vec![0, 1, 2, 3, 4],
            start: "09:00".into(),
            end: "17:00".into(),
            break_enabled: true,
            break_start: "12:30".into(),
            break_end: "13:00".into(),
        }
    }
}

pub fn parse_time(value: &str) -> Result<u16> {
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || ![bytes[0], bytes[1], bytes[3], bytes[4]]
            .iter()
            .all(u8::is_ascii_digit)
    {
        return Err(Error::new(
            "Schedule times must use HH:mm (for example 09:00).".into(),
        ));
    }
    let hour = (bytes[0] - b'0') as u16 * 10 + (bytes[1] - b'0') as u16;
    let minute = (bytes[3] - b'0') as u16 * 10 + (bytes[4] - b'0') as u16;
    if hour > 23 || minute > 59 {
        return Err(Error::new("Schedule time is outside 00:00–23:59.".into()));
    }
    Ok(hour * 60 + minute)
}
impl Schedule {
    pub fn validate(&self) -> Result<()> {
        if self.days.is_empty()
            || self.days.iter().any(|day| *day > 6)
            || self
                .days
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.days.len()
        {
            return Err(Error::new(
                "Select at least one weekday (Monday = 0 through Sunday = 6).".into(),
            ));
        }
        let start = parse_time(&self.start)?;
        let end = parse_time(&self.end)?;
        if start >= end {
            return Err(Error::new(
                "The schedule end must follow its start on the same day.".into(),
            ));
        }
        if self.break_enabled {
            let break_start = parse_time(&self.break_start)?;
            let break_end = parse_time(&self.break_end)?;
            if break_start <= start || break_end >= end || break_start >= break_end {
                return Err(Error::new(
                    "The break must fall strictly inside the focus window and end after it starts."
                        .into(),
                ));
            }
        }
        Ok(())
    }
    pub fn is_active(&self, day: u32, minute: u16) -> bool {
        self.active_until_minute(day, minute).is_some()
    }
    /// End of the active continuous segment, in local minutes since midnight.
    pub fn active_until_minute(&self, day: u32, minute: u16) -> Option<u16> {
        if !self.enabled || self.validate().is_err() || !self.days.contains(&day) {
            return None;
        }
        let (start, end) = (parse_time(&self.start).ok()?, parse_time(&self.end).ok()?);
        if minute < start || minute >= end {
            return None;
        }
        if self.break_enabled {
            let (break_start, break_end) = (
                parse_time(&self.break_start).ok()?,
                parse_time(&self.break_end).ok()?,
            );
            if minute >= break_start && minute < break_end {
                return None;
            }
            if minute < break_start {
                return Some(break_start);
            }
        }
        Some(end)
    }
}
