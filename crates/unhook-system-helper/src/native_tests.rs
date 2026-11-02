//! Real signed socket clients; never starts the root daemon or touches hosts.
use std::{
    ffi::CString,
    os::{fd::AsRawFd, unix::net::UnixListener},
    process::{Command, Stdio},
};
extern "C" {
    fn unhook_authenticate_installed_peer(
        socket: libc::c_int,
        pins: *const libc::c_char,
    ) -> libc::c_int;
}

#[test]
fn installed_auth_requires_current_pinned_safe_hardened_app_code() {
    let dir = tempfile::tempdir_in("/private/tmp").unwrap();
    let source = dir.path().join("client.c");
    std::fs::write(
        &source,
        r#"#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <string.h>
int main(int argc, char **argv) {
    if (argc != 2) return 1;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    if (strlen(argv[1]) >= sizeof(address.sun_path)) return 2;
    strcpy(address.sun_path, argv[1]);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) return 3;
    char byte;
    read(fd, &byte, 1);
    close(fd);
    return 0;
}"#,
    )
    .unwrap();
    let original = dir.path().join("original");
    assert!(Command::new("xcrun")
        .args(["clang", "-o"])
        .arg(&original)
        .arg(&source)
        .status()
        .unwrap()
        .success());
    for (case, identifier, runtime, entitlement, expected) in [
        ("approved", "org.unhook.desktop", true, None, true),
        ("wrong-hash", "org.unhook.desktop", true, None, false),
        ("wrong-id", "org.unhook.other", true, None, false),
        ("no-runtime", "org.unhook.desktop", false, None, false),
        (
            "debug",
            "org.unhook.desktop",
            true,
            Some("com.apple.security.get-task-allow"),
            false,
        ),
        (
            "inject",
            "org.unhook.desktop",
            true,
            Some("com.apple.security.cs.disable-library-validation"),
            false,
        ),
        (
            "dyld",
            "org.unhook.desktop",
            true,
            Some("com.apple.security.cs.allow-dyld-environment-variables"),
            false,
        ),
        (
            "jit",
            "org.unhook.desktop",
            true,
            Some("com.apple.security.cs.allow-jit"),
            false,
        ),
        (
            "unsigned-memory",
            "org.unhook.desktop",
            true,
            Some("com.apple.security.cs.allow-unsigned-executable-memory"),
            false,
        ),
        (
            "executable-page",
            "org.unhook.desktop",
            true,
            Some("com.apple.security.cs.disable-executable-page-protection"),
            false,
        ),
    ] {
        let client = dir.path().join(case);
        std::fs::copy(&original, &client).unwrap();
        let mut sign = Command::new("/usr/bin/codesign");
        sign.args(["--force", "--sign", "-", "--identifier", identifier]);
        if runtime {
            sign.args(["--options", "runtime"]);
        }
        if let Some(key) = entitlement {
            let entitlements = dir.path().join("entitlements.plist");
            std::fs::write(&entitlements, format!("<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>{key}</key><true/></dict></plist>")).unwrap();
            sign.arg("--entitlements").arg(entitlements);
        }
        assert!(sign
            .arg(&client)
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
        let info = Command::new("/usr/bin/codesign")
            .args(["-d", "--verbose=4"])
            .arg(&client)
            .output()
            .unwrap();
        assert!(info.status.success());
        let info = String::from_utf8(info.stderr).unwrap();
        let actual_hash = info
            .lines()
            .find_map(|line| line.strip_prefix("CDHash="))
            .unwrap();
        let hash = if case == "wrong-hash" {
            "0000000000000000000000000000000000000000"
        } else {
            actual_hash
        };
        let pins = CString::new(hash).unwrap();
        let socket = dir.path().join("sock");
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut child = Command::new(&client).arg(&socket).spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        child.try_wait().unwrap().is_none(),
                        "client {case} exited before connecting"
                    );
                    assert!(
                        std::time::Instant::now() < deadline,
                        "client {case} connection timeout"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        let allowed =
            unsafe { unhook_authenticate_installed_peer(stream.as_raw_fd(), pins.as_ptr()) } == 1;
        drop(stream);
        assert!(child.wait().unwrap().success());
        assert_eq!(allowed, expected, "case {case}");
        std::fs::remove_file(socket).unwrap();
    }
    for tampered in [false, true] {
        let bundle = dir.path().join(if tampered {
            "tampered.app"
        } else {
            "sealed.app"
        });
        let binary = bundle.join("Contents/MacOS/unhook");
        let resource = bundle.join("Contents/Resources/index.html");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::create_dir_all(resource.parent().unwrap()).unwrap();
        std::fs::copy(&original, &binary).unwrap();
        std::fs::write(bundle.join("Contents/Info.plist"), r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.unhook.desktop</string><key>CFBundleExecutable</key><string>unhook</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>"#).unwrap();
        std::fs::write(&resource, "approved web application").unwrap();
        assert!(Command::new("/usr/bin/codesign")
            .args([
                "--force",
                "--sign",
                "-",
                "--options",
                "runtime",
                "--identifier",
                "org.unhook.desktop"
            ])
            .arg(&bundle)
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
        let info = Command::new("/usr/bin/codesign")
            .args(["-d", "--verbose=4"])
            .arg(&bundle)
            .output()
            .unwrap();
        assert!(info.status.success());
        let info = String::from_utf8(info.stderr).unwrap();
        let pins = CString::new(
            info.lines()
                .find_map(|line| line.strip_prefix("CDHash="))
                .unwrap(),
        )
        .unwrap();
        if tampered {
            std::fs::write(&resource, "altered web application invokes privileged IPC").unwrap();
        }
        let socket = dir.path().join("bundle-sock");
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut child = Command::new(&binary).arg(&socket).spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        child.try_wait().unwrap().is_none(),
                        "bundle exited before connecting"
                    );
                    assert!(
                        std::time::Instant::now() < deadline,
                        "bundle connection timeout"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        let allowed =
            unsafe { unhook_authenticate_installed_peer(stream.as_raw_fd(), pins.as_ptr()) } == 1;
        drop(stream);
        assert!(child.wait().unwrap().success());
        assert_eq!(allowed, !tampered, "resource tampered={tampered}");
        std::fs::remove_file(socket).unwrap();
    }
}
