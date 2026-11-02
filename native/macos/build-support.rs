use std::{env, path::Path, process::Command};

pub fn compile_native(directory: &Path, service: bool) {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let out = std::path::PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("Unsupported macOS architecture: {other}"),
    };
    let sources: &[&str] = if service {
        &["security.m", "service.m"]
    } else {
        &["security.m"]
    };
    let mut objects = Vec::new();
    for source in sources {
        let input = directory.join(source);
        println!("cargo:rerun-if-changed={}", input.display());
        let output = out.join(format!("{source}.o"));
        let result = Command::new("xcrun")
            .args([
                "--sdk",
                "macosx",
                "clang",
                "-arch",
                arch,
                "-mmacosx-version-min=10.13",
                "-fobjc-arc",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-c",
            ])
            .arg(input)
            .arg("-o")
            .arg(&output)
            .status()
            .expect("macOS SDK and clang are required");
        assert!(
            result.success(),
            "Could not compile secure macOS service bridge"
        );
        objects.push(output);
    }
    let archive = out.join("libunhook_macos.a");
    let result = Command::new("ar")
        .arg("crs")
        .arg(&archive)
        .args(objects)
        .status()
        .unwrap();
    assert!(result.success(), "Could not archive macOS service bridge");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=unhook_macos");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=Security");
    if service {
        println!("cargo:rustc-link-lib=framework=ServiceManagement");
    }
}
