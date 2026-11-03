# Unhook

A local-first desktop website blocker for focused work. Start a timed session or set a weekly schedule, then let Unhook keep distracting sites out of the way.

Built with **Tauri 2, React 19, TypeScript, and Rust**. No accounts, analytics, cloud services, or remote blocklist requests.

![Unhook focus screen in the simulated browser preview](docs/assets/focus-preview.png)

## Project status

Unhook is in development/private beta. The macOS app is used locally; signed public downloads, extension-store distribution, and clean-machine release acceptance remain outstanding. Windows and Linux have build/verification jobs configured, but native installation and enforcement still need platform acceptance.

The browser preview is a safe way to explore the interface. It simulates settings and sessions and **does not block websites**.

## Features

- **Focus sessions:** block selected domains for a chosen duration, with an option to stop early.
- **Weekly schedules:** selected weekdays, same-day work hours, and an optional break; valid edits save immediately.
- **Browser companion:** Chrome/Brave request blocking that follows the desktop app's accepted state.
- **Quiet interruptions:** a leaf releases and settles on the blocked page, with one immediate Close tab action and a static reduced-motion alternative.
- **Optional system blocking on macOS:** an authenticated helper applies a bounded lease and restores Unhook's entries when the app stops refreshing it.
- **Tray operation:** closing the window keeps scheduling alive; quitting stops focus. Launch at login is an explicit option on macOS 13+.

## Install and start using Unhook

Unhook is currently a private beta, with **no published installer releases yet**. macOS requires **macOS 13 or later**. Windows and Linux packages are experimental; installation and blocking still need native platform acceptance.

### 1. Get an installer

If you have been given a beta installer, use the steps below. Otherwise, open [GitHub Actions](https://github.com/boydenhartog/unhook/actions/workflows/build.yml), choose a successful build of `main`, and download the artifact for your operating system: `Unhook-macOS`, `Unhook-Windows`, or `Unhook-Linux`. GitHub requires you to sign in to download workflow artifacts. Extract the downloaded ZIP first. These are unsigned test builds, not verified public releases.

If no artifact is available, follow [Build an installer from source](#build-an-installer-from-source). Node.js and Rust are only needed to build Unhook yourself, not to use an installer.

### 2. Install the desktop app

- **macOS:** use the `Unhook_<version>_<architecture>_PRIVATE_BETA_UNSIGNED.pkg` from the artifact's `pkg` folder. Choose `arm64` for Apple silicon or `x86_64` for Intel; `universal` supports both. Double-click the PKG and follow Installer, authorizing installation with an administrator account. It installs `/Applications/Unhook.app` and a persistent system blocking service. Open **Unhook** from Applications as your normal user. The private-beta PKG is unsigned and has not completed notarization or clean-machine Gatekeeper acceptance; if macOS refuses to open it, report that to the beta provider. See the [macOS installer guide](docs/macos-installer.md) for details.
- **Windows (experimental):** open the `.msi` installer, follow its prompts, then launch **Unhook** from the Start menu.
- **Linux (experimental, Debian/Ubuntu):** install the `.deb` using your system's package installer, then launch **Unhook** from the applications menu.

### 3. Connect Chrome or Brave

The desktop app needs its browser companion to block sites in Chrome or Brave. There is no extension-store download yet.

1. In Unhook's **Setup**, choose **Chrome** or **Brave**, then click **Open Chrome setup** or **Open Brave setup**.
2. On the browser's extensions page, turn on **Developer mode** and click **Load unpacked**.
3. Select the **Unhook companion folder** shown in Setup. Use **Show folder** to find it. Keep this folder in place so the browser can continue loading the extension.
4. Keep Unhook running and wait for **Browser companion connected**. Repeat these steps for every browser profile you want to use, checking **Connected** in that profile's companion popup.
5. Click **Continue**. On macOS, system blocking is optional: wait for **System service connected** before enabling **Use system blocking**. You can also enable **Launch Unhook at login**. Click **Finish setup**.

If the companion does not connect, keep the desktop app open, reload the extension on the browser's extensions page, and check that you loaded the folder shown in Setup. More help is in the [browser companion guide](docs/browser-companion.md).

### 4. Start your first focus session

1. Open **Blocklist** and add the domains you want to block, such as `reddit.com`. The `www` version is included; add other subdomains separately.
2. Open **Focus**, choose a duration, and click **Start focusing**.
3. Visit a blocked domain in the connected browser to confirm that Unhook's focus page appears. Use **End focus session** to stop early, or let the timer finish.

Keep Unhook running while you want blocking or schedules to work. Closing the window leaves it running in the tray; quitting stops focus. You can configure recurring hours under **Schedule**.

To uninstall on macOS, end focus, disable **Launch Unhook at login**, and choose **Remove system service** in Setup before quitting and removing the app. Remove the companion from each browser profile as well. See [full removal instructions](docs/macos-installer.md#removal).

## Try the interface

Use Node.js 24.12 or later (24 LTS recommended):

```sh
npm ci
npm run dev
```

Open [127.0.0.1:1420](http://127.0.0.1:1420). The preview runs entirely in the browser, with simulated state in localStorage. The separate [blocked-page preview](http://127.0.0.1:1420/extension/blocked.html) shows the interruption without accessing task storage.

For native development, install stable Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Follow the [fixture-based development guide](CONTRIBUTING.md#native-development-with-fixtures) before running `npm run desktop`; normal native operation can register the browser host and interact with system integrations.

## Engineering decisions

- **Rust owns native state.** Timers, schedules, persistence, and enforcement intent live outside the webview. The interface uses a typed service boundary; native errors never silently switch to simulation.
- **Browser blocking is the default.** Session intent and actual hosts-file enforcement are separate states. Browser-only operations do not edit hosts.
- **Privilege is narrowly scoped.** The browser host reads a fixed private snapshot and acknowledges applied state. The macOS helper authenticates peers, uses fixed paths, and grants short leases rather than giving the GUI administrator privileges.
- **Hosts changes preserve other applications' data.** The engine validates its marked section, creates backups, and writes atomically while preserving unrelated bytes. Exact domains and explicit `www` companions receive IPv4 and IPv6 mappings.

The [architecture guide](docs/architecture.md) explains the components, data flow, and tradeoffs. The [implementation contract](docs/contract.md) defines IPC and runtime behavior.

## Development checks

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

Prettier is pinned for consistent source formatting; run `npm run format` to apply it. TypeScript uses strict checks, including unused locals and parameters. Vitest covers the interface, extension, and packaging scripts.

Before full Rust workspace checks, prepare the resources and sidecars in order:

```sh
npm run build
npm run prepare:browser-host
npm run prepare:system-helper
cargo fmt --all -- --check
rustfmt --edition 2021 --check native/macos/build-support.rs
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

`npm run test:core` runs the core engine tests without building the desktop app. See [CONTRIBUTING.md](CONTRIBUTING.md) for focused tests and verification boundaries.

## Behavior and limits

Manual focus takes priority over schedules and scheduled breaks. Ending focus skips the rest of the active scheduled window; editing the schedule clears that pause. Schedules use local wall-clock time and require Unhook to remain running while the computer is awake. Overnight windows are not supported.

Blocking matches exact domains and explicit `www` companions, not arbitrary subdomains. Existing browser connections, DNS caches, proxies, direct IP access, and deliberate bypasses limit enforcement. This is a focus aid, not a tamper-proof parental-control boundary.

The companion and system helper use expiring state/leases so a stopped app cannot indefinitely retain their active enforcement. Password-based or older builds can leave hosts entries requiring explicit **Restore system access**. Recovery removes only Unhook's marked section; never replace the entire hosts file from an old backup. See [operations and recovery](docs/operations.md).

## Build an installer from source

Install Git, [Node.js 24.12 or later](https://nodejs.org/), stable Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. On macOS, this includes Xcode command-line tools. Build on the operating system where you intend to use Unhook:

```sh
git clone https://github.com/boydenhartog/unhook.git
cd unhook
npm ci
```

Then run the command for your operating system. These commands prepare the companion and native sidecars automatically:

```sh
# macOS private beta: inspect the package without installing it
npm run package:macos -- --development

# Windows
npm run tauri -- build --bundles msi

# Linux
npm run tauri -- build --bundles deb
```

Outputs are under `target/release/bundle/`: macOS PKGs in `pkg/`, Windows installers in `msi/`, and Linux packages in `deb/`. Build and inspect the artifact first, then follow [the installation steps above](#2-install-the-desktop-app) when you are ready to install it.

Public macOS packages require matching Developer ID Application/Installer teams, final-package notarization/stapling, and clean-machine acceptance. Development packages and CI artifacts do not establish that those release checks have passed.

- [Browser companion setup and protocol](docs/browser-companion.md)
- [macOS installer and removal](docs/macos-installer.md)
- [System helper security boundary](docs/system-helper.md)
- [Release acceptance record](docs/beta-acceptance.md)
- [Historical verification notes](docs/verification.md)

If local macOS DMG packaging cannot send Apple events to Finder, `CI=true npm run tauri -- build --bundles dmg` skips cosmetic Finder layout automation without requesting extra OS permissions.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code conventions, and safe verification. Contributions should preserve the privacy model and keep native contracts, TypeScript types, tests, and documentation aligned.

Licensed under the [MIT License](LICENSE).
