# Issue 288 implementation evidence

Recorded on 2026-09-19 against base `189c504b5ab16eea7fa16e3c2fb33e98d147390d`.
Status: reviewable implementation; **not complete product acceptance**.

## Implemented boundary

See [device pairing](../device-pairing.md) for the user journey and transport
contract. The eight-digit code verifies and selects an **existing authenticated
machine on the same account and server**. It does not perform first-time
authentication, transfer ownership, or discover a browser's physical local
daemon. The existing encrypted account machine RPC remains the authority.

The daemon owns the two-minute, memory-only code. Check does not consume it;
confirmation consumes it synchronously. A stable confirmation request ID permits
lost-acknowledgement recovery without allowing a second request to reuse it.
Regeneration, cancellation, expiry and daemon exit invalidate pending codes.
No account credentials, machine records or session records are rewritten.

This is a HappyHerd-owned change, not an unchanged-upstream exemption. The issue
and its comments contained no recorded security design approval at the time of
inspection. No dedicated approved TickTick task could be verified. Implementation
continued on the operator's subsequent explicit instruction to proceed; this
does **not** establish the recorded approval evidence required by the
[security-feature approval playbook](../../.dev/playbooks/security-feature-approval.md).
That review remains outstanding before this draft can be treated as ready.

## Automated checks

Package commands run from `server/` with pinned pnpm `10.11.0`. Full app and CLI
tests used Node `20.20.2`, matching the CI Node major, and `TMPDIR=/private/tmp` on
macOS. Runtime and export checks also exercised the host's Node `26.6.0`.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; no lockfile change |
| `pnpm --filter @slopus/happy-wire test` | 14 files, 80 tests passed |
| `pnpm --filter @happyherd/cli test` | 181 files, 1794 tests passed |
| `pnpm --filter happy-app test --run` | 280 files, 2830 passed, 1 skipped |
| `pnpm --filter @happyherd/cli typecheck` | Passed |
| `pnpm --filter happy-app typecheck` | Failed: four pre-existing TS2540 errors described below |
| `pnpm --filter @slopus/happy-wire build` | Passed |
| `pnpm --filter happy-agent build` | Passed |
| `pnpm --filter @happyherd/cli build` | Passed |
| `pnpm --filter ./packages/happy-server build` | Passed |
| `pnpm --filter happy-app i18n:check` | Passed: 1572 keys in en/cn/de, zero hardcoded copy exceptions, 41 routes, 279 surfaces, 84 smoke cases |
| `pnpm --filter happy-app exec tsx sources/scripts/parseChangelog.ts` | 142 entries; newest title: September 19 — Device codes for existing account machines |
| `APP_ENV=production EXPO_PUBLIC_HAPPY_SERVER_URL=http://localhost:61060 pnpm --filter happy-app exec expo export --platform web --output-dir dist` | Passed |
| `pnpm --filter happy-app web:smoke dist` | Passed: exported React app mounted without page errors |
| `git diff --check` and `node scripts/lint-source.mjs` | Passed |
| `node scripts/verify-public-boundary.mjs --current-only` | Passed |

Native packaging also passed using Rust `1.98.1` and the final Web export:

```sh
pnpm --filter happy-app exec tauri build --debug --bundles app --no-sign \
  --config '{"build":{"beforeBuildCommand":""},"productName":"Happy Issue 288 QA","identifier":"com.slopus.happy.issue288qa"}'
```

This produced a separate unsigned QA app bundle. It does not prove native GUI
interaction, release signing, installation, or deployment.

The app typecheck errors are assignments to the readonly `process.env.NODE_ENV`
property in `desktopWorkspace.browser.test.ts:665,678` and
`projectsSuperSession.browser.test.ts:430,440`. The generated, ignored
`expo-env.d.ts` references Expo's readonly environment declaration. An in-memory
TypeScript compiler-host comparison using base source `189c504b` and the same
installed/generated type environment produced the same four diagnostics. Those
unrelated tests were not changed. The initial Node 26 CLI run had three failures
from a tsx deprecation warning and macOS temporary-directory canonicalization;
the supported Node 20/canonical temporary-directory run above passed in full.

## Behavior and screenshots

The new checks cover schema validation, leading-zero codes, expiry, cancellation,
replacement, single use, concurrent confirmation, lost ACK retry, local CLI
argument validation, unavailable daemons, encrypted RPC handler registration,
and capability advertisement after reconnect. App checks cover malformed and
grouped input, duplicate matches, identity substitution, network failure,
account/server scope changes, stale async responses, offline/reconnect status,
selection persistence and exact-target New Session/Workspace navigation.

`ConnectionsSettingsView.browser.test.ts` renders the production Settings and
Connections components in a browser at 1440×900 and 390×844. Its RPC, routing,
account and theme dependencies are fixtures. These are **component interaction
screenshots**, not authenticated two-host or native Mac acceptance:

| Step | Desktop | Mobile |
| --- | --- | --- |
| Visible Settings entry | [Screenshot](issue-288/fixture-1440-settings-entry.png) | [Screenshot](issue-288/fixture-390-settings-entry.png) |
| Grouped code input | [Screenshot](issue-288/fixture-1440-code-entry.png) | [Screenshot](issue-288/fixture-390-code-entry.png) |
| Target identity confirmation | [Screenshot](issue-288/fixture-1440-confirmation.png) | [Screenshot](issue-288/fixture-390-confirmation.png) |
| Connected and selected machine | [Screenshot](issue-288/fixture-1440-connected.png) | [Screenshot](issue-288/fixture-390-connected.png) |

## Disposable runtime check

A separate local development environment ran the real server and one daemon
with a throwaway account. The CLI generated/cancelled actual codes; a user-scoped
Socket.IO client used the account's existing encryption key to exercise the real
machine RPC relay. It verified:

- Unknown code, exact target identity, confirmation, same-request receipt replay,
  a rejected second request, code replacement and cancellation.
- A harmless `pwd` through the selected daemon and a known marker file read
  through that same machine's ordinary encrypted RPC handlers.
- Identity verification after reconnecting the controller socket.
- Unchanged credential/settings file hashes, machine IDs and encryption-key
  records, and session IDs before and after pairing.

This was a single-host transport check. It did not exercise an ordinary provider
session. A subsequent supported `session create --local --provider codex`
attempt failed with HTTP 500 and a session-webhook timeout; no successful
provider turn is claimed. The test daemon, server and Web development process
were stopped after verification. Existing operational services were not
restarted or updated. Disposable credentials and raw runtime logs remain outside
version control.

## Outstanding acceptance

- Record the required security-owner review and approved owning task. The
  implementation's two-minute lifetime and retry semantics remain reviewable
  choices, not previously approved design facts.
- Complete the native Mac journey and repeat authenticated acceptance on two
  physical machines. The real Chrome checks below use one physical host and
  responsive emulation, not a second host or a native mobile app.
- Verify native app reopen on the real target hosts. Browser refresh and an
  ordinary provider session now pass in the disposable environment below.
- Complete required checks on the final PR head. The implementation commit
  passed all six required checks; the later evidence-only commit encountered
  the unrelated chat-layout test failure documented below. No merge, deployment,
  service update, release or issue closure is part of this evidence.

## Follow-up: real Chrome interaction

On the operator's follow-up request, native computer control successfully
attached to a real Chrome window. The production Web export was served with
runtime configuration explicitly targeting the disposable local API. A new
throwaway account and separate QA daemon home were used; no production account
or operational daemon was changed.

The rendered application was exercised through Chrome's visible controls:

- Restored the local test account through the normal account-key screen.
- Opened Settings, found Connections, and verified that the existing target
  daemon was online before any device-code confirmation.
- Generated a code using the target CLI, pasted its grouped form, and clicked
  the read-only **Check code** action. The returned hostname and exact machine
  ID matched the CLI receipt in the identity-confirmation screen.
- Opened a separate tab at the Connections route and observed the same account
  machine online, without adding a duplicate record.
- Used Chrome's responsive viewport at **390×844 CSS pixels** to verify the
  actual production page's input layout and recoverable errors for an incomplete
  code and the real daemon's expired code.

These screenshots were downloaded using Chrome DevTools' visible **Capture
screenshot** command; they are real application captures with a local server
and daemon, not the earlier mocked component fixtures. Chrome captured at
device-pixel ratio 2.

| Real Chrome check | Screenshot |
| --- | --- |
| Incomplete eight-digit input | [Mobile input error](issue-288/real-chrome-mobile-invalid.png) |
| Expired daemon code | [Mobile expired-code error](issue-288/real-chrome-mobile-expired.png) |

The initial final **Connect** click was rejected by automatic approval review.
The operator then explicitly authorized that concrete disposable-environment
Connect test and unlocked the Mac. After restoring native Chrome window control,
the test proceeded through the normal UI; no alternative interface bypassed the
rejected action. This permission does not establish the separate recorded
security-owner design approval described above.

With a fresh code, **Check code → Connect** displayed the verified target and
selected its existing machine. A full page reload retained **online · Selected
for new sessions**, and New Session defaulted to that target. Immediately after
Connect, credential/settings hashes, machine IDs and encryption-key records,
and session IDs exactly matched the pre-confirmation snapshot. Creating the
ordinary session below subsequently added its expected session record.

The ordinary Codex session completed through Chrome's New Session UI using a
dedicated test folder. `pwd` returned
`/Users/bot/Projects/happyherd-issue-288/.artifacts/issue-288/chrome-target` and
`hostname` returned `mini.local`, both with exit code zero. The daemon received
the session webhook and the provider emitted `task_complete` with status
`completed`. In the same session's **Workspace**, opening
`issue-288-marker.txt` displayed the expected text:
`Issue 288 real Chrome target file verification`. No file was edited.
The earlier webhook timeout is therefore resolved in this QA environment after
selecting the existing functional global Codex executable in the daemon PATH.

Additional real Chrome captures use 1440×900 and 390×844 CSS-pixel viewports,
again at device-pixel ratio 2:

| Real Chrome check | Screenshot |
| --- | --- |
| Desktop selection retained after reload | [Desktop selection](issue-288/real-chrome-desktop-selected.png) |
| Mobile layout with retained selection | [Mobile selection](issue-288/real-chrome-mobile-selected.png) |
| Ordinary provider session with command output | [Desktop session](issue-288/real-chrome-desktop-session.png) |
| Known file opened in the same target's Workspace | [Desktop Workspace](issue-288/real-chrome-desktop-workspace.png) |

These checks complete the disposable single-host Chrome core journey. They do
not establish two-physical-host or native Mac acceptance. Raw logs, test keys
and before/after snapshots remain in ignored local artifacts.

The session page's Console also showed `Invalid ephemeral update received`.
The browser payload was not retained. Matching QA logs and unchanged source
strongly suggest the existing Codex usage mismatch: the provider sent only
`cost.total`, the server forwarded it unchanged, and the app schema requires
`cost.input` and `cost.output`. This is an inference, not a directly captured
browser payload diagnosis. Pairing uses machine-RPC acknowledgements rather
than ephemeral events. The observed pairing, selection, session and file-read
results above succeeded; this unrelated usage-path issue was not changed.

## CI follow-up

Implementation commit `e23962c2082809776c16f812d714cd374e3fddb2` passed all six
required checks: Clean install, Lint, Typecheck, Unit tests, Production build,
and Contract suite. The evidence-only commit `59be467a` passed every required
check except Unit tests. Its failure was in unchanged
`ChatList.browser.test.ts:129`: before the wheel action, `Prompt 24` remained
at bounding-box `y = -21` while the assertion expected a nonnegative position.
The same test passed in the prior run with identical source blobs, Node version
and runner image. The new pairing browser tests (7/7) and pairing logic tests
(23/23) passed in the failed run. This is evidence of a non-deterministic
unrelated layout failure, not proof of its underlying cause.

A request to rerun only the failed job was rejected by GitHub because the
current account lacks the repository permission required to rerun Actions.
No unrelated source was changed to force a green result. Subsequent evidence
commits must still be judged on their own required check results.

## CI synchronization repair

The operator subsequently requested repair of all PR CI failures. On
`a10043c0`, Unit tests passed; Contract suite failed only in
`CredentialsSettingsView.browser.test.ts` while checking Rename immediately
after removing the machine that owned a deferred login. That assertion now
polls the rendered enabled state before releasing the old RPC. This preserves
the requirement that the new machine becomes usable independently of the old
request. The focused baseline cases passed in 12 local repetitions, so the
exact CI scheduling failure was not reproduced locally.

The previous ChatList failure also had a test synchronization cause: Vitest's
unconfigured polling deadline is one second, independent of the enclosing
20-second test deadline. Sampling the unchanged production fixture in an
independent Chrome process under eightfold CPU throttling observed the focus
message at `y = -73` after 997ms, `y = -5` after 1097ms, and `y = 4` after 1195ms,
without a page error. Normal samples completed in approximately 690ms. This
proves that correct focus scrolling can exceed the old polling deadline; it
does not claim to reproduce the exact prior CI scheduling timeline.

The ChatList visual polls now explicitly allow five seconds. All original
viewport bounds, wheel-direction movement thresholds, and Jump to latest
assertions remain intact. No fixed sleep, whole-test retry, skipped test, CI
gate removal, or production behavior change was introduced.

Local Node 20/pnpm 10.11.0 checks passed after the changes: Credentials browser
suite **55/55**, ChatList browser suite **12/12**, and the full i18n/UI inventory
check. Final remote CI results are recorded in the PR after publication.
