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
- Complete authenticated Web desktop/mobile and native Mac journeys on two
  actual machines. The computer-control surface could not attach to Chrome or
  the QA native window (`Browser is not available` / `cgWindowNotFound`).
- Start an ordinary session on the selected target, execute a harmless identity
  command, browse a known file, and prove browser refresh plus native app reopen
  on those real hosts. Resolve the disposable provider session timeout first.
- Complete required PR checks, including the app typecheck issue above and the
  full repository contract suite. No merge, deployment, service update, release
  or issue closure is part of this evidence.
