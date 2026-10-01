# Unhook

A lightweight, open-source desktop website blocker built with Tauri 2, React, TypeScript, and Rust. Start a timed focus session, keep an editable blocklist, or set a weekly work schedule with a lunch break.

## Run

Install Node.js 22+ and stable Rust, plus the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) (Xcode on macOS, Visual Studio C++ build tools and WebView2 on Windows, WebKitGTK and AppIndicator development packages on Linux).

```sh
npm install
npm run desktop
```

To review just the interface:

```sh
npm run dev
```

Open `http://127.0.0.1:1420`. The browser shows a clearly labeled **preview**: sessions and settings are simulated locally, and no websites are blocked. Native command failures never switch to preview mode.

## Behavior

- A focus session blocks the configured domains until its timer expires. You can end it early.
- Weekly schedules use the computer's local time, selected weekdays, and a same-day start/end window. An optional break temporarily unblocks sites. Overnight windows are rejected.
- Manual sessions take priority over a schedule, including a scheduled break. Ending focus also skips the rest of the current day's scheduled window; the next scheduled day can start normally.
- Closing the desktop window keeps the app running in the tray. Choose **Quit** there to restore Unhook's hosts section and exit.
- Schedules and countdowns run in Rust, independent of the webview. The process must remain running; this version has no boot-time system service or autostart integration.

## Permissions and recovery

Windows builds request UAC administrator privileges at launch. macOS and Linux keep the GUI running as the current user and invoke a constrained helper through `osascript` administrator authorization or `pkexec` when a hosts write needs elevation. Linux requires a working graphical PolicyKit authentication agent. **Unix scheduled transitions can require authorization, so unattended enforcement is not guaranteed.** A privileged installed service would be needed to remove that limitation.

The engine only edits its own marked section. It validates domains again in Rust, includes IPv4 and IPv6 mappings and explicit `www` companions, preserves unrelated hosts bytes, refuses ambiguous markers, and creates backups before changes. It deliberately uses a narrow marked-section parser instead of rewriting the entire file through a general hosts parser.

After a crash or forced termination, marked entries may remain until Unhook restarts and reconciles its persisted session. Use **Restore hosts** in the app or the CLI `unblock` command to recover. Never replace the entire hosts file from an old backup unless you have checked for other applications' changes. See [the operations guide](docs/operations.md).

Hosts blocking matches exact domain names; it cannot automatically cover arbitrary subdomains, apps using direct IP addresses, proxies, or every browser DNS/cache behavior. DNS flush failures are displayed as warnings because the hosts edit may have succeeded. Existing browser connections may remain open.

For Brave and Chrome, the [browser companion](docs/browser-companion.md) adds request blocking and a focus page, following the desktop app's blocklist and accepted session state automatically. Unhook remains the only settings and session controller. Install the extension once; the updated app registers its bundled, read-only native host on launch.

## Engine CLI

The core CLI is independent of Tauri. Use a temporary fixture for development; production hosts changes require root/administrator access.

```sh
cargo run -p unhook-core --bin unhook-cli -- --help
```

## Verify and package

```sh
npm test
npm run build
npm run prepare:browser-host
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

Build on the target operating system:

```sh
# macOS
npm run tauri -- build --bundles app,dmg
# Windows
npm run tauri -- build --bundles msi
# Linux
npm run tauri -- build --bundles deb
```

Installers are written under `target/release/bundle/`. The included GitHub Actions workflow verifies the frontend and Rust code and builds all three native formats. It produces unsigned test artifacts; public distribution needs macOS signing/notarization and Windows signing credentials configured by the maintainer. Refer to the official [Windows installer](https://v2.tauri.app/distribute/windows-installer/) and [macOS application bundle](https://v2.tauri.app/distribute/macos-application-bundle/) guides.

If macOS DMG packaging reports that it cannot send Apple events to Finder, use `CI=true npm run tauri -- build --bundles dmg`. This skips cosmetic Finder layout automation and builds the same app without requesting additional OS permission. See [verification notes](docs/verification.md) for what was exercised locally.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/` | Interface, native IPC adapter, explicit browser preview |
| `crates/unhook-core/` | Domain validation, hosts transactions, schedules, DNS, CLI |
| `src-tauri/` | Desktop commands, persistence, scheduler, privilege helper, tray |
| `docs/contract.md` | Shared IPC and scheduling contract |

MIT licensed. No accounts, analytics, cloud services, or remote blocklist requests.
