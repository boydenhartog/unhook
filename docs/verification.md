# Verification — 1 October 2026

## Companion update compatibility — 2 October 2026

The working tree now negotiates browser acknowledgement protocol 1 independently
of release numbers. The host advertises `ackProtocolVersion`; the companion sends
the new field only after that advertisement. New hosts/desktops accept known legacy
0.2.0/0.2.1 acknowledgements and explicitly supported protocol receipts. Unknown
protocols, malformed versions and stale/future receipts cannot establish readiness.
Companion runtime version is 0.2.2; the desktop release version was not changed.
Upgrade the desktop before this first companion migration: previously installed
desktops retain their exact-release check. This section records checks on the
current working tree and is not a signed release or installation acceptance.

- New desktop/host/extension regression tests first failed against the previous
  behavior, then passed. The legacy request schema remains unchanged for hosts
  that reject new fields. Unsupported acknowledgements do not refresh receipts.
- `npm test`: 106 tests pass. `cargo test --workspace`: 76 tests pass. The full
  Rust suite used host access for temporary authentication-fixture sockets.
- `npm run build`, both sidecar preparation commands, Rust formatting, strict
  workspace Clippy and diff whitespace checks pass.
- An isolated temporary Chromium profile loaded the actual packaged companion
  with a fixture native port. Real request-rule/storage APIs verified supported
  protocol acknowledgement, the old-host request schema, rule removal without
  acknowledgement on unsupported protocol and rejection of malformed state.
  The fixture port never contacted a native host.
- The real Setup component rendered with inert waiting/connected props in Chromium
  shows compatibility guidance and actual companion v0.2.9. No page errors or
  horizontal overflow at 320/1100 pixels. Desktop screenshots were inspected.
  Temporary source/profile fixtures were removed after verification.

No installed app, real browser profile, system hosts/DNS, service registration or
login item was changed. No installer was produced/installed or extension published.
Live installed old/new version pairs and Windows/Linux behavior remain release
acceptance checks. Historical records below describe earlier verification.

Corrected private-beta persistent daemon route (supersedes the app-only package
scope below):

- `npm test`: 64 frontend, companion and package tests pass. The 14 package tests
  include protected ownership/modes, ACLs, symlinks/hardlinks, running-app and
  embedded-helper conflicts, stop-before-restore upgrades, restore/bootstrap
  failures, all-architecture pins and actual macOS package metadata roundtripping.
- `cargo test --workspace`: 71 Rust tests pass (35 desktop, 18 system helper,
  15 core and 3 browser host). Temporary signed socket clients demonstrate
  acceptance of approved hardened ad-hoc app code and rejection of wrong hashes,
  identifiers, missing runtime, six unsafe entitlement categories and changed
  sealed bundle resources. Protected-file fixtures reject ACL grants even with
  safe POSIX modes. Startup recovery still restores stale entries before rejecting
  damaged pins; uninstall restore failure prevents deletion.
- `npm run build`, both sidecar preparation commands, `cargo fmt --all -- --check`,
  and `cargo clippy --workspace --all-targets -- -D warnings` pass. Local socket
  fixture tests used host access because the sandbox denies binding those sockets;
  they did not launch the real root daemon. `npm audit --omit=dev` reports zero
  known production dependency vulnerabilities. Diff whitespace checks pass.
- `npm run package:macos -- --development` built the final native app; after the
  package-only directory-permission correction,
  `npm run package:macos -- --development --skip-build` produced
  `target/release/bundle/pkg/Unhook_0.2.0_arm64_PRIVATE_BETA_UNSIGNED.pkg`
  (4,807,774 bytes). The earlier `DEVELOPMENT_UNSIGNED.pkg` artifact remains
  untouched and does not implement this route.
- Expanded final inspection at
  `/private/tmp/unhook-final-pkg-inspect.tI2jwV/expanded` confirms the app, global
  protected helper, installed LaunchDaemon and code-hash pins; root/wheel BOM
  ownership, protected file modes, administrator authorization, fixed installation
  location, whole-bundle upgrade/strict identifier metadata, and both lifecycle
  scripts matching rendered source. `overwrite-permissions="false"` preserves
  existing shared directory permissions. A package fixture proves that changing
  this attribute leaves compressed payload and BOM bytes unchanged.
- Strict deep/all-architecture code verification passes for the expanded app.
  Its executable is ad-hoc signed with hardened runtime, its CDHash matches the
  installed pins, the global and embedded helper bytes match, and packaged
  companion files match source. `pkgutil --check-signature` reports no PKG
  signature, as intended for the private beta; this is separate from executable
  integrity signing.
- CUA checked the actual production Setup component with inert installer-state
  fixtures: connected service, unavailable/repair actions, no enable toggle while
  unavailable, appropriate recovery text, separate login state, accessible
  controls and no horizontal overflow at 320 pixels or the default desktop size.
  A fresh browser tab had no console errors/warnings. The temporary fixture page
  and preview server were removed/stopped. Screenshots are
  `unhook-installed-service-ready.jpg` and `unhook-installed-service-repair.jpg`
  in this chat's visualization output directory. These are simulated UI states,
  not proof of a live installed daemon.
- Independent cross-review covered daemon authentication, recovery/removal and
  package lifecycle. Production GUI assets are embedded into the release
  executable by Tauri's directory-based `frontendDist` generation, so privileged
  IPC-capable frontend code is included in the pinned executable identity.

No live hosts/DNS, installed app, daemon registration, login item or browser
permissions were changed. No PKG was installed and nothing was published.
Downloaded/offline Gatekeeper, background permissions/revocation, reboot, login,
prompt-free schedule transitions, embedded-registration migration, upgrades,
shared-parent metadata preservation, interruption repair and removal still need
clean-machine/VM acceptance. Public signing/notarization also remains unverified.
Temporary inspection/snapshot directories are OS-managed and not durable. See
[current installer guide](macos-installer.md).

The following records describe the previous app-only package and earlier work;
their signing restrictions do not describe the corrected private-beta artifact.

macOS 0.2.0 package installer follow-up:

- `npm test`: 55 frontend, companion and packaging tests pass. Installer fixtures cover stale versions, public/development boundaries, signatures, upgrade conflicts, running apps/helpers, symlinks and downgrade rejection. Setup tests cover approval states, service removal and launch-at-login commands.
- `cargo test --workspace`: 55 Rust tests pass. After integration review, service removal and concurrent enable were serialized under the controller lock; all 30 desktop tests pass again. Strict workspace Clippy and Rust formatting pass.
- `npm run package:macos -- --development`: rebuilt the production frontend and release app and created `target/release/bundle/pkg/Unhook_0.2.0_arm64_DEVELOPMENT_UNSIGNED.pkg` (4.2 MiB). No package was installed.
- Expanded package inspection confirms the fixed `/Applications/Unhook.app` payload, root/wheel ownership, app version 0.2.0, macOS 13 minimum, strict bundle identifier, whole-bundle upgrade metadata, embedded helper and browser host, and companion runtime files matching source. Its only installer script matches the rendered read-only preflight template. There is no postinstall script or global service payload.
- Both installer pages explicitly identify the unsigned development build and password fallback. `pkgutil --check-signature` reports no signature, as expected. Public packaging without a Developer ID Installer identity refuses to run.
- CUA inspected the real production setup preview, including the new schedule/login panel and disabled desktop-only controls. The preview console has no warnings or errors. Screenshot: `unhook-pkg-setup.jpg` in this chat's visualization output directory.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities. Diff whitespace checks pass.

No live hosts/DNS, installed app, helper registration, login item or browser permissions were changed during these checks. Nothing was published to an extension store. Signing/notarization and clean-machine installation, approval, login startup, prompt-free schedule transitions, upgrades and removal remain release acceptance checks; see [macOS installer](macos-installer.md). The development package cannot provide password-free system blocking.

Earlier checks in this document refer to previous builds and sessions:

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
# Setup and optional system blocking — 2026-10-01

Follow-up: restored optional password-based system blocking for unsigned builds after the one-time service requirement incorrectly removed the previously working authorization flow. Regression tests first demonstrated the missing setup toggle and unavailable unsigned backend state, then passed after the fix. Password refreshes are no-ops; signed approved services retain short leases. The updated app/DMG packaged successfully; the active installed focus session was left running rather than interrupted for an update. Browser setup now tells users to load the shown folder if Reload keeps an older companion version.

- 84 automated tests passed: 37 frontend/extension and 47 Rust workspace tests. These cover persisted migration, browser-only zero hosts writes, explicit legacy cleanup, system lease renewal/expiry, failed writes and rollback, protocol limits, stale/wrong-version receipts, and acknowledgement only after successful enforcement.
- `npm run build`, strict workspace Clippy, Rust formatting, and diff whitespace checks passed.
- CUA verified first-run skip/finish, saved completion after reload, revisitable setup, keyboard focus, 320/768/1024 layouts and a clean preview console. No browser permissions were changed during those checks.
- Local macOS app and DMG packaged successfully. Packaged runtime extension files match source, the LaunchDaemon plist and helper are present, the helper retains its signing identifier/hardened-runtime flag, and the actual bundled native host passed read framing and invalid-origin rejection.
- Updated `/Applications/Unhook.app` after confirming its old session was inactive and quitting normally; the previous app is backed up at `/private/tmp/Unhook-before-setup.app`. CUA verified the installed first-run browser wizard, stable exported folder and optional system step's accurate signed-release requirement. The existing companion still needs the user's Reload to adopt the new acknowledgement; its installation was not changed automatically.
- The local helper is ad-hoc signed and correctly cannot register a privileged service. Actual signed release approval and elevated hosts changes remain a release acceptance check; see [system helper](system-helper.md). Automated tests never changed real system hosts.
- No extension-store publication occurred. An already loaded companion needs a Reload to adopt version 0.2.0 and its connection acknowledgement, or a fresh Load unpacked from the stable folder shown in Setup.

# Schedule pause recovery — 2026-10-02

Version 0.2.1 clears the saved stopped-window pause when a changed schedule is saved. Blocklist-only edits retain the pause. Native and preview regression tests reproduced a stopped schedule failing to resume after saving it disabled and enabled, then passed after the fix. The installed 0.2.0 app's saved state and fresh inactive browser acknowledgement confirmed the reported failure; its schedule remained suppressed until 17:00.

- All 66 Vitest and 73 Rust workspace tests passed, along with the production build, Rust formatting and strict workspace Clippy. An existing unsigned-runner test now also checks the fail-closed installer route when service assets are already present.
- Built `target/release/bundle/pkg/Unhook_0.2.1_arm64_PRIVATE_BETA_UNSIGNED.pkg` and expanded it without installation. Its app metadata reports 0.2.1, strict deep code-signature verification passes, and its app CDHash matches the packaged protected pins.
- This check did not install 0.2.1 or change live hosts, service registrations, browser permissions or user settings. Live update and resumed schedule acceptance remain to be checked after installing it.

Follow-up after the user installed 0.2.1: `/Applications/Unhook.app` metadata and the package receipt both report 0.2.1, and the installed executable matches the expanded package payload byte for byte. In the installed app, saving the schedule disabled and then saving it enabled clears `suppressedUntil`, activates scheduled focus, and produces a fresh matching browser acknowledgement. A new Brave tab navigating to `https://marktplaats.nl` redirects to the companion's blocked page. This confirms installation replacement and live browser schedule activation. System blocking remained disabled; system hosts and browser permissions were untouched. Future break/end transitions and system enforcement were not exercised by this check.

# Schedule autosave — 2026-10-02

Version 0.2.2 saves each valid schedule edit immediately and removes the manual Save button. Saving/validation/persistence feedback is above the controls. Invalid drafts retain the last accepted schedule; failed saves offer Retry. Time inputs retain focus while a save is pending.

- DOM interaction tests first reproduced the missing autosave behavior; six now pass. Coverage includes schedule enablement, weekdays, all four time fields, break toggles, invalid drafts across polling, persistence failure/retry, concurrent-save prevention and keyboard focus.
- All 72 Vitest and 73 Rust tests passed, as did the production build, formatting and strict workspace Clippy. Added React Testing Library and jsdom as development dependencies; npm reported no vulnerabilities.
- Real browser preview checks exercised immediate switch/day saving, keyboard time edits, invalid-time correction, draft preservation across scheduler polls, and persistence after reload. No console warnings/errors or horizontal overflow at 320, 768, 1024 or 1440 pixels; feedback remained visible at every tested size. Preview screenshot: `unhook-schedule-autosave-022.png` in the chat visualization directory.
- Built and expanded `target/release/bundle/pkg/Unhook_0.2.2_arm64_PRIVATE_BETA_UNSIGNED.pkg` without installation. App metadata is 0.2.2, strict deep code-signature verification succeeds, and its CDHash matches the packaged pins. The user's installed app, user settings, system hosts and service registrations were left untouched. Live native autosave acceptance remains to be checked after installation.

# Reflective blocked page — 2026-10-02

The companion now asks why a site was opened, then asks for the user's actual
intended task. It offers an offline break or a return-to-task reminder, remembers
the latest task, and counts focus-page arrivals in the browser profile.

- All 99 Vitest tests and 73 Rust workspace tests passed. New tests cover the
  two-question flow, safe task display, persistence, concurrent arrivals,
  reload/retry deduplication, failed storage, in-flight saves, top-level sender
  validation, and stale tab events causing duplicate redirects. Tests first
  reproduced missing behavior. A Rust regression verifies both new runtime
  scripts are included in the desktop's exported companion.
- `npm run build`, `npm run prepare:browser-host`,
  `npm run prepare:system-helper`, Rust formatting, strict workspace Clippy, and
  diff whitespace checks passed. The macOS authentication fixture needed host
  access to bind its temporary Unix socket; the full Rust suite passed on retry.
- An isolated Chromium profile loaded a temporary extension fixture containing
  the real reflection page, scripts, manifest CSP, and storage message handler.
  Its fixture worker did not contact the native host. Both questions, saved task
  reminders, an offline break, actual current-tab closing, two-tab counting,
  and reload deduplication passed with real extension APIs. Its console had zero
  errors or warnings. Layouts had no horizontal overflow at 320, 768, 1024, or
  1440 pixels; narrow and desktop screenshots were inspected.
- The explicitly simulated localhost preview also exercised the questions,
  persisted reminder, and break screen. The packaged companion contains both
  `blocked.js` and `reflection.js` and excludes test files.

These checks did not change the installed app, real browser profile permissions,
system hosts, service registrations, or login items. Live redirects from an
installed companion, installer acceptance, and Windows/Linux behavior were not
retested in this session. Reload a companion from the updated exported folder
after rebuilding/updating the desktop app to adopt the new page.

Follow-up requested update: version 0.2.3 removes the reflection page's privacy
and desktop-management footer lines and local preview banner, and shortens the
counter label to **Blocked-page visits**. Companion version 0.2.1 identifies the
new runtime. All 99 Vitest tests, the production/package build, formatting, and
diff whitespace checks passed. The expanded PKG's companion files match source,
its app signature is valid, and its CDHash matches the packaged protected pins.

The inactive app was stopped after confirming system blocking was disabled.
The verified PKG was installed through macOS Installer, which reported success;
the installed app and package receipt report 0.2.3. The app was restarted from
`/Applications/Unhook.app`. Its settings match the pre-update backup, its code
hash matches the installed pins, its exported companion includes both reflection
scripts and version 0.2.1, and Setup reports **System service connected**.
Browser automation cannot open the browser's extension-management page under
its URL security policy, so the user was asked to reload the existing companion.

## Portfolio presentation and maintainability — 2 November 2026

- Standardized current TypeScript, JavaScript, CSS, HTML, JSON, YAML and guide formatting with pinned Prettier. Added local formatting/typecheck commands, editor settings, a Node 24 version file, and CI formatting checks. Historical planning/research records remain excluded from automatic formatting.
- Moved shared weekday labels and schedule summaries out of page components; named setup action handlers preserve their original ordering and error handling. Added two schedule-summary characterization cases. The native build helper is formatted separately, and existing FFI ownership assumptions now have focused safety comments.
- Refreshed the README with an actual simulated-preview screenshot, contributor instructions and an architecture guide. Release limitations remain explicit; no public signing, notarization, store approval or clean-machine acceptance is claimed.
- Local checks passed: 133 Vitest tests, TypeScript, production build, resource/sidecar preparation, workspace Rust formatting, shared-helper formatting, 76 Rust workspace tests and strict workspace Clippy. One native authentication fixture required host access to bind its temporary Unix socket after the sandbox denied it.
- Updated Vite and Vitest within their existing major versions, plus jsdom's existing undici dependency. Final npm audit reported no known advisories. Package metadata and the lockfile require Node 24.12+, matching the documented development setup.
- Independent source and documentation reviews found one Node-support mismatch, which was corrected. Comparing source against the pre-cleanup snapshot after canonical formatting found no unexpected semantic changes. Local guide links and lockfile metadata were checked.
- An isolated browser verified Focus, Schedule and Setup navigation and the reduced-motion blocked-page preview without JavaScript or console errors. These checks did not install the app, register services, change login items or browser permissions, or modify real hosts/DNS. Windows/Linux and live release acceptance remain separate checks.
