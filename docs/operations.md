# Hosts operations and recovery

Do not exercise blocking against the real system hosts file while developing. Unit and integration tests use temporary files. The browser preview never accesses native hosts.

For native GUI development, debug builds also accept `UNHOOK_TEST_HOSTS` and `UNHOOK_TEST_STATE` pointing to temporary fixture files. Set both before `npm run desktop`. In this mode DNS flushing and privilege elevation are disabled, and the UI displays a fixture warning when hosts change. These environment overrides are compiled out of release builds. The elevated helper always uses the real, fixed system path; never invoke it as part of a fixture test.

## System paths

| Platform | Hosts location                            | DNS cache action                                                     |
| -------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Windows  | `%SystemRoot%\System32\drivers\etc\hosts` | `ipconfig /flushdns`                                                 |
| macOS    | `/etc/hosts`                              | `dscacheutil -flushcache` and `killall -HUP mDNSResponder`           |
| Linux    | `/etc/hosts`                              | available system resolver cache command, with warning if unavailable |

Changes affect explicit domain names, not wildcard subdomains. Add additional hostnames to the blocklist when needed. Unhook also generates a `www` companion and IPv6 mappings.

## Recovery

1. Reopen Unhook. It loads persisted settings/session and reports system entries separately from browser focus. Older settings migrate to browser-only mode without prompting automatically.
2. Choose **Restore system access** in Setup or About. A leftover block from an earlier app version may need one explicit OS administrator prompt. If restoration fails, the app reports an error and retains the actual system state. This recovery preserves the browser focus timer.
3. If the GUI is unavailable, build or use `unhook-cli`, then run its `unblock` command with administrator/root access. Check `--help` for the available options.
4. If markers are malformed, the engine refuses automatic edits. An administrator must inspect the hosts file and remove only the Unhook section after taking a backup. Keep every unrelated line intact.

Do not delete backups as part of ordinary recovery. Do not run random shell snippets copied from a hosts file. The hosts file is data.

## Runtime limits

Browser-only sessions never write hosts. The optional macOS service maintains a lease of at most fifteen seconds, refreshed by Unhook every five seconds and bounded by the focus deadline. Normal stop/quit restores the owned section. Missing refreshes release it, and the daemon restores stale entries when it restarts. Legacy entries from earlier builds require explicit recovery. Sleep suspends work; the next scheduler/service tick reevaluates wall-clock time after resume. Schedules follow local wall-clock time and therefore follow daylight-saving changes.

On macOS 13 or later, PKGs install a conventional authenticated daemon. Private
beta executables use hardened ad-hoc signatures and root-installed code-hash pins;
paid Developer ID is not needed for ordinary transitions once the service connects.
Signed app-only builds retain embedded SMAppService setup; unsigned app-only builds
retain optional password-based blocking. An unavailable installed service never
silently switches to password authorization. Other platforms currently expose
browser-only setup; explicit legacy recovery uses the existing administrator path.
This is not a tamper-proof blocker or a parental-control security boundary.

## Installed app and upgrades

The macOS PKG installs Unhook in `/Applications/Unhook.app`. Open that app as your
normal user to connect the browser companion, check the installed system service,
and optionally enable **Launch Unhook at login**. Login registration and system
service approval are independent. The schedule still requires the app to run;
closing its window keeps it in the menu bar, while quitting stops focus.

Before a PKG upgrade, finish/stop focus and quit Unhook. An active embedded helper
must first be removed through Setup; an installed-daemon upgrade stops and restores
the previous protected helper before replacement. Removal restores and disables
the system layer without ending browser focus, and refuses deletion if restoration
fails. The installer refuses a running app or an unrelated/unsafe installation.
Settings are kept in the user's app data. After upgrading, check actual service
readiness; macOS may require background approval. See [installer instructions](macos-installer.md).

Before removing the app, remove its system service and disable launch at login in
Setup. Only Unhook's marked hosts entries are restored. Never use a global
background-task reset or delete other products' helpers during cleanup.

If installed service assets are incomplete or the endpoint cannot authenticate,
Setup reports unavailable and requires package repair/reinstallation. Use an
administrator-controlled CLI recovery if stale hosts entries cannot be restored
through the GUI; never make hosts or service files user-writable. The installed
helper's root-only `--restore-installed` mode restores only the fixed real system
hosts target and is reserved for installer/administrator recovery. Never invoke
that mode for fixture verification. App crash/lease expiry and daemon restart
normally restore entries without administrator interaction. If the markers are
malformed, inspect them as described above before retrying repair/removal.
