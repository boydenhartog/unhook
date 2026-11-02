# Automatic macOS system blocking: alternatives

Researched 2026-10-01. Scope: stop repeated administrator prompts for Unhook's daily schedules while retaining the Mac app. This is research, not a tested installer or a change to system settings.

## Recommendation

The simplest alternative is a **one-time installer that installs a small root-owned LaunchDaemon**. A DMG can contain `Install Unhook.pkg`; the user runs the installer and authorizes installation, then the daemon handles later block/unblock requests without daily password prompts. A DMG containing only a drag-to-Applications app does not itself install that daemon. Apple's Developer Technical Support explicitly recommends installer packages for installation-time elevation and explains that a package can install a daemon to obtain ongoing privileges. [Apple DTS: BSD Privilege Escalation on macOS](https://developer.apple.com/forums/thread/708765)

For a public release, **keep our existing SMAppService helper and sign/notarize the app**. This retains the current DMG/launcher experience and avoids designing a second installer, client-authentication mechanism, and update/uninstall lifecycle. If we instead prefer an installer wizard, use a signed/notarized PKG with the same constrained helper. [Apple's package/Service Management sample](https://developer.apple.com/documentation/servicemanagement/updating-your-app-package-installer-to-use-the-new-service-management-api), [Developer ID distribution](https://developer.apple.com/developer-id/)

For a private beta before Developer ID is available, a package-installed **ad-hoc-signed daemon is technically plausible**, but our current helper will reject that arrangement unchanged. It would need a separately reviewed trust scheme and clean-machine testing. This is an implementation inference from the launchd model, not an assertion that every current macOS release will allow an unnotarized installer without further security prompts. **Signing with Developer ID is the simplest safe beta path if an account is already available.**

Removing administrator prompts fixes scheduling convenience. It does **not** fix the hosts-file browser-cache bypass already observed with Marktplaats. Hosts-only should remain described as best-effort website blocking; a supported Network Extension is a larger option for app-only network enforcement.

## What Unhook does now

The current unsigned/ad-hoc app uses macOS-owned AppleScript administrator authorization for each necessary hosts-file change. It deliberately does not keep a privileged process or saved password. Start/end of a repeating schedule are fresh changes, so leaving the schedule enabled does not guarantee prompt-free operation. Short-lived operating-system credential caching may avoid a nearby prompt, but cannot be promised across daily transitions. [Local implementation](../../src-tauri/src/privilege.rs), [local service status](../../src-tauri/src/system_service.rs)

The signed helper implementation requires an Apple-anchored signature, the same Team ID, the exact app identifier, and hardened runtime. These are **our security rules**, as well as stable identity needed by the supported SMAppService path; a bundle identifier alone is not sufficient to trust a root-service client. Existing requests are limited to validated domains and apply/restore/ping, with a 15-second lease renewed every five seconds, plus expiry/startup recovery. [Helper design](../system-helper.md), [native authentication](../../native/macos/security.m), [helper service](../../crates/unhook-system-helper/src/main.rs)

## Comparison

| Approach | Daily prompts? | Installation/approval | Signing and practical fit |
| --- | --- | --- | --- |
| Existing signed SMAppService daemon | No, while approved and working | One-time registration; macOS background-item approval, possibly admin authentication | Supported modern approach; our code requires matching Apple-issued identity. Best fit for current DMG. |
| PKG installs root-owned LaunchDaemon | No for routine daemon operations | Installer obtains elevated permission once; background-item controls remain applicable | Ordinary launchd is separate from SMAppService. Developer ID is important for public distribution and stable client trust; a private ad-hoc beta needs a different secure authentication design and testing. |
| Legacy SMJobBless helper | No after installation | Authorization installs a persistent helper | Deprecated since macOS 13; Apple directs new software to SMAppService. Useful only for an actual older-macOS support requirement. |
| Cache/reuse Authorization Services rights | Cannot guarantee daily unattended operation | Rights depend on policy, lifetime, login session, and revocation | Not a replacement for a persistent service. AuthorizationExecuteWithPrivileges is deprecated. |
| Network Extension content filter or transparent proxy | Policy updates can be automatic after consent | System-extension activation and filtering/proxy permission | Supported app-only enforcement direction; entitlement/provisioning/signing plus substantial native networking work. |
| DNS proxy/local DNS resolver | Can be automatic while service remains installed/approved | NE DNS proxy consent or privileged initial DNS setup | More moving parts; DNS-only filtering retains resolution/cache limitations and can be bypassed by other resolvers. |
| Managed deployment (MDM) | Can be automatic under administrator policy | Organization enrolls/manages the Mac | Useful for company/school fleets, excessive for a consumer focus app. |

The modern helper and legacy alternative are supported by [Service Management](https://developer.apple.com/documentation/servicemanagement/) and [SMJobBless deprecation guidance](https://developer.apple.com/documentation/servicemanagement/smjobbless(_:_:_:_:)). The network-provider deployment requirements are summarized in [TN3134](https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment). Authorization limitations and managed deployment are detailed below.

## One-time package installation: what it actually means

The installer installs the helper and its launchd configuration into root-owned locations, then launchd runs the helper with the necessary privileges. It must not execute a replaceable binary from a user-writable Downloads folder or trust a mutable script just because the installer was originally approved. Apple documents global daemon ownership and non-writable configuration requirements. [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

**Technical distinction:** a conventional root-installed LaunchDaemon does not inherently need a Developer ID certificate to obtain UID 0. Apple silicon executable code does require a signature, but an ad-hoc signature satisfies that execution-level requirement; it does not provide a trusted publisher identity or pass Gatekeeper. Thus “unsigned beta” should mean “not Developer ID signed,” rather than literally unsigned ARM code. [Apple silicon code-signing requirements](https://developer.apple.com/la/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)

For our beta, simply deleting `anchor apple` or accepting every local caller would be unsafe. A restricted build could theoretically pin approved binary code hashes/certificate identity and use kernel-issued peer identity, root-owned allowlists, and the existing narrow protocol. That is a proposed design requiring review; upgrades would need explicit authorized repinning. A token readable by all processes of the logged-in user would not authenticate “only Unhook.” The current Apple identity check is simpler and survives ordinary signed upgrades.

One-time installer authorization also does not override background-item revocation. macOS exposes background services in Login Items & Extensions; on macOS 26, apps that leave tasks running after quitting may trigger additional user-facing background permission. The promise should be “no repeated password for routine schedule transitions,” not “one click forever regardless of revocation or updates.” [Apple background-task management](https://support.apple.com/en-gb/guide/deployment/depdca572563/web)

Any persistent-helper implementation needs a supported uninstall action that first restores Unhook's entries, disables/removes its service and then removes files. Dragging the app into Trash alone does not reliably remove a globally installed daemon. Updates must replace binaries safely and preserve trustworthy client identity. Preserve short expiry leases and restoration retries so a crashed or removed app cannot leave permanent blocking. The current lease model still requires the app's scheduling engine to run; an independently scheduled daemon would be a separate feature. These lifecycle requirements are engineering conclusions from our current helper design.

## Why caching authorization is not a daily solution

Authorization Services caches credentials according to each right's policy and timeout, and may obtain fresh credentials when existing credentials are unavailable. This is not a permanent grant across app restarts, login sessions, or revocation. [Apple Authorization Concepts](https://developer.apple.com/library/archive/documentation/Security/Conceptual/authorization_concepts/02authconcepts/authconcepts.html)

Apple marks `AuthorizationExecuteWithPrivileges` deprecated and recommends a launchd helper or Service Management instead. It specifically cautions against indiscriminately running tools as root. Do not extend system-wide authorization timeouts to make a focus schedule work. [AuthorizationExecuteWithPrivileges](https://developer.apple.com/documentation/security/authorizationexecutewithprivileges)

## Network enforcement alternatives

On macOS, content filters and DNS proxies can be packaged as system extensions from macOS 10.15; transparent proxies support system-extension packaging for direct distribution. These macOS cases do **not** inherit the supervised-device restriction of some iOS providers. Direct distribution requires Developer ID signing, provisioning profiles, Network Extension entitlements with the appropriate `-systemextension` value, and system-extension packaging. They are not a shortcut to distributing an unsigned app. [TN3134](https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment), [Apple DTS: exporting Developer ID Network Extensions](https://developer.apple.com/forums/thread/737894)

Standard Network Extension provider capabilities generally do not need a bespoke Apple approval request; developers enable the capability in their App ID/profile. Other specialized capabilities have their own rules. [Apple DTS: entitlement guidance](https://developer.apple.com/forums/thread/67613)

A content filter is the promising direction if Unhook must work without a browser companion: it acts on network flows rather than just changing future DNS lookups. That is a design recommendation, **not** a verified guarantee of matching every website in every browser. Hostname metadata, HTTPS encryption, QUIC, shared IPs/CDNs, established flows, and reconnect behavior need a prototype/test matrix. System-wide filtering can also affect non-browser apps. A network layer cannot recreate the extension's branded browser redirect for arbitrary HTTPS sites by serving an untrusted certificate.

A DNS proxy or local resolver can maintain a stable configuration and change a domain policy internally at schedule start/end. However, cached answers, connections already open, direct IP access, app-specific DNS-over-HTTPS, VPNs, and alternate resolvers must be tested; DNS-only policy should not be advertised as a complete network barrier. A local resolver adds upstream forwarding, resolver restoration, port/network lifecycle and outage handling. Those are engineering implications, not an Apple guarantee of behavior.

The separate DNS Settings API creates a system-wide encrypted DNS configuration using DoH or DoT, and the user must explicitly enable it. It configures a server; it does not supply a local domain-filtering engine or a built-in daily scheduler. Hosting that engine remotely changes the product's privacy/network/service footprint. [Apple DNS Settings](https://developer.apple.com/documentation/networkextension/dns-settings)

Using `pfctl` with a privileged daemon could remove daily prompts, but it is not an appropriate public-release shortcut. Apple explicitly says Packet Filter is not a product API because rules can collide with system services, other products and user rules, and recommends Network Extension instead. IP-level rules also do not map cleanly to a website blocklist. [TN3165: Packet Filter is not API](https://developer.apple.com/documentation/technotes/tn3165-packet-filter-is-not-api)

## Shortcuts to reject

- Making `/etc/hosts` user-writable removes its security boundary for every process with that access and can alter unrelated name resolution. It does not solve cache/connection bypasses.
- A broad `sudoers NOPASSWD` entry lets other processes invoke privileged commands. A fixed, root-owned, carefully bounded executable could technically be narrower, but requires privileged install and security review anyway; a launchd daemon offers better lifecycle and recovery. Apple says programmatic sudo is not an appropriate product API. [Apple DTS privilege guidance](https://developer.apple.com/forums/thread/708765)
- `setuid` helpers and running the GUI as root have substantial attack surfaces; Apple advises against both. [Apple DTS privilege guidance](https://developer.apple.com/forums/thread/708765)
- Saving the administrator password, putting it into scripts, or automating password dialogs is not an acceptable authorization architecture.

MDM can approve matching background items and deploy/manage system extensions. It solves this for an organization that already manages its Macs, not for ordinary customers. [Managed background items](https://support.apple.com/en-gb/guide/deployment/depdca572563/web), [managed system extensions](https://support.apple.com/guide/deployment/system-extensions-in-macos-depa5fb8376f/1/web/1.0)

## Decision for Unhook

1. **Fastest safe improvement:** use Developer ID signing/notarization and exercise our existing helper on a clean Mac. The user keeps the DMG, approves system blocking once, then daily transitions require no password while Unhook and its approved helper work.
2. **Private beta if signing is unavailable:** investigate a root-owned PKG-installed daemon with a reviewed beta trust scheme, explicit removal, lease recovery and clean-machine validation. This is feasible research territory, not a ready toggle in the current app.
3. **Public app-only reliable blocking:** prototype a signed Network Extension content filter; keep hosts blocking explicitly best effort meanwhile. Permission convenience and enforcement reliability are separate problems.

For distribution signing, Apple uses Developer ID Application for executable code and Developer ID Installer for installer packages; notarization accepts DMGs and flat PKGs. [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates), [notarization preparation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

No helper was installed, no hosts/DNS/network configuration changed, no password collected, and no release published during this research.
