# Verification — 1 October 2026

Browser companion update:

- `npm test`: 27 tests pass, including exact-domain boundaries, open/restored tabs, blocklist edits, Stop, expiry, and stale/disconnected launcher state.
- `cargo test --workspace --offline`: 30 Rust tests pass, including atomic app snapshot publication, Unix user-only permissions, read-only native messages, and message-size limits.
- Frontend build, Rust formatting, and strict workspace Clippy pass.
- macOS app and DMG bundle successfully with the separate native messaging host. `hdiutil verify` confirms the DMG checksum. Packaging required host access to macOS disk-image services.
- Updated `/Applications/Unhook.app`, reopened it, and verified automatic Chrome/Brave native host registration and live inactive snapshot publication with the user's existing blocklist preserved.
- Invoked the installed host using actual native message framing; it read the running app's current state and rejected an unauthorized extension origin.
- Inspected the companion focus page in the in-app browser; layout and accessible content render correctly.

Actual extension installation and request blocking in Brave/Chrome still require the one-time browser extension installation and a live browser acceptance run. Browser automation cannot access internal extension-management pages. Windows/Linux registration and installers require native platform verification. Automated checks used fixture hosts only.

Verified locally on macOS Apple Silicon:

- `npm test`: 22 frontend/preview tests pass, including validation, persisted expiry, schedule/break boundaries, stopped-day suppression, storage failure rollback, and countdown clock handling.
- `cargo test --workspace --offline`: 26 Rust tests pass (15 core integration tests and 11 desktop tests).
- `cargo fmt --all -- --check` and `cargo clippy --workspace --offline --all-targets -- -D warnings`: clean.
- `npm run build`: TypeScript and production frontend bundle pass.
- Native debug Tauri bundle and optimized release executable compile successfully.
- `CI=true npm run tauri -- build --bundles dmg`: produces `target/release/bundle/dmg/Unhook_0.1.0_aarch64.dmg`; `hdiutil verify` confirms a valid checksum. Standard Finder styling failed because macOS did not authorize Apple events; CI mode skips that cosmetic step.
- Live native Start and Stop commands changed the temporary test hosts file and restored its original bytes. Native session persistence and fixture path were checked. The fixture mode disabled DNS and elevation.
- Real Chromium preview checks exercised focus start/stop, blocklist add/edit/remove, URL normalization, invalid schedule validation, saving, and unsaved drafts surviving polling.
- The clean production preview has zero console errors/warnings and no horizontal overflow at 320, 768, 1024, and 1440 pixel widths. Visual screenshots checked desktop and narrow layouts. Controls have accessible names and document language is set.
- `npm audit`: zero known vulnerabilities in the installed dependency set.

The system hosts file and system DNS caches were not changed. Actual macOS administrator authorization, Windows UAC, Linux PolicyKit, and Windows/Linux installer builds require native platform verification. GitHub Actions is configured to run the tests and build MSI, DMG, and DEB artifacts, but has not been run remotely in this session. Public releases still require maintainer signing/notarization.

The native tray and normal quit restoration are implemented; state/error/expiry behavior is tested. Further live tray testing was unavailable after the Mac locked. Unix scheduled transitions can require authorization; unattended scheduling needs a privileged service. Schedules require the process to remain running, and forced termination requires restart/CLI recovery.
