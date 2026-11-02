include!("../../native/macos/build-support.rs");
fn main() {
    compile_native(std::path::Path::new("../../native/macos"), false);
}
