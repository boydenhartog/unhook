# Unhook implementation contract

Frontend: React + TypeScript + Vite. Desktop: Tauri 2. Shared engine: `unhook-core` at `crates/unhook-core`.

IPC commands (camelCase argument names):

- `get_status() -> AppStatus`
- `save_settings(settings: Settings) -> AppStatus` (saving a changed schedule clears suppression of the current scheduled window; blocklist-only edits preserve suppression)
- `start_focus(minutes: u32) -> AppStatus`
- `stop_focus() -> AppStatus` (suppresses currently active scheduled window until it ends)
- `restore_hosts() -> AppStatus` (removes owned system entries and disables system mode; preserves browser focus)
- `get_setup_status() -> SetupStatus`
- `open_browser_setup(browser: 'brave' | 'chrome') -> SetupStatus`
- `reveal_extension() -> void`
- `complete_setup() -> SetupStatus`
- `install_system_blocker() -> SetupStatus`
- `uninstall_system_blocker() -> SetupStatus` (restore/disable the system layer before unregistering; preserve browser focus; failed restore prevents removal)
- `set_launch_at_login(enabled: boolean) -> SetupStatus` (macOS-owned status, explicit opt-in, installed app only)
- `open_system_settings() -> void`
- `set_system_blocking(enabled: boolean) -> AppStatus` (requires approved helper or available password fallback when enabling)

JSON types (Rust serde rename_all = camelCase):

```ts
type Schedule = {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
  breakEnabled: boolean;
  breakStart: string;
  breakEnd: string;
};
// days 0=Monday ... 6=Sunday; times HH:mm local wall-clock, same-day windows only
type Settings = { domains: string[]; schedule: Schedule };
type AppStatus = {
  settings: Settings;
  active: boolean;
  systemActive: boolean;
  source: 'manual' | 'schedule' | null;
  endsAt: number | null;
  remainingSeconds: number;
  warning: string | null;
  error: string | null;
  hostsPath: string;
};
type SetupStatus = {
  completed: boolean;
  browserConnected: boolean;
  extensionPath: string | null;
  extensionVersion: string | null;
  browserLastSeen: number | null;
  systemBlockingEnabled: boolean;
  system: {
    state:
      | 'unsupported'
      | 'unavailable'
      | 'notInstalled'
      | 'requiresApproval'
      | 'ready'
      | 'passwordRequired';
    message: string | null;
    registered: boolean;
    management: 'installer' | 'embedded' | 'password' | 'unsupported';
  };
  login: {
    state: 'enabled' | 'disabled' | 'requiresApproval' | 'unsupported' | 'unavailable';
    message: string | null;
  };
};
// endsAt UNIX milliseconds, remainingSeconds derived server-side
```

Emit `status-changed` with AppStatus after changes; frontend also polls every 2 seconds. Browser preview explicitly simulates sessions in localStorage without touching hosts. Native failures never fall back to simulation.

Schedule controls immediately call `save_settings` for each valid edit. There is no manual Save action. Invalid drafts do not change accepted state and remain editable across polling; persistence failures show an error and offer Retry. Editing pauses while a save is in flight to prevent overlapping writes; time inputs retain keyboard focus. Saving/error feedback appears above the schedule controls.

Engine exports normalized domain validation; conservative marked-section hosts editing; backup/write and system path/DNS operations; schedule validation/evaluation. Backend owns session state, settings persistence, permission flow, tray, background scheduler. GUI only uses commands.

Default blocklist: youtube.com, facebook.com, instagram.com, reddit.com, x.com. Schedule defaults disabled, Mon-Fri 09:00–17:00 with 12:30–13:00 break.

Core API agreed with agents through messages. Do not alter system hosts during development verification. Fixture-path CLI exercises are safe. Schedules require the desktop process to be running. Session intent is independent from system state. Persisted `systemBlockingEnabled` and `setupCompleted` default false on migration and live outside Settings. Browser-only operations never automatically mutate hosts; legacy leftovers require explicit recovery. Both persistent macOS helper routes expire a bounded lease when the app stops refreshing it.

The companion's top-level blocked page is a quiet, read-only interruption. It
shows a one-shot settling leaf animation (static with reduced motion),
**This can wait.**, accepted focus context, and an immediately available
**Close tab** action. It has no task editor, task list, offline-break flow,
arrival counter, required wait, or desktop session-control capability. It sends
only `blockedContext` reads, does not access task storage, and never re-renders
the scene during status refreshes. Previously saved task data is left untouched.

Legacy browser-local task message handlers remain supported, but are not called
by the current page. Their camelCase payloads are:

- `reflectionVisit { visitId }`: record a daily arrival, deduplicated by UUID.
- `reflectionRead {}`: refresh the local-date view without recording an arrival.
- `reflectionAdd { text }`: add and select a task for today.
- `reflectionEdit { taskId, text }`: edit a task for today.
- `reflectionSelect { taskId }`: select an unfinished task for today.
- `reflectionComplete { taskId }`: complete a task and clear its current selection.
- `reflectionUndo { taskId }`: undo today's completion without replacing the current task.
- `reflectionCarry { taskId }`: explicitly move an unfinished task from another local date into today and select it.

Successful task responses are `{ ok: true, reflection: { day, tasks,
currentTaskId, attempts } }`. Each task is `{ id, text, day, completed }`;
`day` is the browser's local calendar date in `YYYY-MM-DD`, IDs are opaque UUIDs,
and `currentTaskId` is a UUID or null. Errors return `{ ok: false, error }`.
The worker serializes operations on one `chrome.storage.local` record, limits
text to 500 characters and the list to 100 tasks, and keeps up to 128 opaque
visit IDs for reload/retry deduplication. A new local date resets the daily
count and selection, removes older completed tasks, and leaves earlier
unfinished tasks available for explicit carry-over. Legacy undated intentions
are migrated as optional carry-over candidates; their internal earlier-day
marker does not represent a known creation date. Tasks from another date also
remain available after a clock/timezone change moves the local date backward.
Legacy read operations do not count as arrivals. The current localhost preview
is explicitly labeled and does not use the legacy task model or storage.
Extension errors never silently fall back to simulation.

`blockedContext {}` returns `{ ok: true, context: { active, connected, endsAt,
site } }` from the extension's accepted browser state. The deadline is UNIX
milliseconds or null; the site is a configured domain or null. Redirects carry
only that domain in the blocked-page `site` query. The worker validates it against
the current effective blocklist and checks the deadline/15-second lease on every
context read; inactive or stale context never promises an active block deadline.
Task and context messages accept only this extension's exact top-level blocked
document, with an optional query/hash. No task text or website URL goes through
native messaging, and the native schemas below remain unchanged.

**Close tab** closes the current tab directly, with manual guidance if the tab
API fails. It works independently of context loading and animation, and never
changes desktop session intent, schedules or rules. Context updates continue
on the heartbeat and when the page becomes visible; failures report unavailable
status without preventing closing.

Launch-at-login status comes from SMAppService, not persisted settings. Registration,
unregistration and approval remain OS-owned. Fixture mode cannot register services,
change login items or open System Settings. PKG installation does not imply helper
connectivity or browser connectivity; each status is checked separately on normal
user launch. Installed service assets select `management: 'installer'`; protected
assets plus a successful authenticated ping are needed for `ready`. Incomplete,
insecure or unresponsive installed assets report `unavailable` and never silently
switch to embedded registration or password authorization. `registered` remains
true for installed assets needing repair. Installer-managed removal restores and
disables blocking under the controller lock before an authenticated fixed-path
uninstall request. The PKG must be run again to reinstall that service.

Browser companion: the bundled `unhook-browser-host` accepts native
`{"type":"getState"}` and
`{"type":"applied","updatedAt":number,"extensionVersion":string,"protocolVersion":1}`
from `chrome-extension://glcpihjbnhkbbdngjcmdgapodackkkmo/`. Reads return `null`
or `{ version: 1, domains: string[], active: boolean, endsAt: number | null,
updatedAt: number, ackProtocolVersion: 1 }`. The host adds `ackProtocolVersion`
to the response; the app's atomic snapshot stays unchanged.

Companions send `protocolVersion` only after the host advertises support. Hosts
without that advertisement receive the original acknowledgement schema without
the new field; old hosts reject unknown request fields. New hosts and desktops
recognize missing protocol information only for legacy companion releases 0.2.0
and 0.2.1. An explicit supported protocol permits different release numbers;
unknown protocols and malformed release strings cannot establish readiness.
Protocol 1 means successful application of the version-1 snapshot, including
exact-domain/www rules, session deadlines and the 15-second heartbeat lease.
Changes to those semantics require a new protocol and a coordinated migration.

Acknowledgements return `{type:'ack',ok:boolean}` and update only the fixed
connection receipt. Accepted receipts contain `lastSeen`, `updatedAt`,
`extensionVersion` and `protocolVersion: 1`; known legacy acknowledgements are
normalized to protocol 1. Both timestamps must be fresh and not in the future.
Rejected acknowledgements never refresh the previous receipt, which can remain
valid only for its existing 15-second freshness window. `SetupStatus.extensionVersion`
reports the actual connected companion version, or the bundled version while
disconnected. There are no browser-to-app control mutations. App publication
refreshes the snapshot on each scheduler tick. Rules expire at `endsAt` and
release after 15 seconds without a current snapshot.

Upgrade the desktop to this compatibility-aware build before distributing
companion 0.2.2. Earlier desktops still enforce release-number equality and cannot
gain compatibility from an extension update alone. See
[browser companion](browser-companion.md) for the update matrix and setup.
