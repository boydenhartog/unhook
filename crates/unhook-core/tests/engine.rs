use unhook_core::{normalize_domain, render_hosts, HostsManager};

#[test]
fn normalizes_web_urls_and_domain_case() {
    assert_eq!(
        normalize_domain("  HTTPS://WWW.YouTube.com/watch?v=test  ").unwrap(),
        "youtube.com"
    );
    assert_eq!(normalize_domain("reddit.com/").unwrap(), "reddit.com");
}

#[test]
fn rejects_injection_ip_local_hosts_and_wildcards() {
    for domain in [
        "evil.com\n127.0.0.1 safe.com",
        "foo bar.com",
        "127.0.0.1",
        "http://[::1]",
        "localhost",
        "foo.localhost",
        "*.youtube.com",
        "-bad.com",
        "bad-.com",
        "foo..com",
        "file:///etc/hosts",
        "https://user:pass@example.com",
        "example.com:3000",
        "https://example.com:443",
        "bad.com#comment",
    ] {
        assert!(normalize_domain(domain).is_err(), "accepted {domain}");
    }
}

#[test]
fn preserves_original_bytes_after_block_and_restore() {
    for original in [
        b"127.0.0.1 localhost\n# my entry\n".as_slice(),
        b"127.0.0.1 localhost\r\n# no newline".as_slice(),
        b"".as_slice(),
        b"# other tool\xff\n".as_slice(),
    ] {
        let blocked = render_hosts(original, &["youtube.com".into()]).unwrap();
        assert!(blocked
            .windows(b"127.0.0.1 youtube.com".len())
            .any(|s| s == b"127.0.0.1 youtube.com"));
        assert!(blocked
            .windows(b"::1 www.youtube.com".len())
            .any(|s| s == b"::1 www.youtube.com"));
        assert_eq!(render_hosts(&blocked, &[]).unwrap(), original);
    }
}

#[test]
fn refuses_malformed_markers_without_modifying_contents() {
    for text in [
        "# BEGIN UNHOOK\n",
        "# END UNHOOK\n",
        "# BEGIN UNHOOK\n# BEGIN UNHOOK\n# END UNHOOK\n",
        "# BEGIN UNHOOK\n# END UNHOOK\n# BEGIN UNHOOK\n# END UNHOOK\n",
    ] {
        assert!(render_hosts(text.as_bytes(), &["youtube.com".into()]).is_err());
    }
}

#[test]
fn apply_is_idempotent_and_restore_retains_unrelated_entries() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hosts");
    std::fs::write(&path, b"127.0.0.1 localhost\r\n10.0.0.1 custom").unwrap();
    let engine = HostsManager::new(path.clone());
    engine.apply(&["youtube.com".into()]).unwrap();
    let first = std::fs::read(&path).unwrap();
    engine.apply(&["youtube.com".into()]).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), first);
    assert!(std::fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("backup")));
    engine.restore().unwrap();
    assert_eq!(
        std::fs::read(path).unwrap(),
        b"127.0.0.1 localhost\r\n10.0.0.1 custom"
    );
}

#[test]
fn replacing_blocklist_drops_old_owned_entries_and_preserves_external_changes() {
    let original = b"127.0.0.1 localhost\n10.0.0.2 my-service\n";
    let first = render_hosts(original, &["youtube.com".into()]).unwrap();
    let mut external = first;
    external.extend_from_slice(b"10.2.0.1 another-tool\n");
    let second = render_hosts(&external, &["reddit.com".into()]).unwrap();
    assert!(!String::from_utf8_lossy(&second).contains("youtube.com"));
    assert_eq!(
        render_hosts(&second, &[]).unwrap(),
        b"127.0.0.1 localhost\n10.0.0.2 my-service\n10.2.0.1 another-tool\n"
    );
}

#[test]
fn external_append_after_original_without_final_newline_preserves_line_boundaries() {
    let mut blocked = render_hosts(b"# original no newline", &["youtube.com".into()]).unwrap();
    blocked.extend_from_slice(b"10.2.0.1 another-tool\n");
    assert_eq!(
        render_hosts(&blocked, &[]).unwrap(),
        b"# original no newline\n10.2.0.1 another-tool\n"
    );
}

#[test]
fn malformed_file_and_invalid_domains_never_create_backups_or_write_hosts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hosts");
    let original = b"# BEGIN UNHOOK\nmissing end";
    std::fs::write(&path, original).unwrap();
    let engine = HostsManager::new(path.clone());
    assert!(engine.apply(&["youtube.com".into()]).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(!std::fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("backup")));
    assert!(engine
        .apply(&["evil.com\n127.0.0.1 example.com".into()])
        .is_err());
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn refuses_concurrent_editing_when_lock_is_held() {
    use fs2::FileExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hosts");
    std::fs::write(&path, b"# original\n").unwrap();
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.path().join(".hosts.unhook.lock"))
        .unwrap();
    lock.lock_exclusive().unwrap();
    let result = HostsManager::new(path.clone()).apply(&["youtube.com".into()]);
    assert!(result.unwrap_err().to_string().contains("Another Unhook"));
    assert_eq!(std::fs::read(path).unwrap(), b"# original\n");
}

#[cfg(unix)]
#[test]
fn preserves_unix_permissions_and_ownership() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hosts");
    std::fs::write(&path, b"# original\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
    let original = std::fs::metadata(&path).unwrap();
    HostsManager::new(path.clone())
        .apply(&["youtube.com".into()])
        .unwrap();
    let changed = std::fs::metadata(&path).unwrap();
    assert_eq!(changed.permissions().mode(), original.permissions().mode());
    assert_eq!(
        (changed.uid(), changed.gid()),
        (original.uid(), original.gid())
    );
}

#[cfg(target_os = "macos")]
#[test]
fn preserves_macos_extended_attributes_and_acl() {
    use std::process::Command;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hosts");
    std::fs::write(&path, b"# original\n").unwrap();
    assert!(Command::new("/usr/bin/xattr")
        .args(["-w", "com.unhook.fixture", "preserved"])
        .arg(&path)
        .status()
        .unwrap()
        .success());
    assert!(Command::new("/bin/chmod")
        .args(["+a", "everyone allow read"])
        .arg(&path)
        .status()
        .unwrap()
        .success());
    let before_acl = Command::new("/bin/ls")
        .arg("-le")
        .arg(&path)
        .output()
        .unwrap();
    let before_acl = String::from_utf8_lossy(&before_acl.stdout)
        .lines()
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(before_acl.contains("allow read"));
    HostsManager::new(path.clone())
        .apply(&["youtube.com".into()])
        .unwrap();
    let attribute = Command::new("/usr/bin/xattr")
        .args(["-p", "com.unhook.fixture"])
        .arg(&path)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&attribute.stdout).trim(),
        "preserved"
    );
    let acl = Command::new("/bin/ls")
        .arg("-le")
        .arg(path)
        .output()
        .unwrap();
    let after_acl = String::from_utf8_lossy(&acl.stdout)
        .lines()
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(after_acl, before_acl);
}
