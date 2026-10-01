use serde::{Deserialize, Serialize};

pub const BROWSER_EXTENSION_ORIGIN: &str = "chrome-extension://glcpihjbnhkbbdngjcmdgapodackkkmo/";
pub const BROWSER_HOST_NAME: &str = "org.unhook.browser";

/// Read-only snapshot owned by the desktop app. Browser rules have a deadline and
/// a short heartbeat lease so a stopped/crashed launcher cannot leave stale rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    pub version: u8,
    pub domains: Vec<String>,
    pub active: bool,
    pub ends_at: Option<i64>,
    pub updated_at: i64,
}

impl BrowserState {
    pub fn valid(&self) -> bool {
        self.version == 1
            && self.updated_at >= 0
            && self.domains.len() <= 500
            && (!self.active || self.ends_at.is_some_and(|end| end > 0))
            && crate::normalize_domains(&self.domains).is_ok_and(|domains| domains == self.domains)
    }
}
