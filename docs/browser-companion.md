# Unhook browser companion

Unhook remains the only place to manage your blocklist, schedule, and focus sessions. The companion extension has a read-only connection indicator and a focus page, with no independent blocklist or session controls. The existing hosts-file layer remains enabled.

## Install once

1. Build or install the updated Unhook app and open it. It registers the bundled, read-only browser host for your user account automatically. Normal hosts changes still use the existing administrator prompt.
2. In Brave, open `brave://extensions`; in Chrome, open `chrome://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension` folder. This is the local testing installation; publishing to the browser store will provide the normal one-click installation later.
4. Open the extension's toolbar popup. It should say **Connected · ready when you are**. Start focus and edit your sites in Unhook as usual.

For a copy without development tests, use the generated `dist/unhook-companion` folder. The public manifest key fixes the unpacked extension ID to `glcpihjbnhkbbdngjcmdgapodackkkmo`. Store publication must retain this ID or update the native host allowlist in a new app release.

Browser permission to inspect tab URLs and block/redirect requests is required. The extension does not send URLs, page contents, or history to Unhook or any server. Its only native request is `getState`; it cannot change settings, start/stop focus, run commands, or supply a file path. No local HTTP server, pairing token, account, or cloud service is involved.

## Behavior

- The app publishes its accepted session state once per scheduler tick and after changes. The extension reads it over a native messaging port once per second.
- Listed domains and their `www` aliases are blocked; other subdomains still require explicit entries, matching the desktop app's existing behavior.
- New document requests redirect to the focus page, and other matching requests are blocked. Existing matching tabs are moved to the focus page, and restored/cached navigations are checked separately.
- When focus ends, rules are removed. Reopen the original site yourself; the extension does not automatically navigate back into a distraction.
- The session deadline and a 15-second app heartbeat lease bound rule lifetime. Normal disconnects clear browser rules. A stopped/crashed app cannot leave the browser rules indefinitely enabled. System hosts entries still follow their existing crash recovery behavior.
- Browser restarts reconnect automatically. Incognito access must be enabled separately in the browser if needed. Disabled/uninstalled extensions, browsers without the extension, and deliberate bypasses are outside this focus aid's guarantees.

## Development and checks

`npm run desktop` and native packaging prepare the host executable automatically. Before running Rust workspace checks from a fresh checkout, run `npm run prepare:browser-host`; Tauri's build checks require the generated sidecar.

`npm run build` also copies the extension's runtime files into `dist/unhook-companion`. `npm test` covers rule boundaries, edits, restored tabs, expiry, stop, and disconnect behavior. `cargo test --workspace` covers app snapshot publication, permissions, native framing, read-only request validation, and the existing desktop/core behavior.

Native app fixture mode publishes snapshots beside the fixture settings and does not register real browser hosts. Host protocol tests use temporary files. Do not change the system hosts file for automated development tests.

Manual browser acceptance: visit Marktplaats, close its tab, start focus in Unhook, reopen Marktplaats, and confirm the focus page appears. Also test an already-open tab, edits during focus, Stop, timer expiry, browser restart, a restored tab, app quit, and an unrelated site. The extension should show a disconnected indicator if the host is unavailable.

## Implementation

The app owns `browser-state.json` in its application data directory, writes it atomically with user-only permissions on Unix, and publishes only a version, canonical domains, active state, deadline, and heartbeat timestamp. The separate `unhook-browser-host` executable has no administrator manifest or Tauri runtime. Chromium launches it with native stdin/stdout framing, and the manifest restricts callers to this extension's origin. The host only reads the fixed app state file.

The app registers Chrome and Brave manifests in their user-level native messaging directories on macOS/Linux. On Windows it registers the user-level native host registry keys for Chrome and Brave. Windows/Linux installation needs native platform verification; local implementation verification is on macOS.

Official references: [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [request rules and service-worker limitations](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [tab navigation](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [extension service-worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
