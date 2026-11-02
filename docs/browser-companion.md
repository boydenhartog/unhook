# Unhook browser companion

Unhook remains the only place to manage your blocklist, schedule, and focus sessions. The companion extension has a connection indicator and a focus page, with no independent blocklist or session controls. Browser blocking is the default and needs no administrator password. System blocking is an optional layer configured in Setup.

## Install once

1. Install and open Unhook. Its first-run Setup registers the browser host for your account and exports the bundled extension to a stable folder in Unhook's app data.
2. Choose Brave or Chrome, then **Open browser setup**. The app also provides **Show folder**.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder shown in Setup. This is the local testing installation; store publication is a later step. Each browser profile needs its own installation.
4. Wait for **Browser companion connected**. The app verifies a recent acknowledgement after the extension successfully applies its configuration. Then finish Setup and start focus in Unhook.

If a companion is already loaded from `extension` or `dist/unhook-companion`,
reload it after updating the app/build, or load the stable folder shown in Setup.
Compatibility-aware desktop builds accept supported acknowledgement protocols,
not matching release numbers. Companions 0.2.0 and 0.2.1 use the recognized legacy
protocol; earlier releases lack the required acknowledgement. Stale receipts
cannot report Connected.

For a copy without development tests, use the generated `dist/unhook-companion` folder. The public manifest key fixes the unpacked extension ID to `glcpihjbnhkbbdngjcmdgapodackkkmo`. Store publication must retain this ID or update the native host allowlist in a new app release.

Browser permission to inspect tab URLs and block/redirect requests is required.
The extension does not send URLs, page contents, or history to Unhook or any
server. It reads `getState` and acknowledges `applied` with only the snapshot
timestamp, extension version and negotiated protocol version; it cannot change
settings, start/stop focus, run commands, or supply a file path. No local HTTP
server, pairing token, account, or cloud service is involved.

## Updates and compatibility

Update the desktop first for the initial migration to companion 0.2.2. Earlier
desktops still require the bundled extension's exact release number, even though
their hosts can read the new companion's legacy request format. After that
migration, desktop and companion updates can be independent while they preserve
the supported protocol.

| Desktop/host                | Companion                                         | Result                                                                                                      |
| --------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Before protocol negotiation | Its exact bundled acknowledgement-capable release | Existing behavior                                                                                           |
| Before protocol negotiation | New companion 0.2.2                               | Legacy request format avoids disconnecting the host, but desktop readiness still requires a desktop upgrade |
| Compatibility-aware build   | Legacy 0.2.0 or 0.2.1                             | Accepted after successful application and a fresh acknowledgement                                           |
| Compatibility-aware build   | Any valid release explicitly using protocol 1     | Accepted independently of bundled release number                                                            |
| Compatibility-aware build   | Unknown protocol or unknown legacy release        | Cannot establish readiness                                                                                  |

The host advertises `ackProtocolVersion: 1` alongside version-1 state. New
companions add `protocolVersion: 1` to their acknowledgement only after seeing
that advertisement. Unknown advertised protocols cause the companion to release
its rules and report an error. New hosts reject unsupported acknowledgements
without refreshing the previous receipt. Host origin restrictions, framing bounds,
state validation and receipt freshness checks remain in force. Future companions
must preserve protocol-1 semantics or negotiate a new version; a release-number
bump alone does not change the protocol.

## Behavior

- The app publishes its accepted session state once per scheduler tick and after changes. The extension reads it over a native messaging port once per second.
- Listed domains and their `www` aliases are blocked; other subdomains still require explicit entries, matching the desktop app's existing behavior.
- New document requests redirect to the focus page, and other matching requests are blocked. Existing matching tabs are moved to the focus page, and restored/cached navigations are checked separately.
- The focus page shows **This can wait.**, a leaf that gently unhooks and settles, and one **Close tab** button. The brief animation runs once per page load; it does not loop or replay on status updates. Reduced-motion preferences show the settled state without animation. There is no task prompt, task list, offline-break flow, arrival counter, or mandatory wait.
- **Close tab** is available before focus context loads and throughout the animation. It closes only the distraction tab and never changes focus, rules, schedules, or system blocking. If closing fails, the page gives manual guidance and lets the user retry the same button.
- The current page does not read, write, or delete browser-local task data, intentions, counts, or visit tokens from earlier versions. Existing legacy task message handlers remain supported, but the current page sends only context reads. Reloading or opening this page does not record another task-system arrival.
- Redirects include only the configured domain in the focus-page query, not a full URL or path; that label is checked against accepted app state before display. It is never treated as a return URL.
- The page reads the extension's accepted focus state and deadline. It reports ended focus or a disconnected/stale connection instead of showing an outdated promise of when access returns. Native snapshot and acknowledgement schemas are unchanged; the focus page has no session-control capability.
- When focus ends, rules are removed. Reopen the original site yourself; the extension does not automatically navigate back into a distraction.
- The session deadline and a 15-second app heartbeat lease bound rule lifetime. Normal disconnects clear browser rules. A stopped/crashed app cannot leave the browser rules indefinitely enabled. The optional macOS service separately releases expired system leases.
- Browser restarts reconnect automatically. Incognito access must be enabled separately in the browser if needed. Disabled/uninstalled extensions, browsers without the extension, and deliberate bypasses are outside this focus aid's guarantees.

## Development and checks

`npm run desktop` and native packaging prepare the host/helper executables automatically. Before running Rust workspace checks from a fresh checkout, run `npm run build`, `npm run prepare:browser-host`, and `npm run prepare:system-helper`; Tauri's build checks require the generated sidecar and resources.

`npm run build` also copies the extension's runtime files into `dist/unhook-companion`. `npm test` covers rule boundaries, edits, restored tabs, expiry, stop, and disconnect behavior. `cargo test --workspace` covers app snapshot publication, permissions, native framing, read-only request validation, and the existing desktop/core behavior.

For a clearly labeled simulated preview, run `npm run dev` and open
`http://127.0.0.1:1420/extension/blocked.html`. It does not block websites or use
task storage. Its Close tab button gives manual closing guidance because it
runs outside an extension tab. Extension messaging failures report unavailable
focus status and never switch to simulation; context reads retry on the normal
heartbeat and when the page becomes visible.

Native app fixture mode publishes snapshots beside the fixture settings and does not register real browser hosts. Host protocol tests use temporary files. Do not change the system hosts file for automated development tests.

Manual browser acceptance: visit Marktplaats, close its tab, start focus in Unhook, reopen Marktplaats, and confirm the focus page appears. Also test an already-open tab, edits during focus, Stop, timer expiry, browser restart, a restored tab, app quit, and an unrelated site. The extension should show a disconnected indicator if the host is unavailable.

On the focus page, confirm the leaf releases and settles once, while **Close tab**
works immediately without answering anything. Status refreshes must not restart
the animation or steal keyboard focus. Check the static reduced-motion state,
keyboard navigation, narrow windows, direct tab closing and manual guidance if
closing fails. Confirm focus expiry and connection loss update the status,
including when returning to a previously hidden page. Old intentions must not
appear, and page loads must leave existing task storage untouched. These checks
must use an isolated browser profile and fixture app state when testing
enforcement; they do not require changing real browser permissions or hosts.

## Implementation

The app owns `browser-state.json` in its application data directory, writes it atomically with user-only permissions on Unix, and publishes only a version, canonical domains, active state, deadline, and heartbeat timestamp. The separate `unhook-browser-host` executable has no administrator manifest or Tauri runtime. Chromium launches it with native stdin/stdout framing, and the manifest restricts callers to this extension's origin. The host reads the fixed app state file and writes only an atomic `browser-connection.json` receipt in the same folder. Receipt framing, size, version characters and timestamps are bounded; readiness requires a fresh receipt from the packaged companion version.

The app registers Chrome and Brave manifests in their user-level native messaging directories on macOS/Linux. On Windows it registers the user-level native host registry keys for Chrome and Brave. Windows/Linux installation needs native platform verification; local implementation verification is on macOS.

Official references: [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [request rules and service-worker limitations](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [tab navigation](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [extension service-worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
