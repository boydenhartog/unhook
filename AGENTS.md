# Project guidance

Unhook is a local desktop website blocker built with Tauri 2, React 19,
TypeScript, Vite, and Rust. The repository directory is `openfocus_2`, but the
product and executable are named Unhook. There are no accounts, analytics,
cloud services, or remote blocklist requests.

## Start here

- Read `README.md` for setup and behavior, and `docs/contract.md` before changing
  IPC, settings, sessions, scheduling, or setup status.
- Read the relevant implementation and tests before editing. Follow existing
  patterns and keep changes scoped to the task.
- Check `git status` first. Preserve unrelated edits and untracked work; do not
  reset or overwrite them. Avoid committing generated build output.
- Keep the contract and relevant guides current when behavior changes.
  `docs/verification.md` records past checks, not proof that the current tree
  passes or that all platforms have been verified.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/` | React interface, hooks, TypeScript types, native IPC adapter, browser preview |
| `src/service.ts`, `src/types.ts` | Frontend service boundary and shared IPC types |
| `src-tauri/src/` | Commands, controller, persistence, sessions, scheduler, tray, browser integration, system service and login registration |
| `crates/unhook-core/` | Domain validation, hosts transactions, schedule evaluation, DNS operations, fixture-friendly CLI |
| `crates/unhook-browser-host/` | Constrained native messaging host and connection receipts |
| `crates/unhook-system-helper/` | Authenticated macOS system blocker and lease recovery |
| `native/macos/` | Objective-C service/security bridges and embedded LaunchDaemon plist |
| `extension/` | Chrome/Brave companion source and tests |
| `scripts/` | Sidecar preparation, extension packaging, macOS PKG builder and tests |
| `.github/workflows/build.yml` | macOS, Windows and Linux verification and unsigned test artifacts |

Consult `docs/operations.md` for fixtures and recovery,
`docs/browser-companion.md` for native messaging,
`docs/system-helper.md` for privilege boundaries, and
`docs/macos-installer.md` for packaging and release acceptance.

## Development and verification

Use Node.js 24.12+ and stable Rust with the target platform's Tauri prerequisites.
Run commands from the repository root.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies from the lockfile |
| `npm run dev` | Browser UI preview at `http://127.0.0.1:1420` |
| `npm run desktop` | Native Tauri development; automatically prepares sidecars |
| `npm test` | Vitest tests for frontend, extension and packaging |
| `npm run format:check` | Check source and documentation formatting with pinned Prettier |
| `npm run typecheck` | Strict TypeScript checks, including unused locals and parameters |
| `npm run build` | TypeScript check, Vite build, companion runtime packaging |
| `npm run test:core` | Core Rust tests without the desktop build |
| `cargo fmt --all -- --check` | Rust formatting check |
| `cargo test --workspace` | Tests for every Rust workspace member |
| `cargo clippy --workspace --all-targets -- -D warnings` | Strict Rust lint checks |

Before Rust workspace checks on a fresh checkout, run these in order:

```sh
npm run build
npm run prepare:browser-host
npm run prepare:system-helper
```

Tauri checks need the generated resources and sidecars. Plain `cargo test` uses
the workspace's default member, `unhook-core`; use `--workspace` for full coverage.
There is no npm lint script; `npm run build` checks TypeScript. Run `npm run
format` before review; generated output and historical planning/research records
are excluded. Rust uses `cargo fmt`; check the shared build helper separately
with `rustfmt --edition 2021 --check native/macos/build-support.rs`.

Run checks appropriate to the change. Add regression coverage for behavior
changes using the existing colocated Vitest tests, core integration tests, or
Rust module tests. For changes across frontend/native boundaries, use the full
verification sequence from `README.md`. Check changed UI in a real browser;
browser preview cannot establish native enforcement or OS permission behavior.
Report checks actually run and any remaining platform or release verification.

## Behavior and interface boundaries

- Rust owns native session intent, schedules, countdowns and persistence. The
  GUI calls commands through `src/service.ts`. Keep Rust serialization,
  TypeScript types, command arguments and `docs/contract.md` aligned: JSON and
  argument names are camelCase; command names are snake_case.
- Browser preview is explicitly simulated in localStorage and never blocks
  sites. Native command failures must surface errors, never switch to preview.
- Browser blocking is the default. Session intent and actual system blocking
  are separate states; browser-only operations must not automatically edit hosts.
- Schedules use local wall-clock time, Monday = 0 through Sunday = 6, and
  same-day windows. Manual focus overrides schedules and breaks. Stopping focus
  suppresses the current scheduled window. The desktop process must stay running;
  closing the window keeps the tray process alive.
- Hosts matching covers exact domains and explicit `www` companions, with IPv4
  and IPv6 mappings. Preserve unrelated hosts bytes, marked-section validation,
  backups and atomic writes. Do not broaden this into wildcard blocking.
- The companion follows the app's accepted state. Native messaging only reads
  state and acknowledges successful application; it cannot control sessions,
  supply file paths or execute commands. Preserve origin validation, message
  bounds, private atomic snapshots/receipts, deadlines and stale-state expiry.
- The signed macOS helper authenticates peers and grants bounded leases.
  Preserve fixed paths, same-team signature checks, hardened runtime and recovery
  after expiry or failure. Service approval, browser connection and login status
  are separate OS/runtime checks. Unsigned macOS builds retain the documented
  password fallback; failed approved-service connections must not silently
  switch authorization methods.

## Safe native verification and packaging

Never test blocking against the real system hosts file. Use temporary fixtures.
For debug GUI tests, set **both** `UNHOOK_TEST_HOSTS` and `UNHOOK_TEST_STATE` to
temporary files before `npm run desktop`. Fixture mode disables real DNS,
elevation and OS registration. These overrides are debug-only; never invoke the
elevated helper as a fixture test. CLI exercises must pass `--hosts PATH`.

Routine verification must not install packages, replace `/Applications/Unhook.app`,
alter browser permissions, register services or change login items. Follow the
documented acceptance steps when live installation or OS integration testing is
explicitly requested.

Build installers on their target OS. For local macOS packaging use
`npm run package:macos -- --development`; inspect the artifact without installing
it. Public packages require matching Developer ID Application/Installer teams,
then notarization and clean-machine acceptance. Keep npm, Tauri config and desktop
Cargo release versions aligned; the extension has its own version. Edit source
files rather than generated `dist/`, `target/` or `src-tauri/binaries/` output.
Never store credentials or signing keys in the repository.

## Local CLI authentication

- GitHub CLI (`gh`) is authenticated through the macOS Keychain on this machine.
  If a sandboxed Codex command such as `gh auth status`, `gh pr ...`, `gh api ...`,
  `gh issue ...`, or `gh run ...` reports an invalid/missing token while the user
  is logged in locally, do not ask the user to reauthenticate and do not copy
  tokens into files. Rerun the same `gh` command with
  `sandbox_permissions: "require_escalated"` so it can use host Keychain access.
  Use a narrow `prefix_rule` such as `["gh", "pr"]`, `["gh", "api"]`,
  `["gh", "issue"]`, `["gh", "run"]`, or `["gh", "auth"]` when requesting approval.
