use crate::{io_error, normalize_domains, Error, Result};
use fs2::FileExt;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    ops::Range,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::fs::File;

const BEGIN: &[u8] = b"# BEGIN UNHOOK";
const BEGIN_NO_EOL: &[u8] = b"# BEGIN UNHOOK (original had no final newline)";
const END: &[u8] = b"# END UNHOOK";

#[derive(Debug, Clone)]
pub struct HostsStatus {
    pub active: bool,
    pub domains: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct WriteOutcome {
    pub changed: bool,
    pub backup_path: Option<PathBuf>,
    pub warning: Option<String>,
}
#[derive(Debug, Clone)]
pub struct HostsManager {
    path: PathBuf,
}

/// Locate exactly one well-formed owned section, preserving all surrounding bytes.
fn owned_range(contents: &[u8]) -> Result<Option<Range<usize>>> {
    let mut begin: Option<(usize, bool)> = None;
    let mut found = None;
    let mut offset = 0;
    for line in contents.split_inclusive(|b| *b == b'\n') {
        let text = line.strip_suffix(b"\n").unwrap_or(line);
        let text = text.strip_suffix(b"\r").unwrap_or(text);
        if text.starts_with(BEGIN) {
            if begin.is_some() || found.is_some() || (text != BEGIN && text != BEGIN_NO_EOL) {
                return Err(Error::new(
                    "Malformed or duplicate Unhook hosts markers; refusing to alter the file."
                        .into(),
                ));
            }
            begin = Some((offset, text == BEGIN_NO_EOL));
        } else if text.starts_with(END) {
            if text != END || found.is_some() {
                return Err(Error::new(
                    "Malformed Unhook end marker; refusing to alter the file.".into(),
                ));
            }
            let (mut start, no_eol) = begin.take().ok_or_else(|| {
                Error::new("Unhook end marker has no start; refusing to alter the file.".into())
            })?;
            if no_eol {
                if start == 0 || contents[start - 1] != b'\n' {
                    return Err(Error::new(
                        "Unhook newline metadata is invalid; refusing to alter the file.".into(),
                    ));
                }
                // If another tool appended records, keep their separating newline.
                if offset + line.len() == contents.len() {
                    start -= 1;
                }
            }
            found = Some(start..offset + line.len());
        }
        offset += line.len();
    }
    if begin.is_some() {
        return Err(Error::new(
            "Unhook start marker has no end; refusing to alter the file.".into(),
        ));
    }
    Ok(found)
}

pub fn render_hosts(contents: &[u8], domains: &[String]) -> Result<Vec<u8>> {
    let domains = normalize_domains(domains)?;
    let mut output = contents.to_vec();
    if let Some(range) = owned_range(contents)? {
        output.drain(range);
    }
    if domains.is_empty() {
        return Ok(output);
    }
    let newline: &[u8] = if output.windows(2).any(|s| s == b"\r\n") {
        b"\r\n"
    } else {
        b"\n"
    };
    let no_eol = !output.is_empty() && !output.ends_with(b"\n");
    if no_eol {
        output.push(b'\n');
    }
    output.extend_from_slice(if no_eol { BEGIN_NO_EOL } else { BEGIN });
    output.extend_from_slice(newline);
    output.extend_from_slice(b"# Managed by Unhook. Exact domains and their www companions only.");
    output.extend_from_slice(newline);
    for domain in domains {
        for name in [domain.clone(), format!("www.{domain}")] {
            for address in ["127.0.0.1", "::1"] {
                output.extend_from_slice(format!("{address} {name}").as_bytes());
                output.extend_from_slice(newline);
            }
        }
    }
    output.extend_from_slice(END);
    output.extend_from_slice(newline);
    Ok(output)
}

impl HostsManager {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn system() -> Self {
        Self::new(crate::system_hosts_path())
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn status(&self) -> Result<HostsStatus> {
        let bytes = fs::read(&self.path).map_err(|e| io_error("Cannot read the hosts file", e))?;
        let section = owned_range(&bytes)?;
        let mut domains = Vec::new();
        if let Some(ref range) = section {
            let text = String::from_utf8_lossy(&bytes[range.clone()]);
            for line in text.lines() {
                let mut parts = line.split_whitespace();
                if parts.next() == Some("127.0.0.1") {
                    if let Some(domain) = parts.next() {
                        if let Ok(domain) = crate::normalize_domain(domain) {
                            domains.push(domain);
                        }
                    }
                }
            }
        }
        Ok(HostsStatus {
            active: section.is_some(),
            domains: normalize_domains(&domains)?,
        })
    }
    pub fn apply(&self, domains: &[String]) -> Result<WriteOutcome> {
        self.update(domains)
    }
    pub fn restore(&self) -> Result<WriteOutcome> {
        self.update(&[])
    }

    fn update(&self, domains: &[String]) -> Result<WriteOutcome> {
        // Validate before acquiring a lock or touching any files.
        let domains = normalize_domains(domains)?;
        let metadata = fs::symlink_metadata(&self.path)
            .map_err(|e| io_error("Cannot inspect the hosts file", e))?;
        if !metadata.file_type().is_file() {
            return Err(Error::new(
                "Hosts path must be a regular file, not a symlink or directory.".into(),
            ));
        }
        let initial =
            fs::read(&self.path).map_err(|e| io_error("Cannot read the hosts file", e))?;
        if render_hosts(&initial, &domains)? == initial {
            return Ok(WriteOutcome {
                changed: false,
                backup_path: None,
                warning: None,
            });
        }
        let parent = self
            .path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .ok_or_else(|| Error::new("Hosts path has no filename.".into()))?
            .to_string_lossy();
        let lock_path = parent.join(format!(".{file_name}.unhook.lock"));
        // A persistent advisory lock avoids removing/recreating a lock inode while peers wait.
        let lock_metadata = fs::symlink_metadata(&lock_path);
        if lock_metadata
            .as_ref()
            .is_ok_and(|m| !m.file_type().is_file())
        {
            return Err(Error::new("Unhook lock path is not a regular file.".into()));
        }
        let mut lock_options = OpenOptions::new();
        lock_options
            .create(true)
            .truncate(false)
            .read(true)
            .write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            lock_options.custom_flags(libc::O_NOFOLLOW);
        }
        let lock = lock_options
            .open(&lock_path)
            .map_err(|e| io_error("Cannot acquire the Unhook hosts lock", e))?;
        lock.try_lock_exclusive().map_err(|e| {
            if e.kind() == std::io::ErrorKind::WouldBlock {
                Error::new("Another Unhook process is editing hosts; try again shortly.".into())
            } else {
                io_error("Cannot lock the hosts file", e)
            }
        })?;
        let original =
            fs::read(&self.path).map_err(|e| io_error("Cannot read the hosts file", e))?;
        let updated = render_hosts(&original, &domains)?;
        if original == updated {
            return Ok(WriteOutcome {
                changed: false,
                backup_path: None,
                warning: None,
            });
        }
        let metadata = fs::metadata(&self.path)
            .map_err(|e| io_error("Cannot inspect hosts permissions", e))?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let backup_path = parent.join(format!(
            "{file_name}.unhook-backup-{timestamp}-{}",
            std::process::id()
        ));
        let mut backup = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&backup_path)
            .map_err(|e| io_error("Cannot create a hosts backup", e))?;
        backup
            .set_permissions(metadata.permissions())
            .map_err(|e| io_error("Cannot preserve backup permissions", e))?;
        backup
            .write_all(&original)
            .and_then(|_| backup.sync_all())
            .map_err(|e| io_error("Cannot save a hosts backup", e))?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".unhook-hosts-")
            .tempfile_in(parent)
            .map_err(|e| io_error("Cannot create a replacement hosts file", e))?;
        preserve_metadata(&self.path, temporary.path())?;
        temporary
            .as_file()
            .set_len(0)
            .map_err(|e| io_error("Cannot prepare replacement hosts contents", e))?;
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| io_error("Cannot preserve hosts permissions", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            std::os::unix::fs::chown(temporary.path(), Some(metadata.uid()), Some(metadata.gid()))
                .map_err(|e| io_error("Cannot preserve hosts ownership", e))?;
        }
        temporary
            .write_all(&updated)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|e| io_error("Cannot write replacement hosts contents", e))?;
        // Other hosts tools do not honor our advisory lock. Refuse a stale read rather than
        // knowingly overwrite edits made after the backup; the OS rename is atomic.
        if fs::read(&self.path).map_err(|e| io_error("Cannot recheck the hosts file", e))?
            != original
        {
            return Err(Error::new("The hosts file changed while Unhook was preparing its update; no changes were applied.".into()));
        }
        let current = fs::symlink_metadata(&self.path)
            .map_err(|e| io_error("Cannot recheck the hosts path", e))?;
        if !current.file_type().is_file() {
            return Err(Error::new(
                "Hosts path changed to a nonregular file; refusing the update.".into(),
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if current.dev() != metadata.dev()
                || current.ino() != metadata.ino()
                || current.mode() != metadata.mode()
                || current.uid() != metadata.uid()
                || current.gid() != metadata.gid()
            {
                return Err(Error::new("The hosts file identity or permissions changed during the update; no changes were applied.".into()));
            }
        }
        #[cfg(not(windows))]
        temporary
            .persist(&self.path)
            .map_err(|e| io_error("Cannot replace the hosts file", e.error))?;
        #[cfg(windows)]
        replace_windows(temporary, &self.path)?;
        #[cfg(unix)]
        let warning = File::open(parent)
            .and_then(|directory| directory.sync_all())
            .err()
            .map(|e| format!("Hosts entries changed, but directory synchronization failed: {e}"));
        #[cfg(not(unix))]
        let warning = None;
        Ok(WriteOutcome {
            changed: true,
            backup_path: Some(backup_path),
            warning,
        })
    }
}

#[cfg(windows)]
fn replace_windows(temporary: tempfile::NamedTempFile, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    // ReplaceFileW preserves the existing file's ACL, creation time, and attributes.
    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = temporary
        .path()
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let success = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if success == 0 {
        return Err(io_error(
            "Cannot replace the hosts file",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(())
}

// Native copy utilities preserve platform ACLs and extended attributes on the private
// replacement file; the original is untouched. Fail closed if metadata cannot be copied.
fn preserve_metadata(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let source =
            fs::canonicalize(source).map_err(|e| io_error("Cannot resolve hosts path", e))?;
        let destination = fs::canonicalize(destination)
            .map_err(|e| io_error("Cannot resolve replacement path", e))?;
        let mut command = std::process::Command::new("/bin/cp");
        #[cfg(target_os = "macos")]
        command.arg("-p");
        #[cfg(target_os = "linux")]
        command.arg("--preserve=mode,ownership,xattr");
        let output = command
            .arg(source)
            .arg(destination)
            .output()
            .map_err(|e| io_error("Cannot preserve hosts metadata", e))?;
        if !output.status.success() {
            return Err(Error::new(format!(
                "Cannot preserve hosts ACLs/attributes: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = (source, destination);
    Ok(())
}
