# Unhook macOS beta backlog

Created 2 October 2026. This is the next-work plan; it does not claim release
acceptance or replace the installed-daemon design in the existing plans.

## Target and boundaries

Proposed first cohort: 10–20 invited testers on Apple Silicon Macs, macOS 13+
within the versions actually tested, using Chrome or Brave. Browser blocking
remains the default; system blocking and launch at login remain optional.
Advertise only OS versions covered by acceptance evidence. Intel, Windows,
Linux, Safari, Firefox, payments, accounts and automatic desktop updates are
later work. Start free; decide price and source availability before public sales.

The target onboarding experience is a signed, notarized PKG plus a store-installed
companion. An unsigned PKG with an unpacked companion remains an engineering
test route, not evidence that ordinary beta onboarding is ready.

Preserve the authenticated helper, fixed paths, short leases, exact domain
matching and user-local browser registration. Use fixtures for development.
Live installation, services, permissions and system blocking acceptance belong
on an explicitly designated disposable Mac/VM, not the developer's daily machine.

## Evidence available now

The assessment earlier in this chat ran 99 Vitest tests, 73 Rust tests, the
frontend build, sidecar preparation, Rust formatting and strict Clippy successfully.
Production npm audit reported no known vulnerabilities. The Rust authentication
fixture needed host access to bind its temporary socket. These checks apply to
the working tree at assessment time, not a future release commit.

Existing macOS package scripts install the app, protected daemon and approved
code hashes. Public packaging validates signatures but does not submit the final
PKG for notarization. CI currently uploads development artifacts. Setup still
uses Developer mode / Load unpacked. Native connection readiness currently checks
the exact bundled companion version. Substantial source changes are uncommitted.

## Task order

| ID | Task | Owner | Dependency | State |
| --- | --- | --- | --- | --- |
| B01 | Record a recoverable source baseline | Engineering | None | Ready |
| B02 | Make companion compatibility explicit | Engineering | B01 | Implemented and verified in working tree; release snapshot pending |
| B03 | Show actionable compatibility status | Engineering | B02 | Queued |
| B04 | Produce a clean extension-store upload | Engineering | B01 | Ready |
| B05 | Reserve the store identity and prepare listing | User + engineering | B04 | Account action needed |
| B06 | Connect store installation to desktop Setup | Engineering | B03, B05 | Queued |
| B07 | Prepare Apple signing credentials | User | None | Membership status pending |
| B08 | Add final-PKG notarization and validation | Engineering | B07 for live validation | Can prepare workflow now |
| B09 | Prepare tester instructions and licensing decision | User + engineering | None | Ready |
| B10 | Freeze and verify the signed beta candidate | Engineering | B01–B09; approved store availability | Queued |
| B11 | Run clean-machine acceptance | User + engineering | B10 | Disposable test machine needed |
| B12 | Invite a small cohort and triage feedback | User | B11 | Queued |

The user requested B02 directly; it is implemented and verified in the current
working tree. B01 still needs to capture the intended foundation before release.
B04 and account setup need not wait for that snapshot.
No task requires creating new chats or dispatching agents.

## B01 — Record a recoverable source baseline

Scope: Git history and the current intended source changes; small operational task.

- [ ] Identify intended changes and preserve every unrelated edit/untracked file.
  Do not stage the entire working tree indiscriminately.
- [ ] Save the intended beta foundation in coherent commits; generated dist,
  target and sidecars remain excluded. Record the commit used as the baseline.
- [ ] Review the committed diff and use a fresh checkout for CI verification when
  the candidate is ready. Existing local test results are context, not CI proof.

Verification: `git status`, staged diff inspection and commit inventory. Do not
push, merge or tag merely to complete this planning task.

## B02 — Make companion compatibility explicit

Implemented 2 October 2026: host response advertisement `ackProtocolVersion: 1`,
negotiated `protocolVersion: 1` acknowledgements, protocol-based receipt acceptance
and a finite 0.2.0/0.2.1 legacy path. Companion 0.2.2 retains the old request schema
when the host has no advertisement. Earlier desktops still require a desktop-first
migration. Setup copy and connected-version reporting were also corrected; B03's
distinct incompatibility status remains separate work. See the current contract
and verification notes for the exact migration and checks.

Scope: `src-tauri/src/browser.rs`, `crates/unhook-browser-host/src/main.rs`,
`extension/background.js`, its tests and `docs/contract.md`; medium.

- [ ] Replace release-number equality as the connection contract with an explicit
  supported protocol/capability signal. Preserve bounded messages, acknowledged
  successful application and 15-second freshness checks.
- [ ] Specify the migration: the current host rejects extra request fields, so
  a newer companion must not blindly send a new acknowledgement schema to an
  older host. Support an explicitly tested legacy path or require the new desktop
  release before publishing the new companion.
- [ ] Cover compatible patch updates, legacy/new pairs, unsupported protocol,
  malformed receipts, stale/future timestamps and failed rule application.
  Unknown protocols must not report Ready. Do not accept every future version.

Verification: focused Rust/extension regression tests followed by the README
verification sequence for this native/extension boundary. Document which pairs
work before the first store release; do not publish as part of implementation.

## B03 — Show actionable compatibility status

Scope: native SetupStatus, TypeScript/service boundary, Setup UI and contract;
split into native status and UI commits if the slice grows beyond five files.

- [ ] Distinguish missing/disconnected, compatible and incompatible companions;
  expose only the information needed to tell the user which component to update.
- [ ] Update native serialization, TS types and preview together. Native failures
  continue to surface errors rather than simulated success.
- [ ] Verify keyboard access, accurate readiness text and layout in a real browser;
  check legacy setup data and loading/error states with fixtures.

Verification: colocated native/frontend tests, full boundary checks, browser UI
inspection. Browser preview does not establish native enforcement.

## B04 — Produce a clean extension-store upload

Scope: extension packaging script, packaging tests and browser companion guide;
small. Reuse the existing runtime export rather than adding another file list.

- [ ] Produce a versioned ZIP with manifest at the root and the complete runtime,
  excluding tests, generated development fixtures and unrelated files.
- [ ] Check the ZIP against runtime source, manifest version and required files.
  Give the upload artifact a checksum and record its source commit.
- [ ] Document how to make a draft upload without publishing.

Verification: archive inspection and a focused packaging regression test. A
successful archive is not store approval or proof of installed enforcement.

## B05 — Reserve store identity and prepare listing

Scope: external developer account and draft listing; user action with engineering
support. Draft/upload work and publication are separate steps.

- [ ] Set up the developer account and upload the ZIP as a draft. Record its item
  ID and public key. Do not assume the current unpacked ID survives publication.
- [ ] Prepare listing description, screenshots, permission justifications, support
  contact and accurate privacy disclosures. Describe local task/count storage and
  broad URL permissions, and make the desktop-app dependency clear.
- [ ] Choose beta visibility and submit the reviewed listing when authorized.
  Record store approval and the install URL before testing consumer onboarding.

Verification: compare the draft item ID/public key with the development extension
ID. Google documents obtaining the public key from an unpublished draft:
https://developer.chrome.com/docs/extensions/reference/manifest/key

## B06 — Connect store installation to desktop Setup

Scope: origin constant/manifest, native setup launch and Setup UI/docs; medium,
with identity changes and UI changes as separate commits if needed.

- [ ] Align the extension key, native host origin allowlist and listing URL with
  B05. Retain exact-origin validation. Document removal of the old unpacked
  companion when migrating, avoiding two simultaneously active companions.
- [ ] Offer an Add companion action leading to the actual store listing. Keep
  unpacked instructions for development; ordinary tester instructions use the store.
- [ ] Test installation and native acknowledgement in each browser independently,
  including a second profile and missing-host behavior.

Verification: full boundary checks; isolated profile/fixture enforcement checks
before clean-machine acceptance. Store review timing may require a rebuilt
candidate; repeat verification after final identity/runtime changes.

## B07 — Prepare Apple signing credentials

Scope: Apple account and build-user Keychain; user action.

- [ ] Confirm active developer membership and obtain Developer ID Application and
  Developer ID Installer identities from the same team.
- [ ] Configure notarization credentials through the build user's Keychain or a
  suitable secret manager. Never put keys, passwords or tokens in the repository.
- [ ] Choose a documented local signing workflow for the first beta. Automated
  CI signing is optional; unsigned CI artifacts must remain clearly identified.

Verification: validate the actual signatures/team during B08/B10 without printing
secrets or changing the installed app. Enrollment status is currently unanswered.

## B08 — Add final-PKG notarization and validation

Scope: a separate release command/script, its focused tests and installer guide;
medium. Preserve the existing development package route.

- [ ] Submit the final signed PKG, wait for an accepted notarization result, staple
  the ticket and validate it. Fail clearly on rejection or missing credentials.
- [ ] Inspect app/helper signatures and PKG signature, then assess the finished
  distribution artifact. Record the checksum after stapling, not before it.
- [ ] Keep packaging, submission and publishing separate. A failed notarization
  must never leave an artifact described as ready for distribution.

Verification: command/error-path fixtures plus live validation with B07. No package
installation is needed for this task. Official reference:
https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution

## B09 — Prepare tester instructions and licensing decision

Scope: concise beta guide and release terms; small document tasks.

- [ ] Write installation, browser connection, schedule use, manual update,
  service removal and troubleshooting instructions. Include awake/running-app,
  exact-domain and deliberate-bypass limitations in plain language.
- [ ] Decide whether this cohort receives MIT-licensed software or another
  permitted license. Check ownership/contributions and dependency notices first;
  reconcile LICENSE, README and release metadata before distribution. Do not
  change the existing license automatically because pricing is undecided.
- [ ] Choose a support contact and a feedback form/template. Ask for OS/browser/
  app versions, steps and visible errors; avoid requesting browsing history,
  reflection answers or an unredacted settings file.

Verification: a new reader can follow the draft without developer setup knowledge.
License and source availability are separate from whether downloads cost money.

## B10 — Freeze and verify the signed candidate

Scope: release operations; record evidence in the acceptance document.

- [ ] Select the final source commit, increment aligned npm/Tauri/desktop Cargo
  versions and build in a clean checkout. Run the full README checks and CI on
  that commit. Inspect the finished PKG and bundled companion.
- [ ] Complete B08 and record source SHA, app/extension versions, store ID,
  architecture, signing team, notarization result and final artifact checksum.
- [ ] Provide a manual update procedure: stop focus, quit, install the newer PKG,
  reopen and verify connections. Keep a repair release path; the installer rejects
  downgrades, so an older PKG is not a general rollback mechanism.

Verification: signed/notarized artifact inspection without installation, then B11.
Any source/artifact change invalidates affected acceptance rows.

## B11 — Run clean-machine acceptance

Use `docs/beta-acceptance.md`. Explicitly designate disposable systems before
installing packages or enabling live system blocking. Cover the oldest advertised
macOS version and a current version; otherwise narrow the supported beta range.

- [ ] Download and install the actual candidate; verify Gatekeeper, offline
  acceptance, normal-user launch, both browsers and optional service/login setup.
- [ ] Complete session, schedule, expiry, sleep/wake, crash recovery and permission
  revocation tests. Compare unrelated hosts bytes and shared-parent metadata.
- [ ] Complete real upgrade, interrupted-update repair and service/app removal.
  Failures become blocking tasks; retain artifact-specific evidence.

Verification: every required acceptance row is Pass with evidence, or an explicit
scope reduction removes the advertised behavior. Automated fixtures cannot fill
live acceptance rows. Obtain focused review of helper authentication and installer
lifecycle changes before shipping them.

## B12 — Invite and learn

Begin with 2–3 testers; expand to 10–20 after installation and recovery work without
hands-on intervention. Share only the accepted artifact and matching instructions.
Invitation messages/publication require the user's authorization.

- [ ] Record whether each tester installs/connects unaided and completes focus.
- [ ] Collect feedback over roughly a week through the chosen contact, keeping
  accounts and analytics out of the app.
- [ ] Stop expansion for stranded blocking, unsafe updates, data loss or recurrent
  connection failures; ship a verified repair before resuming. Decide whether to
  test payment only after the cohort demonstrates dependable installation/use.

## Beta entry gate

- [ ] Exact candidate commit and artifact are recoverable and verified.
- [ ] Signing/notarization and companion-store installation work.
- [ ] Compatible updates remain connected; incompatible ones give actionable errors.
- [ ] Clean-machine lifecycle and recovery acceptance pass for advertised support.
- [ ] Tester instructions, licensing, contact and repair procedure are ready.

Open owner inputs: Apple membership/credentials, store account/item identity,
disposable Mac availability, support contact and license choice. Engineering work
can begin with B01–B04 while those inputs are resolved.
