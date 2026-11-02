# Unhook macOS package installation

Researched 2026-10-01. Both the Mac app and browser companion remain. This report covers one-time setup for the optional system blocker. No implementation, installation, system modification, or Chrome publication was performed.

Follow-up: the user selected the conventional daemon route for a private beta
without paid Developer ID. The signed-embedded recommendation in this historical
research is superseded by [the corrected implementation plan](../plans/2026-10-01-private-beta-daemon.md)
and [current installer guide](../macos-installer.md).

## Recommendation

**A PKG is a suitable installer for Unhook's app and system helper.** It can be distributed directly or inside our familiar DMG. Preserve browser setup in the user app, and use Installer authorization for protected installation work. Apple recommends PKGs for products with multiple components or fixed installation locations and explicitly supports nesting an app inside a PKG inside a DMG. [Apple packaging documentation](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

There are two distinct designs; choosing PKG does not automatically choose between them:

1. **Least change, modern consumer design:** the PKG installs the signed Unhook bundle, retaining the existing embedded SMAppService daemon. First normal user launch registers the helper, opens macOS's approval UI when needed, verifies registration and IPC, and then reports Ready. This can include an installer authorization plus a separate system-helper approval during initial setup. It eliminates routine daily start/stop passwords once approved. **Do not claim the PKG password silently approves SMAppService.**
2. **If installer authorization must install the persistent helper directly:** the PKG installs a conventional root-owned `/Library/LaunchDaemons` service and a protected executable, and loads it in the system launchd domain. Keep the same signed client authentication and narrow leased IPC. This is supported as an installer route, but needs explicit app status detection, migration, upgrades and removal. Its code has more differences from our current service management.

For public distribution, both designs should use Developer ID signatures and notarization. A private ad-hoc beta is not equivalent to a trusted signed release and cannot use our current Apple-identity checks unchanged. Do not weaken authentication merely to make the installer work.

## What Apple verifies

Apple DTS distinguishes one-shot privilege elevation from ongoing privilege: an approved installer can install a launchd daemon, which subsequently runs with the privileges required for its work. The installer is not asked to authorize every later request. Apple describes a package as the easiest option when elevation is needed for installing a product. [BSD Privilege Escalation on macOS, Apple DTS](https://developer.apple.com/forums/thread/708765)

The modern service management API is available on **macOS 13 and later**. A registered LaunchDaemon remains subject to administrator approval before bootstrap; once approved, the system bootstraps it on subsequent boots. A main-app login item launches on subsequent user logins. LaunchAgents are registered for each user who runs the app, not automatically for every user by one registration. [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [register()](https://developer.apple.com/documentation/servicemanagement/smappservice/register())

Apple's PKG/SMAppService sample demonstrates a **LaunchAgent**, a GUI-less container app under `/Library/Application Support/YOURDEVELOPERNAME`, an installer target, and executable register/unregister/status commands. Its bundle seals the helper and launchd plist together. It should guide packaging, but its LaunchAgent success must not be generalized into automatic approval of a privileged daemon. [Official sample](https://developer.apple.com/documentation/ServiceManagement/updating-your-app-package-installer-to-use-the-new-service-management-api)

Apple DTS confirms calling SMAppService from a postinstall script is officially documented, while acknowledging integration problems. The same discussion confirms traditional global LaunchDaemon installation remains relevant and recommends `AssociatedBundleIdentifiers` for visible attribution. **For Unhook, first-launch registration is the simpler consumer implementation; postinstall registration/approval should be treated as unverified until tested with our daemon.** [Apple DTS discussion](https://developer.apple.com/forums/thread/766351)

No primary source found establishes that administrator authentication for this PKG automatically grants SMAppService daemon approval. The public API contract says approval is required. We should expose Pending approval accurately, not convert a successful install into Ready.

## Proposed protected layouts

For the modern bundle route, keep the current executable and plist locations:

```text
/Applications/Unhook.app/
  Contents/MacOS/unhook-system-helper
  Contents/Library/LaunchDaemons/org.unhook.system-helper.plist
```

Use `BundleProgram` relative to the containing bundle. Keep helper signing identifiers stable and sign nested executables before the outer bundle. Apple documents this bundle organization for SMAppService. [Updating helper executables](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos)

For conventional launchd installation, a proposed layout is:

```text
/Applications/Unhook.app
/Library/PrivilegedHelperTools/org.unhook.system-helper
/Library/LaunchDaemons/org.unhook.system-helper.plist
```

Install the executable, configuration, and parent directories as root-owned and non-writable by ordinary users; executable `0755` and plist `0644` are proposed implementation modes to confirm against current launchd tooling. The global plist uses an **absolute executable path in ProgramArguments**, not the current bundle-only BundleProgram key. Preserve the daemon's launchd-owned Control socket and limited operations. Apple documents root-owned global daemon configuration and launchd-managed startup. [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

The conventional route does not depend on macOS 13's SMAppService API, but that alone is not a commitment to support older systems. Unhook's app deployment target, helper API availability and test matrix still determine the product minimum. For an initial package, retaining the current macOS minimum reduces scope.

## Signing, notarization and private beta

Public executable code uses **Developer ID Application**. The PKG uses the separate **Developer ID Installer** certificate. If a DMG wraps the PKG, sign the DMG with Developer ID Application. Preserve matching app/helper Team IDs, stable identifiers, hardened runtime and timestamps. For nested containers, Apple recommends notarizing the outermost distribution container and stapling its ticket; test the actual downloaded container, including offline installation. [Distribution signing](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac), [package signing and notarization](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [certificate types](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

A conventional daemon can technically be launched as root following authorized installation without a Developer ID certificate being the source of its Unix privileges. Native Apple silicon executables need at least an ad-hoc signature, which provides integrity but no trusted publisher identity or Gatekeeper acceptance. **This feasibility is distinct from a supported, smooth customer install.** [Apple silicon execution/signing requirements](https://developer.apple.com/la/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)

Our helper requires an Apple-anchored matching Team ID and kernel-bound caller identity. A package containing an ad-hoc app does not satisfy that rule. A private beta without Developer ID would need a reviewed alternative, such as root-protected allowlisted code hashes with explicit authorized repinning on updates; that is a design hypothesis, not an implemented recommendation. Bundle ID, same logged-in UID, or a user-readable token alone must not authorize arbitrary clients to a root service. [Existing security design](../system-helper.md), [existing authentication](../../native/macos/security.m)

## Installation, update and removal requirements

The following are proposed Unhook engineering requirements, not a claim that PKG automatically implements a reversible transaction:

- **Preflight:** reject unsupported OS/architecture and invalid signatures; detect existing bundle/service modes, active focus and conflicting labels/sockets. Require the app to finish or explicitly stop focus before an upgrade. Preserve blocklists and schedules.
- **Installation:** install only known payload paths with protected ownership. Do not execute arbitrary user-writable downloaded scripts as root, or run the GUI as root. For conventional mode, configure/bootstrap the one intended service; for modern mode, leave first-user registration to the app.
- **Verification:** Installer success means payload installed. App/helper readiness additionally requires correct mode detection and a successful authenticated ping. Browser companion connection is a third, independent status.
- **Updates:** stop/restore the old helper gracefully; replace complete signed payloads safely; restart and confirm health. Keep identifiers and trust rules stable. Use a fixed, nonrelocatable app location for package ownership and increase app/package versions monotonically; the current repeated `0.1.0` build number cannot reliably identify upgrades. An installer update/removal may request administrator authorization again even though daily schedule transitions do not. Apple warns about in-place overwriting of Mach-O images and notes that changed signing identity can break service upgrades. [Apple update guidance](https://developer.apple.com/forums/thread/781548), [SMAppService identity/upgrade discussion](https://developer.apple.com/forums/thread/795022)
- **Failure recovery:** use explicit error handling and idempotent scripts; keep previous installation recoverable. Never leave duplicated services competing for `/var/run/org.unhook.system-helper.sock`. Preserve expiry-based hosts restoration even if installation or the app crashes.
- **Removal:** provide an explicit Uninstall system blocker action: restore only Unhook's entries, unregister/boot out the intended service, remove only owned helper/plist files, and clean its receipt as bookkeeping. Preserve unrelated hosts data. Trash removal alone is insufficient for a conventional global daemon; package receipts are not an uninstaller. Background-item UI may retain stale entries temporarily. Do not globally reset background-task settings to remove Unhook.

Our current helper lease lasts at most 15 seconds and needs renewal from the app every five seconds. Packaging it as a LaunchDaemon does **not** move the scheduling engine into the daemon. Add an opt-in **Launch Unhook at login** using SMAppService.mainApp on the modern path, or document app-running requirements accurately. A daemon's boot startup and an app's per-user login startup are different. [register() startup semantics](https://developer.apple.com/documentation/servicemanagement/smappservice/register()), [existing lease design](../system-helper.md)

Background services remain user-visible and revocable in Login Items & Extensions. macOS 26 can also ask permission for tasks remaining after the app quits. Avoid promising exactly one authentication/approval for every OS version, update and revoked-permission scenario; promise that approved routine schedule transitions do not invoke passwords. [Apple background-task management](https://support.apple.com/en-gb/guide/deployment/depdca572563/web)

## Preserve browser setup in user context

After installation, the normal app registers the native messaging host in the actual user's browser paths and confirms the companion handshake. Do not run this GUI/user-profile work inside a root postinstall. Google supports both system-wide and user-specific native host manifests; the host path must be absolute on macOS and extension origins must be explicitly allowed. Our existing per-user approach remains appropriate. [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

Keep browser extension installation a user-confirmed step. For eventual public distribution the app opens the Chrome Web Store listing, and the user confirms Add to Chrome/Add extension in their browser. During the existing beta, retain guided Load unpacked. The PKG does not replace browser consent and this research does not authorize publishing. [Chrome installation instructions](https://support.google.com/chrome/answer/2664769)

Chrome also documents installer-created external-extension recommendations via an `external_update_url` manifest. On macOS this must point to the Chrome Web Store, and the user still confirms enabling the extension. This is optional future distribution work, not required for helper installation, and Brave's equivalent has not been verified. A visible setup link is simpler to explain and keep under user control. [Chrome external-extension installation](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)

The parent agent verified local packaging-tool availability and read-only `pkgbuild --analyze` results. Those show the app is currently treated as relocatable with version checking and upgrade overwrite behavior by default. Override relocation for the fixed install plan and verify ownership using package-tool options/inspection; this does not require modifying source-file ownership. No package was installed during those checks.

## Decisions before implementation

1. **Preferred mode:** PKG plus existing SMAppService first-launch approval, or installer-managed conventional daemon? Recommendation: retain SMAppService unless eliminating the separate initial approval UI is a hard requirement.
2. **Distribution trust:** use Developer ID for the beta/public package, or undertake separate beta-only client authentication? Recommendation: Developer ID; never an unrestricted fallback.
3. **Migration:** explicitly support exactly one service manager. The app must recognize an installer-managed daemon instead of reporting the current unsigned/passwordRequired status. Preserve signing identity and socket ownership; avoid same-label dual registration.
4. **Login behavior:** choose opt-in launch-at-login while keeping the app in control of timers/schedules. Do not imply schedules run when the app is absent.
5. **Verification:** clean-machine install, existing signed and ad-hoc upgrade, app/service revocation, reinstall, logged-in user different from installing administrator, no user logged in, crash/expiry restore, uninstall and offline Gatekeeper tests.

The quickest implementation-ready route is a **signed PKG installing the existing app bundle, followed by normal-user setup with explicit helper approval, browser connection, and optional login launch**. A conventional global daemon is viable if needed, but is a product lifecycle change rather than merely a packaging format switch.
