# Contributing to Unhook

Unhook is a local desktop focus aid. Changes should keep its behavior understandable, its privilege boundaries narrow, and its failures recoverable.

## Get started

Use Node.js 24.12 or later (24 LTS recommended) and install dependencies from the lockfile:

```sh
npm ci
npm run dev
```

The browser preview at [127.0.0.1:1420](http://127.0.0.1:1420) simulates settings and sessions. It never blocks websites or invokes native permissions. No environment file, cloud account, database, or backend service is required.

Native development additionally requires stable Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Read [the architecture](docs/architecture.md) and [implementation contract](docs/contract.md) before changing native boundaries.

## Native development with fixtures

Never use the real system hosts file for routine development or automated tests. Set **both** debug-only fixture overrides before starting the desktop app:

```sh
UNHOOK_FIXTURE_DIR="$(mktemp -d)"
printf '127.0.0.1 localhost\n::1 localhost\n' > "$UNHOOK_FIXTURE_DIR/hosts"
UNHOOK_TEST_HOSTS="$UNHOOK_FIXTURE_DIR/hosts" \
UNHOOK_TEST_STATE="$UNHOOK_FIXTURE_DIR/state.json" \
npm run desktop
```

Fixture mode disables real DNS flushing, elevation, browser-host registration, service registration, and login-item changes. The overrides are compiled out of release builds. Do not invoke the elevated helper for fixture testing: it uses fixed real system paths.

For core CLI exercises, always pass an explicit fixture path:

```sh
cargo run -p unhook-core --bin unhook-cli -- --hosts "$UNHOOK_FIXTURE_DIR/hosts" status
```

Routine checks must not install PKGs, replace an installed app, change browser permissions, register services, or alter login items. Live acceptance belongs on an explicitly designated disposable Mac/VM using the [installer guide](docs/macos-installer.md).

## Code conventions

- Run `npm run format` for TypeScript, JavaScript, styles, manifests, and current guides. Use `cargo fmt --all` for workspace Rust, and `rustfmt --edition 2021 native/macos/build-support.rs` for the shared build helper. Generated output and historical planning/research records are excluded from Prettier.
- Prefer named functions and explicit control flow when they make orchestration easier to follow. Keep shared presentation helpers outside page components.
- Keep the frontend/native boundary in `src/service.ts` and `src/types.ts`. Native command names are snake_case; serialized JSON and command arguments are camelCase.
- Preserve the distinction between native operation and simulated preview. Native failures must remain visible.
- Add regression coverage for changed behavior using the existing colocated tests. Test public behavior and boundary guarantees rather than implementation details.
- Edit source files, not generated `dist/`, `target/`, or `src-tauri/binaries/` output. Keep credentials and signing keys outside the repository.

## Verify a change

The standard frontend/extension checks are:

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

Examples of focused tests:

```sh
npm test -- src/components/SchedulePage.test.tsx
npm test -- extension/blocked.test.js
npm run test:core
```

For native or cross-boundary work, run this sequence from the repository root:

```sh
npm run build
npm run prepare:browser-host
npm run prepare:system-helper
cargo fmt --all -- --check
rustfmt --edition 2021 --check native/macos/build-support.rs
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Plain `cargo test` uses only the default workspace member, `unhook-core`; it is not a full workspace check. There is no npm lint script. TypeScript checking and formatting are separate checks.

Inspect user-facing changes in a real browser, including keyboard navigation and relevant narrow-window states. Browser preview checks do not establish native enforcement, permission behavior, or installer acceptance. Record which platform and checks were actually exercised.

## Prepare a review

Keep each change focused. Explain the problem, resulting behavior, and relevant tradeoffs, then list the checks run and any remaining platform limitations. Preserve unrelated work in a shared checkout; do not stage or reset the entire tree indiscriminately.

For changes to IPC, scheduling, setup, or recovery, update [docs/contract.md](docs/contract.md) and the relevant guide. The historical verification log is evidence about past trees, not proof that a new release candidate passes.

Security-sensitive changes deserve explicit review of the affected trust boundary. Do not include signing material, personal browser data, or sensitive logs in a contribution.
