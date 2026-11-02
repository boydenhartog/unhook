# Corrected private-beta package route

This supersedes the embedded-only constraint in
[the earlier package plan](2026-10-01-macos-pkg-implementation.md). The requested
beta must install a persistent system blocker without paid Developer ID being
the source of its runtime authority. The app and browser companion remain.

## Agreed trust boundary

- Installer authorization places a conventional root-owned daemon, launchd plist
  and approved app code hashes in fixed protected locations. Development code
  is ad-hoc signed with hardened runtime; public builds retain Developer ID
  validation, matching teams and later notarization requirements.
- The installed helper uses a separate label/socket from the embedded helper:
  `org.unhook.installed-system-helper` and
  `/var/run/org.unhook.installed-system-helper.sock`.
- The helper uses the kernel audit token to identify the live client's code,
  validates its signature, exact app identifier, hardened runtime and absence of
  injection/debug entitlements, then checks its active CDHash against the
  root-protected allowlist. Bundle ID, PID, path, UID and user-readable secrets
  cannot independently authorize requests.
- Installed assets take precedence over embedded registration. Incomplete,
  insecure or unresponsive assets report unavailable and never silently select
  password authorization or another service manager.
- App scheduling and short leases stay unchanged. The daemon cannot evaluate
  schedules independently; the app must run and the Mac must be awake.

## Lifecycle

Preflight rejects a running app, unsafe installation targets, downgrades and an
active embedded helper. Users migrate an embedded registration by removing it
in Setup before installation. Upgrades stop the old installed daemon and use its
fixed root-only restoration entry point before replacement. Postinstall verifies
the installed signatures and exact pins before enabling/bootstrap. It never
launches the GUI as root. Failure leaves explicit repair/reinstall instructions.

Removal retains the controller lock across system restoration and removal. The
authenticated installed helper restores hosts before deleting only its fixed
service assets and unloading its own label. App, browser focus and preferences
remain. Reinstalling the PKG is needed to restore this service after removal.

## Ownership and verification

Daemon worker owns the helper and native client authentication. Packaging worker
owns the builder, scripts and package tests. Native/UI worker owns management
status, IPC and Setup. Root owns integration, documentation, verification and
independent review.

All development verification uses isolated files and signing/socket fixtures.
Build and expand a distinct private-beta artifact, preserving the earlier
app-only artifact. Do not install packages, replace the installed app, alter
hosts/DNS or register services/login items. Clean-machine Gatekeeper, background
approval, login, reboot, schedule transitions, upgrades and removal acceptance
remain separate from automated verification.
