# Unhook implementation contract

Frontend: React + TypeScript + Vite. Desktop: Tauri 2. Shared engine: `unhook-core` at `crates/unhook-core`.

IPC commands (camelCase argument names):
- `get_status() -> AppStatus`
- `save_settings(settings: Settings) -> AppStatus`
- `start_focus(minutes: u32) -> AppStatus`
- `stop_focus() -> AppStatus` (suppresses currently active scheduled window until it ends)
- `restore_hosts() -> AppStatus` (ends manual focus and suppresses current schedule)

JSON types (Rust serde rename_all = camelCase):
```ts
type Schedule = { enabled: boolean; days: number[]; start: string; end: string; breakEnabled: boolean; breakStart: string; breakEnd: string };
// days 0=Monday ... 6=Sunday; times HH:mm local wall-clock, same-day windows only
type Settings = { domains: string[]; schedule: Schedule };
type AppStatus = { settings: Settings; active: boolean; source: 'manual' | 'schedule' | null; endsAt: number | null; remainingSeconds: number; warning: string | null; error: string | null; hostsPath: string };
// endsAt UNIX milliseconds, remainingSeconds derived server-side
```
Emit `status-changed` with AppStatus after changes; frontend also polls every 2 seconds. Browser preview explicitly simulates sessions in localStorage without touching hosts. Native failures never fall back to simulation.

Engine exports normalized domain validation; conservative marked-section hosts editing; backup/write and system path/DNS operations; schedule validation/evaluation. Backend owns session state, settings persistence, permission flow, tray, background scheduler. GUI only uses commands.

Default blocklist: youtube.com, facebook.com, instagram.com, reddit.com, x.com. Schedule defaults disabled, Mon-Fri 09:00–17:00 with 12:30–13:00 break.

Core API agreed with agents through messages. Do not alter system hosts during development verification. Fixture-path CLI exercises are safe. Schedules require the desktop process to be running; ordinary quit restores owned hosts entries, crashes require recovery on restart or CLI.
