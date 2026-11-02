include!("../native/macos/build-support.rs");
fn main() {
    compile_native(std::path::Path::new("../native/macos"), true);
    let attrs = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows.manifest")),
    );
    tauri_build::try_build(attrs).expect("failed to build Tauri resources");
}
