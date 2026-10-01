use std::process::Command;

#[test]
fn fixture_cli_blocks_reports_and_restores_without_dns_flush() {
    let dir = tempfile::tempdir().unwrap();
    let hosts = dir.path().join("hosts");
    std::fs::write(&hosts, b"127.0.0.1 localhost\n").unwrap();
    let binary = env!("CARGO_BIN_EXE_unhook-cli");
    let block = Command::new(binary)
        .args(["--hosts", hosts.to_str().unwrap(), "block", "youtube.com"])
        .output()
        .unwrap();
    assert!(
        block.status.success(),
        "{}",
        String::from_utf8_lossy(&block.stderr)
    );
    assert!(std::fs::read_to_string(&hosts)
        .unwrap()
        .contains("127.0.0.1 youtube.com"));
    let status = Command::new(binary)
        .args(["--hosts", hosts.to_str().unwrap(), "status"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&status.stdout).contains("active"));
    let restore = Command::new(binary)
        .args(["--hosts", hosts.to_str().unwrap(), "unblock"])
        .output()
        .unwrap();
    assert!(restore.status.success());
    assert_eq!(std::fs::read(hosts).unwrap(), b"127.0.0.1 localhost\n");
}
