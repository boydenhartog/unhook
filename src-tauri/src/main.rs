#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = unhook_desktop::privilege::run_helper_if_requested() {
        std::process::exit(code);
    }
    unhook_desktop::run();
}
