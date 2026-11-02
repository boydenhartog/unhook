# Unhook macOS package implementation

Historical completed scope. The embedded-only route below is superseded by
[the corrected private-beta daemon plan](2026-10-01-private-beta-daemon.md).

Keep both the desktop app and companion extension. Package the existing embedded,
authenticated SMAppService daemon rather than installing a second global daemon.
The installer places Unhook in `/Applications`; normal user setup registers and
checks the system helper, guides any required macOS approval, and connects the
browser companion. Installation authorization does not silently approve a daemon.

## Deliverables

- Version 0.2.0 app and fixed-location macOS 13+ PKG, with explicit development
  artifact naming and strict signed-release validation.
- Opt-in launch at login, sourced from SMAppService status rather than a saved
  boolean, plus explicit system-helper removal after hosts restoration.
- Upgrade preflight that preserves settings and refuses a running app/helper;
  safe unregister-before-upgrade instructions and signed-release documentation.
- Fixture checks, frontend/native tests, package inspection and local artifacts.

## Boundaries

Do not relax helper authentication, save passwords, publish the extension, change
live hosts/DNS, register a service/login item, or install the package during
development verification. Missing signing credentials produce a clearly marked
development package; they do not turn it into password-free system blocking.

## Ownership

Packaging worker: package builder, installer assets/scripts, CI, packaging docs.
Native worker: login service and helper unregister APIs/status.
Frontend worker: Setup actions, OS status UI and contract tests.
Root: native command integration, versions, docs, security review and final checks.
