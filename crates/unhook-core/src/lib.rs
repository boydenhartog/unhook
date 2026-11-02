//! Byte-preserving hosts edits owned by Unhook, validated domains, and weekly schedules.
//!
//! A dedicated marker parser is intentional: general hosts-file serializers can rewrite
//! comments, spacing, encodings, and unrelated records. Unhook only owns its marked range.
mod browser;
mod dns;
mod hosts;
mod schedule;

pub use browser::{
    browser_ack_compatible, BrowserState, BROWSER_ACK_PROTOCOL_VERSION, BROWSER_EXTENSION_ORIGIN,
    BROWSER_HOST_NAME,
};
pub use dns::{flush_dns, system_hosts_path};
pub use hosts::{render_hosts, HostsManager, HostsStatus, WriteOutcome};
pub use schedule::{parse_time, Schedule};
use std::{collections::BTreeSet, fmt};

#[derive(Debug)]
pub struct Error {
    pub message: String,
    permission: bool,
}
impl Error {
    pub fn new(message: String) -> Self {
        Self {
            message,
            permission: false,
        }
    }
    pub fn is_permission(&self) -> bool {
        self.permission
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn io_error(context: &str, error: std::io::Error) -> Error {
    let guidance = if error.kind() == std::io::ErrorKind::PermissionDenied {
        " Administrator/root access is required; use the desktop authorization prompt or run the CLI with elevation."
    } else {
        ""
    };
    Error {
        message: format!("{context}: {error}.{guidance}"),
        permission: error.kind() == std::io::ErrorKind::PermissionDenied,
    }
}

/// Normalize an HTTP(S) URL or a bare DNS name. Hosts rules cannot match URL paths.
pub fn normalize_domain(input: &str) -> Result<String> {
    let input = input.trim();
    if input.is_empty()
        || input.chars().any(|c| c.is_control() || c.is_whitespace())
        || input.contains('\\')
        || input.contains('*')
    {
        return Err(Error::new(
            "Enter a domain or HTTP(S) URL without whitespace or wildcards.".into(),
        ));
    }
    let domain = if input.contains("://") {
        let url = url::Url::parse(input).map_err(|_| Error::new("Invalid website URL.".into()))?;
        // Inspect raw authority as URL parsing discards default ports.
        let authority = input
            .split_once("://")
            .unwrap()
            .1
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("");
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || authority.contains(':')
            || authority.contains('@')
        {
            return Err(Error::new(
                "Use an HTTP(S) website URL without credentials or a port.".into(),
            ));
        }
        url.host_str()
            .ok_or_else(|| Error::new("URL has no domain.".into()))?
            .to_owned()
    } else {
        // Bare names may have one trailing slash, but never paths, queries, fragments, or ports.
        input
            .strip_suffix('/')
            .unwrap_or(input)
            .to_ascii_lowercase()
    };
    let domain = domain.to_ascii_lowercase();
    let domain = domain
        .strip_prefix("www.")
        .unwrap_or(&domain)
        .trim_end_matches('.');
    if domain.len() > 253
        || domain.parse::<std::net::IpAddr>().is_ok()
        || !domain.contains('.')
        || domain == "localhost"
        || domain.ends_with(".localhost")
        || domain.ends_with(".local")
    {
        return Err(Error::new(
            "Enter a public DNS domain, not an IP address or local hostname.".into(),
        ));
    }
    for label in domain.split('.') {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(Error::new(
                "Domain labels must contain letters, digits, and internal hyphens.".into(),
            ));
        }
    }
    // A numeric top-level label is not a public DNS hostname and can disguise IPv4 forms.
    if domain
        .rsplit('.')
        .next()
        .unwrap()
        .bytes()
        .all(|b| b.is_ascii_digit())
    {
        return Err(Error::new(
            "The domain must have a nonnumeric top-level label.".into(),
        ));
    }
    Ok(domain.to_owned())
}

pub fn normalize_domains(domains: &[String]) -> Result<Vec<String>> {
    if domains.len() > 500 {
        return Err(Error::new(
            "The blocklist is limited to 500 domains.".into(),
        ));
    }
    domains
        .iter()
        .map(|d| normalize_domain(d))
        .collect::<Result<BTreeSet<_>>>()
        .map(|set| set.into_iter().collect())
}
