# macOS package installer

Unhook keeps the Mac app and browser companion together. The PKG installs the app
at `/Applications/Unhook.app` and a conventional root LaunchDaemon in protected
Library locations. Installer authorization installs the persistent system blocker;
ordinary start/stop and schedule transitions use its authenticated socket without
repeated passwords once Setup reports **Ready**. The app stays a normal user
process and handles browser registration on normal launch.

Private-beta packages do not require paid Developer ID credentials for this
runtime behavior. Their executables are ad-hoc signed with hardened runtime and
all app architecture CDHashes are pinned by the authorized installer. This is
separate from publisher trust, downloaded Gatekeeper acceptance, notarization
and macOS background permissions. Those still need clean-machine acceptance.
See [system helper](system-helper.md) for the authentication boundary.

## Build

Build on macOS with Node 24.12+, stable Rust, Xcode command-line tools and the
repository dependencies:

```sh
npm ci
# Private beta without Developer ID certificates
npm run package:macos -- --development
# Public distribution build with matching Developer ID certificates
npm run package:macos
```

The builder makes a fresh Tauri app and writes packages under
`target/release/bundle/pkg/`. `--skip-build` uses an existing app and rejects stale
versions. App/helper/browser-host architectures must match; arm64, x86_64 and
universal payloads are supported. The minimum macOS version remains 13.

Private beta output is
`Unhook_<version>_<architecture>_PRIVATE_BETA_UNSIGNED.pkg`, with a separate
receipt identifier. The PKG has no Developer ID Installer signature; executables
are ad-hoc signed in a staging copy, without changing the original built bundle.
Both Installer pages describe the persistent service and private-beta limitations.
A beta cannot replace an existing Developer ID release.

The older `Unhook_0.2.0_arm64_DEVELOPMENT_UNSIGNED.pkg` is the previous app-only
artifact and does not implement this route. The builder uses a distinct filename
and refuses same-name overwrites. Increment app/npm/Tauri/Cargo release versions
for distributed upgrades; the extension retains its own version.

Public output is `Unhook_<version>_<architecture>_INSTALLED_SERVICE.pkg`.
Public builds require `APPLE_SIGNING_IDENTITY` as Developer ID Application and
`APPLE_INSTALLER_SIGNING_IDENTITY` as Developer ID Installer from the same team.
The builder verifies identities, strict all-architecture signatures, hardened
runtime and absence of unsafe debugging/injection entitlements. It verifies the
resulting PKG signature. Credentials/keys belong in the build user's Keychain,
never source or scripts. Notarize/staple the final distribution container and
complete downloaded/offline Gatekeeper testing before public distribution. The
builder does not publish or submit artifacts for notarization.

## Installation and service ownership

1. Run the package and authorize installation as an administrator.
2. Open Unhook from Applications as your normal logged-in user.
3. In Setup, wait for **System service connected** before choosing **Use system
   blocking**. Missing connectivity or damaged service files report unavailable.
   Follow the repair/background-permission message instead of assuming installation
   grants readiness.
4. Connect the companion in each desired browser profile. The beta retains guided
   **Load unpacked** instructions; no extension-store publication is performed.
5. Optionally enable **Launch Unhook at login**. Its actual OS status is independent
   from the system service and browser connection.

The fixed service assets are:

```text
/Library/PrivilegedHelperTools/org.unhook.installed-system-helper
/Library/LaunchDaemons/org.unhook.installed-system-helper.plist
/Library/Application Support/Unhook/approved-code-hashes
```

The installed label/socket differ from the embedded service. Protected ownership,
no writable group/other bits, no redirected ancestors, strict code validation and
exact installed pins are checked before bootstrap. The installed helper uses
kernel-issued peer identity, live code validity and approved code hashes. The
package never launches a GUI as root or writes browser profiles. The app must
remain running to evaluate schedules and renew bounded leases; the daemon does
not independently schedule focus. The Mac must be awake.

The component's `PackageInfo` sets `overwrite-permissions="false"` so existing
shared directories such as `/Applications` retain their ownership and modes.
New directories and replacement files retain the package archive's root ownership;
strict postinstall checks still reject an unprotected app or service. The builder
uses `pkgutil --expand`/`--flatten`, as documented by local `pkgutil(1)`, to change
this attribute before signing the final product and verifies it after expansion.
Apple's [Software Distribution Legacy Guide, File Ownership](https://leopard-adc.pepas.com/documentation/DeveloperTools/Conceptual/SoftwareDistribution4/SoftwareDistribution4.pdf)
explains that existing directories retain permissions unless Overwrite Permissions
is enabled. This Apple-authored guide is available through an archive mirror;
current clean-VM acceptance must also verify shared-parent metadata remains intact.

## Upgrades, migration and failures

Finish/stop focus and quit Unhook before upgrading. Preinstall rejects running
apps, alternate target disks, symlinks/insecure service paths, unrelated bundles,
downgrades, other publisher teams and conflicting old global service assets.
Bundle relocation is disabled and complete-bundle upgrade metadata preserves
fixed placement and removes obsolete bundle files. User blocklists/schedules live
outside the payload and are preserved.

If an embedded SMAppService helper is active, first use **Setup → Remove system
service**, then quit and retry. This restores system entries while retaining
browser focus, and prevents duplicate service managers. Existing conventional
service installations using the old label require their original removal flow.
The installer does not reset background-task databases or remove other products.

For an installed-daemon upgrade, the installer checks the old protected helper,
stops its job, then invokes only its root-only fixed `--restore-installed` mode.
Restore failure aborts replacement and attempts to reload the prior protected job
for lease recovery. The new payload replaces app/helper/pins together; postinstall
verifies code hashes exactly match the installed allowlist before enabling and
bootstrapping the fixed job. If postinstall fails, system blocking remains
unavailable; repair the indicated ownership/signature/permission problem and
rerun the package. This is not a transactional rollback of every Installer write.
Do not hand-edit pins to approve an arbitrary executable.

An interrupted replacement can leave incomplete assets. Setup treats any service
asset or stranded socket as installer-managed and unavailable, without silently
falling back to password authorization or embedded registration. See
[operations/recovery](operations.md) for administrator recovery when the GUI
cannot connect. Reinstallation is the supported repair path.

## Removal

Finish focus, disable **Launch Unhook at login**, then choose **Remove system
service** in Setup. Restoration and removal share the controller lock, preventing
a concurrent enable from reapplying blocking. The installed daemon restores again,
validates all targets before deleting its three fixed files, and unloads only its
own launchd label. Restore failure prevents removal. Browser focus and user
settings are preserved.

Quit and remove `/Applications/Unhook.app` afterwards; remove the browser companion
through the browser if desired. Dragging the app into Trash alone leaves the
global daemon installed, though its short lease releases entries when app refreshes
stop. The receipt is bookkeeping, not an uninstaller. Reinstall the PKG to restore
the removed system service.

## Verification and acceptance

Automated tests use temporary hosts/signing/socket/installer fixtures. They cover
client authorization, pins, ownership, symlinks/hardlinks, upgrade conflicts,
stop/restore ordering, failed restoration, exact postinstall hash checks and
bootstrap failure. The builder expands the finished PKG without installing it and
checks the app plus global service payload. Inspect a produced artifact with:

```sh
pkgutil --expand-full target/release/bundle/pkg/Unhook_0.2.0_arm64_PRIVATE_BETA_UNSIGNED.pkg /tmp/unhook-private-beta-inspection
lsbom /tmp/unhook-private-beta-inspection/Unhook-component.pkg/Bom
cat /tmp/unhook-private-beta-inspection/Unhook-component.pkg/PackageInfo
```

Building/expanding a package does not prove live installation behavior. Before
distribution, use a clean Mac/VM for fresh downloaded/offline install, administrator
different from logged-in user, background approval/revocation, reboot, login
startup, prompt-free schedule transitions, browser connection, running-app and
embedded-service conflicts, completed upgrades, crash/lease expiry restoration,
interrupted-update repair and removal. See [verification notes](verification.md)
for checks actually run. Routine development must not install packages or alter
live hosts, DNS, installed apps, services, login items or browser permissions.
