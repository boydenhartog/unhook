# Unhook setup

The desktop launcher remains the only place to control domains, schedules, and focus. Browser blocking is the default and never writes system hosts. Setup exports the bundled companion to a stable per-user folder, registers its native messaging host, guides Chrome or Brave's Load unpacked flow, and verifies a successful configuration acknowledgement before reporting Connected. Publishing to an extension store is outside this change.

The native bridge accepts configuration reads and a bounded acknowledgement of a configuration it supplied. It never exposes session controls, paths, browser history, or privileged operations. A connection expires after fifteen seconds without an acknowledgement.

Optional macOS system blocking uses SMAppService and a signed, same-team helper. macOS owns approval. The helper authenticates the caller, validates domains, changes only Unhook's fixed hosts markers, and restores expired leases. Unsigned local builds explicitly report the option unavailable rather than install an untrusted root service. Existing settings, schedules and session intent migrate intact; existing hosts leftovers have an explicit recovery action.

Follow-up correction: the persistent helper remains unavailable to unsigned builds, but system blocking itself retains the original administrator-password flow as an explicit opt-in. The setup state distinguishes `passwordRequired` from an approved service so users can keep using the previously working feature while signing is prepared.

Implementation is divided between the frontend setup, session/controller state, native authorization service, and browser handshake/packaging. Verify migration, browser-only zero hosts writes, system expiry and failure handling, bounded acknowledgement framing, frontend setup behavior, native compilation, packaged resources, and local app UI. Never alter real hosts in automated tests.
