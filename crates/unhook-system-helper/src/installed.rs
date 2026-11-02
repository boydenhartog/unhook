//! Installation inputs are administrator-owned, descriptor-relative and fixed.
use std::{
    ffi::CString,
    fs::File,
    io::Read,
    os::fd::{AsRawFd, FromRawFd},
};

const PINS: &str = "Library/Application Support/Unhook/approved-code-hashes";
const HELPER: &str = "Library/PrivilegedHelperTools/org.unhook.installed-system-helper";
const PLIST: &str = "Library/LaunchDaemons/org.unhook.installed-system-helper.plist";
const MAX_PINS: u64 = 16 * 41;

fn validated(metadata: &std::fs::Metadata, uid: u32, directory: bool) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    if metadata.uid() != uid
        || metadata.mode() & 0o022 != 0
        || (directory && !metadata.is_dir())
        || (!directory && (!metadata.is_file() || metadata.nlink() != 1))
    {
        return Err("Unsafe installed system service ownership or file type.".into());
    }
    Ok(())
}

fn no_acl(file: &File) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn unhook_fd_has_no_acl(fd: libc::c_int) -> libc::c_int;
        }
        if unsafe { unhook_fd_has_no_acl(file.as_raw_fd()) } != 1 {
            return Err("ACL on protected installation input.".into());
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = file;
    Ok(())
}

fn open_child(parent: &File, name: &str, directory: bool, uid: u32) -> Result<File, String> {
    let name = CString::new(name).map_err(|e| e.to_string())?;
    let flags = libc::O_RDONLY
        | libc::O_NOFOLLOW
        | libc::O_CLOEXEC
        | if directory {
            libc::O_DIRECTORY
        } else {
            libc::O_NONBLOCK
        };
    // SAFETY: The parent descriptor and NUL-terminated name remain live for the
    // call. These flags do not create a file, so no mode argument is required.
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // SAFETY: A successful openat returns a new owned descriptor. Transfer it
    // exactly once to File so it is closed on every subsequent return path.
    let file = unsafe { File::from_raw_fd(fd) };
    no_acl(&file)?;
    validated(&file.metadata().map_err(|e| e.to_string())?, uid, directory)?;
    Ok(file)
}

fn protected_file(root: &File, path: &str, uid: u32) -> Result<(File, File, CString), String> {
    validated(&root.metadata().map_err(|e| e.to_string())?, uid, true)?;
    no_acl(root)?;
    let mut parent = root.try_clone().map_err(|e| e.to_string())?;
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        if part.is_empty() || part == "." || part == ".." {
            return Err("Invalid protected path.".into());
        }
        if parts.peek().is_some() {
            parent = open_child(&parent, part, true, uid)?;
        } else {
            let file = open_child(&parent, part, false, uid)?;
            return Ok((file, parent, CString::new(part).unwrap()));
        }
    }
    Err("Missing protected file.".into())
}

fn parse_pins(bytes: &[u8]) -> Result<CString, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid approved code hashes.")?;
    let pins: Vec<_> = text
        .strip_suffix('\n')
        .unwrap_or(text)
        .split('\n')
        .collect();
    if pins.is_empty()
        || pins.len() > 16
        || pins.iter().any(|pin| {
            pin.len() != 40
                || !pin
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
        || pins
            .iter()
            .enumerate()
            .any(|(i, pin)| pins[..i].contains(pin))
    {
        return Err("Invalid approved code hashes.".into());
    }
    CString::new(pins.join("\n")).map_err(|e| e.to_string())
}

fn read_pins_at(root: &File, uid: u32) -> Result<CString, String> {
    let (file, _, _) = protected_file(root, PINS, uid)?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_PINS {
        return Err("Approved code hashes exceed limit.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PINS + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PINS {
        return Err("Approved code hashes exceed limit.".into());
    }
    parse_pins(&bytes)
}

#[cfg(target_os = "macos")]
pub fn read_pins() -> Result<CString, String> {
    read_pins_at(&File::open("/").map_err(|e| e.to_string())?, 0)
}

fn remove_at(root: &File, uid: u32) -> Result<(), String> {
    // Validate every object before deleting any. Held directory descriptors prevent
    // path redirection after validation; root-only parents prevent untrusted swaps.
    let files = [PLIST, HELPER, PINS]
        .into_iter()
        .map(|path| protected_file(root, path, uid))
        .collect::<Result<Vec<_>, _>>()?;
    for (_, parent, name) in files {
        if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn remove_files() -> Result<(), String> {
    remove_at(&File::open("/").map_err(|e| e.to_string())?, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    fn fixture() -> (tempfile::TempDir, File, u32) {
        let dir = tempfile::tempdir().unwrap();
        for path in [PINS, HELPER, PLIST] {
            let path = dir.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                &path,
                if path.file_name().unwrap() == "approved-code-hashes" {
                    "0123456789abcdef0123456789abcdef01234567\n"
                } else {
                    "fixture"
                },
            )
            .unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        let root = File::open(dir.path()).unwrap();
        (dir, root, unsafe { libc::geteuid() })
    }
    #[test]
    fn reads_only_valid_unique_bounded_hashes() {
        let (_dir, root, uid) = fixture();
        assert!(read_pins_at(&root, uid).is_ok());
        for bytes in [
            "",
            "../a",
            "0123456789ABCDEF0123456789abcdef01234567",
            "0123456789abcdef0123456789abcdef01234567\n0123456789abcdef0123456789abcdef01234567",
            "0123456789abcdef0123456789abcdef01234567\n\n",
        ] {
            assert!(parse_pins(bytes.as_bytes()).is_err());
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_acl_grants_even_with_safe_posix_modes() {
        let (dir, root, uid) = fixture();
        let pins = dir.path().join(PINS);
        let user = std::env::var("USER").unwrap();
        assert!(std::process::Command::new("/bin/chmod")
            .arg("+a")
            .arg(format!("{user} allow write"))
            .arg(&pins)
            .status()
            .unwrap()
            .success());
        assert!(read_pins_at(&root, uid).is_err());
        assert!(remove_at(&root, uid).is_err());
        for path in [PINS, HELPER, PLIST] {
            assert!(dir.path().join(path).exists());
        }
        assert!(std::process::Command::new("/bin/chmod")
            .arg("-N")
            .arg(&pins)
            .status()
            .unwrap()
            .success());
        assert!(read_pins_at(&root, uid).is_ok());
    }
    #[test]
    fn refuses_writable_or_wrong_owner_inputs() {
        let (dir, root, uid) = fixture();
        assert!(read_pins_at(&root, uid.wrapping_add(1)).is_err());
        std::fs::set_permissions(
            dir.path().join("Library/Application Support"),
            std::fs::Permissions::from_mode(0o777),
        )
        .unwrap();
        assert!(read_pins_at(&root, uid).is_err());
    }
    #[test]
    fn refuses_symlink_file_and_ancestor_and_hardlink() {
        let (dir, root, uid) = fixture();
        let pins = dir.path().join(PINS);
        let actual = dir.path().join("actual");
        std::fs::rename(&pins, &actual).unwrap();
        symlink(&actual, &pins).unwrap();
        assert!(read_pins_at(&root, uid).is_err());
        std::fs::remove_file(&pins).unwrap();
        std::fs::hard_link(&actual, &pins).unwrap();
        assert!(read_pins_at(&root, uid).is_err());
        std::fs::remove_file(&pins).unwrap();
        std::fs::rename(&actual, &pins).unwrap();
        let support = dir.path().join("Library/Application Support");
        let target = dir.path().join("redirected");
        std::fs::rename(&support, &target).unwrap();
        symlink(&target, &support).unwrap();
        assert!(read_pins_at(&root, uid).is_err());
    }
    #[test]
    fn invalid_removal_target_preserves_every_installed_file() {
        let (dir, root, uid) = fixture();
        std::fs::set_permissions(
            dir.path().join(HELPER),
            std::fs::Permissions::from_mode(0o666),
        )
        .unwrap();
        assert!(remove_at(&root, uid).is_err());
        for path in [PINS, HELPER, PLIST] {
            assert!(dir.path().join(path).exists());
        }
    }
    #[test]
    fn removes_only_the_three_fixed_files() {
        let (dir, root, uid) = fixture();
        std::fs::write(
            dir.path().join("Library/Application Support/Unhook/keep"),
            "data",
        )
        .unwrap();
        remove_at(&root, uid).unwrap();
        for path in [PINS, HELPER, PLIST] {
            assert!(!dir.path().join(path).exists());
        }
        assert!(dir
            .path()
            .join("Library/Application Support/Unhook/keep")
            .exists());
    }
}
