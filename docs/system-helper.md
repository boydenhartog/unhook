# Optional macOS system blocker

Browser blocking is the default and needs no administrator permission. On macOS
13+, the [PKG](macos-installer.md) installs a conventional persistent root daemon
with administrator authorization during installation. Both private-beta and
public packages use this route. The private beta uses ad-hoc signatures and
approved app code hashes installed by root, so paid Developer ID is not required
for ordinary schedule/block transitions. Setup reports **Ready** only after
checking protected service assets and a successful authenticated connection.

The app remains a normal user process. macOS background restrictions, revocation
and Gatekeeper can still require attention; installation is not proof that all
approvals disappear. Apple distinguishes [installer privileges and client
authorization](https://developer.apple.com/forums/thread/708765).

App-only signed bundles retain the embedded
[SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)
route. App-only unsigned/ad-hoc builds retain optional password-based system
blocking. Hosts changes in that mode can ask for permission at start, stop,
schedule transitions, expiry and quit. An unavailable installed or approved
service never silently switches to password authorization.

## Installed service boundary

The installer places these fixed root-owned assets:

| Asset             | Path                                                                |
| ----------------- | ------------------------------------------------------------------- |
| Executable        | `/Library/PrivilegedHelperTools/org.unhook.installed-system-helper` |
| LaunchDaemon      | `/Library/LaunchDaemons/org.unhook.installed-system-helper.plist`   |
| Approved CDHashes | `/Library/Application Support/Unhook/approved-code-hashes`          |
| Launchd socket    | `/var/run/org.unhook.installed-system-helper.sock`                  |

The installed label differs from the embedded `org.unhook.system-helper` label.
An active embedded registration must be removed through Setup before installing
this package. Installed assets take precedence over embedded registration. Missing,
insecure or unresponsive assets report unavailable and require repair/reinstall.

The helper reads pins through descriptor-relative `openat` calls with
`O_NOFOLLOW`, checks root ownership and absence of group/other write permission
for every protected ancestor, and rejects extended ACLs, nonregular files and hardlinks. Pin
files contain 1–16 unique lowercase 40-hex CDHashes, bounded to 656 bytes. Every
architecture of the packaged app is pinned. Only an administrator-authorized
package update replaces those pins.

Each socket connection is bound to the kernel-issued
[LOCAL_PEERTOKEN](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/un.h)
audit token. The Security framework resolves the live guest using
[kSecGuestAttributeAudit](https://developer.apple.com/documentation/security/ksecguestattributeaudit).
The helper checks live code validity and the static bundle's sealed resources,
exact `org.unhook.desktop` identifier,
hardened runtime and the active CDHash against the protected allowlist. It rejects
debugger access, disabled library validation, DYLD environment injection, JIT,
unsigned executable memory and disabled executable-page protection entitlements.
An identifier, PID/path, logged-in UID or user-readable token alone grants no
authority. The app also checks that its socket peer is root.

Approved code copies have the same identity; this scheme does not restrict
authority to one filesystem pathname or logged-in user. Unhook is a local focus
tool, not a multi-user parental-control boundary. The hardened app must not load
untrusted native plugins. Ad-hoc signing seals code integrity without establishing
Apple-trusted publisher identity or downloaded Gatekeeper acceptance.

## Protocol and recovery

The narrow JSON protocol accepts `ping`, `restore`, and `apply` with canonical
sorted unique domains and `expiresAt`. The installed daemon additionally accepts
`uninstall`; the embedded daemon rejects it. Extra fields, arbitrary commands and
client-selected paths are rejected. Requests are bounded to 128 KiB and 500
domains. The target is always the core system hosts path. Core validation,
locking, metadata preservation, backups and atomic replacement remain intact.

An apply request grants a lease of at most 15 seconds. The app refreshes it every
5 seconds while system blocking is enabled and focus is active. The deadline
cannot exceed the session deadline. Controller timestamps are milliseconds;
protocol timestamps are seconds rounded down. A monotonic timer also bounds
leases when the wall clock moves backwards. Recovery is armed before mutation,
retained after failed writes/restores, and retried after expiry. The helper
restores owned entries at launch, normal shutdown and lease expiry.

Schedules still run in the app. The app must remain running and the Mac must be
awake. Login startup is a separate opt-in main-app SMAppService status. Closing
the window retains the tray process; quitting stops focus.

Setup's **Remove system service** restores and disables system blocking under
the controller lock while preserving browser focus. The installed daemon restores
again, validates all removal targets before deleting its three fixed assets,
then unloads its fixed label. It leaves the app, companion and user settings.
A failed restore prevents deletion. Run the PKG again to reinstall the service.
The root-only `--restore-installed` helper entry point is reserved for installer
upgrade/recovery and always targets the real hosts file; never run it in a fixture
test.

## Embedded and password routes

`npm run prepare:system-helper` prepares the embedded helper, whose plist uses
`BundleProgram` inside the app. Its existing authentication requires an
Apple-anchored same-team signature, exact app identifier and hardened runtime.
The package route does not relax that rule. Embedded registration/removal and
approval remain OS-owned. Public packages retain Developer ID Application and
Installer validation and require notarization before distribution.

The password fallback uses the constrained app subprocess and macOS-owned
authorization for each hosts change. Refreshes are no-ops in this mode. Stale
entries after a crash can need explicit **Restore system access** or CLI recovery.
No administrator password is stored. Fixture mode never contacts real services,
changes OS registration or flushes DNS.

## Verification

Automated tests cover bounded/canonical requests, unrelated-record preservation,
leases, restoration failures, pin format/ownership/symlinks/hardlinks, fixed
removal and native signing/socket authentication fixtures. See
[verification notes](verification.md) for checks actually run.

Before distributing a package, use a clean Mac/VM for installation, downloaded
Gatekeeper behavior, background permission/revocation, reboot, app login startup,
schedule starts/stops without subsequent passwords, crash recovery, upgrades and
removal. Build/package expansion and fixture tests do not establish those live
behaviors.
