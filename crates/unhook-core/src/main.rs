use std::{env, path::PathBuf, process::ExitCode};
use unhook_core::{flush_dns, HostsManager};

const HELP:&str = "Unhook hosts-file blocker\n\nUsage: unhook-cli [--hosts PATH] [--no-flush] <COMMAND> [DOMAINS...]\n\nCommands:\n  block DOMAIN...  Block domains plus their www companions\n  unblock          Remove only Unhook's marked entries\n  status           Report the current owned hosts section\n\nOptions:\n  --hosts PATH     Use a fixture/custom file; DNS flushing is skipped\n  --no-flush       Skip native DNS cache flushing\n  -h, --help       Show this help\n\nWithout --hosts, writes use the system hosts file and need administrator/root access.\nThe CLI persists blocking until unblock; use the desktop app for timed sessions and schedules.\nOnly exact domains and www companions are blocked. Other subdomains need explicit entries.\n";

fn execute() -> Result<(), String> {
    let mut args = env::args().skip(1).peekable();
    let mut path = None;
    let mut skip_flush = false;
    let mut positional = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print!("{HELP}");
                return Ok(());
            }
            "--hosts" => {
                path = Some(PathBuf::from(args.next().ok_or("--hosts requires a path")?));
                skip_flush = true;
            }
            "--no-flush" => skip_flush = true,
            _ if arg.starts_with('-') => return Err(format!("Unknown option: {arg}")),
            _ => positional.push(arg),
        }
    }
    if positional.is_empty() {
        print!("{HELP}");
        return Ok(());
    }
    let manager = path
        .map(HostsManager::new)
        .unwrap_or_else(HostsManager::system);
    let command = positional.remove(0);
    if command == "status" && positional.is_empty() {
        let status = manager.status().map_err(|e| e.to_string())?;
        println!(
            "Focus {} ({})",
            if status.active { "active" } else { "inactive" },
            manager.path().display()
        );
        for domain in status.domains {
            println!("  {domain}");
        }
        return Ok(());
    }
    let result = match command.as_str() {
        "block" if !positional.is_empty() => manager.apply(&positional),
        "unblock" if positional.is_empty() => manager.restore(),
        "block" => return Err("block requires at least one domain".into()),
        "unblock" | "status" => return Err(format!("{command} takes no domains")),
        _ => return Err(format!("Unknown command: {command}. Use --help for usage.")),
    }
    .map_err(|e| e.to_string())?;
    println!(
        "{} {}",
        if result.changed {
            "Updated"
        } else {
            "No changes needed for"
        },
        manager.path().display()
    );
    if let Some(warning) = result.warning {
        eprintln!("Warning: {warning}");
    }
    if let Some(backup) = result.backup_path {
        println!("Backup: {}", backup.display());
    }
    if result.changed && !skip_flush {
        if let Some(warning) = flush_dns() {
            eprintln!("Warning: {warning}");
        }
    }
    Ok(())
}
fn main() -> ExitCode {
    match execute() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Unhook: {error}");
            ExitCode::FAILURE
        }
    }
}
