# macOS beta acceptance record

Status: **Not run.** This template records future acceptance, not historical
verification. Use it with the [beta backlog](plans/2026-10-02-macos-beta.md) and
[installer guide](macos-installer.md). Copy the record for each distinct candidate
and test environment. Do not mark fixture/UI-preview results as live acceptance.

## Candidate and environment

| Field                                                 | Value   |
| ----------------------------------------------------- | ------- |
| Source commit                                         | Pending |
| App / companion versions                              | Pending |
| Final stapled PKG filename / SHA-256                  | Pending |
| Store item ID / install URL                           | Pending |
| Signing team / notarization result                    | Pending |
| Mac model / architecture / macOS version              | Pending |
| Chrome / Brave versions                               | Pending |
| Tester / date                                         | Pending |
| Designated disposable Mac/VM; live test authorized    | Pending |
| Previous version for upgrade / its installation route | Pending |

Record Pass, Fail or Not run per row, with steps and evidence. Screenshots must
avoid personal data. A different administrator and logged-in user should be
included in the installation matrix. Repeat browser cases in Chrome and Brave.

## Installation and connections

| Case                                                | Expected result                                                                               | Result / evidence |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------- |
| Final download, fresh install                       | Normal Gatekeeper/Installer flow; no quarantine bypass or developer tools                     | Not run           |
| Downloaded artifact assessed offline after stapling | Publisher trust remains accepted                                                              | Not run           |
| Standard user, separate installation administrator  | Normal-user app launch and user-local host registration work                                  | Not run           |
| Installed payload/parent metadata                   | Expected protected files/signatures/pins; existing shared-directory ownership/modes unchanged | Not run           |
| Store companion installation, each browser          | No Developer mode; matching origin; connection confirmed only after rules apply               | Not run           |
| Second browser profile                              | Independent installation works; guide makes per-profile setup clear                           | Not run           |
| Missing/disabled/incompatible companion             | Honest status and recovery instructions; no false Ready                                       | Not run           |
| Optional system blocking disabled                   | Browser focus works without application hosts edits                                           | Not run           |
| System service and login setup                      | Separate actual OS statuses; routine transitions work once service is Ready                   | Not run           |

## Focus and schedules

| Case                                          | Expected result                                                                                                                        | Result / evidence |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Start/Stop and deadline expiry                | Browser rules follow app state; optional hosts entries restore at stop/expiry                                                          | Not run           |
| Existing/restored tab and a fresh navigation  | Listed exact domains/www redirect; unrelated sites work                                                                                | Not run           |
| Blocklist edit during focus                   | Accepted changes apply; removed domains are released                                                                                   | Not run           |
| Schedule start/break/end                      | Correct local-time transitions without routine admin prompts                                                                           | Not run           |
| Manual session during schedule/break          | Manual intent takes priority                                                                                                           | Not run           |
| Stop scheduled focus; edit schedule to resume | Current-window suppression and edit clearing match contract                                                                            | Not run           |
| Sleep across break/end; wake                  | State promptly reevaluates; expired blocking does not remain stranded                                                                  | Not run           |
| Clock/DST boundary where feasible             | No indefinite lease; observed schedule follows documented local time                                                                   | Not run           |
| Window close versus normal tray quit          | Window close retains scheduling; quit ends focus/restores                                                                              | Not run           |
| Quiet blocked page                            | Leaf releases and settles once; Close tab works immediately; reduced motion is static; accepted context updates without changing focus | Not run           |

## Recovery, upgrades and removal

On the designated test system, preserve a known unrelated hosts record and capture
the initial hosts bytes/metadata. Compare after recovery/removal; do not overwrite
the whole system file from an old backup. Fault injection is confined to the
disposable environment and follows the operations guide.

| Case                                        | Expected result                                                                                          | Result / evidence |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------- |
| App forced termination during focus         | Browser state and helper lease expire; owned hosts entries release after deadline/recovery tick          | Not run           |
| Helper restart during focus                 | Stale entries recover; subsequent accepted state reconnects safely                                       | Not run           |
| Background approval revoked                 | Unavailable/approval state is accurate; no silent password fallback                                      | Not run           |
| Reboot with login enabled; then disabled    | Actual opt-in status respected; connections/schedule resume appropriately                                | Not run           |
| Real newer-version PKG upgrade              | Stop/quit precondition enforced; settings preserved; app/helper/pins replaced consistently               | Not run           |
| Store-only compatible update                | Desktop remains connected and enforcement applies correctly                                              | Not run           |
| Desktop-only compatible update              | Existing store companion remains usable                                                                  | Not run           |
| Embedded-service migration where applicable | Explicit removal-before-install; no duplicate service managers                                           | Not run           |
| Running app, downgrade and unsafe target    | Installer refuses with understandable corrective action                                                  | Not run           |
| Interrupted replacement/bootstrap failure   | No false Ready; documented reinstall repair restores service safely                                      | Not run           |
| Remove system service                       | Own entries restored before deletion; only fixed service assets removed; browser focus/settings retained | Not run           |
| Disable login, remove app and companion     | No remaining active blocking; unrelated hosts bytes and services preserved                               | Not run           |

## Decision

- [ ] Every advertised behavior has passing evidence for the exact artifact.
- [ ] All safety/recovery failures are fixed and affected rows rerun.
- [ ] Any omitted OS/browser cases are excluded from advertised beta support.
- [ ] A new tester follows installation/removal instructions without assistance.

Decision: **Pending**. Record reviewer, date, unresolved issues and the exact
artifact approved for the cohort. Do not reuse approval after rebuilding it.
