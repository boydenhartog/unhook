# Hosts operations and recovery

Do not exercise blocking against the real system hosts file while developing. Unit and integration tests use temporary files. The browser preview never accesses native hosts.

For native GUI development, debug builds also accept `UNHOOK_TEST_HOSTS` and `UNHOOK_TEST_STATE` pointing to temporary fixture files. Set both before `npm run desktop`. In this mode DNS flushing and privilege elevation are disabled, and the UI displays a fixture warning when hosts change. These environment overrides are compiled out of release builds. The elevated helper always uses the real, fixed system path; never invoke it as part of a fixture test.

## System paths

| Platform | Hosts location | DNS cache action |
| --- | --- | --- |
| Windows | `%SystemRoot%\System32\drivers\etc\hosts` | `ipconfig /flushdns` |
| macOS | `/etc/hosts` | `dscacheutil -flushcache` and `killall -HUP mDNSResponder` |
| Linux | `/etc/hosts` | available system resolver cache command, with warning if unavailable |

Changes affect explicit domain names, not wildcard subdomains. Add additional hostnames to the blocklist when needed. Unhook also generates a `www` companion and IPv6 mappings.

## Recovery

1. Reopen Unhook. It loads its persisted settings/session and reconciles expired or stale blocks.
2. Choose **Restore hosts**. Authorize the OS prompt if requested. If restoration fails, the app reports an error and retains the actual blocked state.
3. If the GUI is unavailable, build or use `unhook-cli`, then run its `unblock` command with administrator/root access. Check `--help` for the available options.
4. If markers are malformed, the engine refuses automatic edits. An administrator must inspect the hosts file and remove only the Unhook section after taking a backup. Keep every unrelated line intact.

Do not delete backups as part of ordinary recovery. Do not run random shell snippets copied from a hosts file. The hosts file is data.

## Runtime limits

Quitting normally restores the owned section before exit. Force-killing, power loss, or a crash may leave it until the next launch or explicit recovery. A timer cannot unblock while the app is stopped. Sleep suspends work; the next scheduler tick reevaluates wall-clock time after resume. Schedules follow local wall-clock time and therefore follow daylight-saving changes.

On macOS and Linux, the helper authorizes each privileged operation through the operating system. Schedule starts, breaks, expiry, and quit may require a prompt. Cancelling a prompt leaves the previous hosts state and reports an error. This is not a tamper-proof blocker or a parental-control security boundary.
