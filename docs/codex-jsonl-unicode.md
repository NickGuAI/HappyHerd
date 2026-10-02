# Codex JSONL Unicode framing (#373)

Codex app-server stdout carries one JSON value per LF-delimited record. Literal
U+2028 and U+2029 are legal JSON string content; they must not delimit records.
The previous Node `readline` boundary split them into invalid fragments on the
installed Node 26.6.0 runtime (Node 20.19.0 preserves these characters). A pending `thread/fork` reply was consequently
logged as non-JSON and never resolved. The same boundary serves live events.

The client now decodes stdout as UTF-8 and frames only at LF. It accumulates
chunk fragments without repeatedly rescanning an entire unfinished record.
CRLF remains accepted as JSON trailing whitespace; bare CR is not a boundary.
The existing `handleLine` owns blank/malformed-line handling and JSON-RPC/event
dispatch. EOF delivers a final unterminated record once. Process exit still
retires interactive questions immediately, but unresolved RPC rejection waits
for stdio close so buffered replies can drain. Stream errors log and reject
pending RPCs; intentional disconnect discards unfinished data and detaches the
reader. Generation checks prevent old streams from entering a new connection.
No timeout, notification mapping, fork configuration, or lineage policy changed.

## Deterministic acceptance

`codexAppServerClient.test.ts` drives actual readable stdout streams into the
production client, including a pending `forkThread` operation, live tool events,
UTF-8 byte boundaries, several records per chunk, CRLF, EOF, malformed records,
stream failure, and shutdown. These are provider-shaped fixtures, not claims of
live provider execution. Existing machine fork and side-chat lifecycle suites
cover the downstream path/home and parent-child metadata owners.

## Real provider proof and remaining journey boundary

At source commit `a3c288d1d9a8cfc7ef17f82b3c4009f717809c85`, a controlled,
tracked session launched through the built HappyHerd CLI under Node 26.6.0
using `gpt-6-astra`, `medium`, `yolo`, and the existing unmanaged credential
mode. One real Python tool generated U+2028 and U+2029. Supported session
inspection confirmed one completed turn and an assistant notification with
both literal separators preserved exactly once. Public inspection exposes the
tool start/end but not its output body: this proves a real tool journey and
live separator-containing assistant notification, not authenticated tool-body
rendering. The owned provider was stopped through the supported CLI; read-back
confirmed it was no longer running. Shared daemon identity and start time were
unchanged. Session identities and the secret-free receipt remain local.

The first attempted launch found the build entrypoint temporarily absent while
Vitest's global setup rebuilt it; no session was created by that attempt. The
launch after build completion succeeded. No account was created or modified.


Read-only inspection on October 1, 2026 found Codex 0.154.0 and an existing
shared HappyHerd 1.2.4 daemon. Both supported side-chat creation and app Fork use
the daemon's already-loaded `ApiMachineClient`/`CodexAppServerClient`; children
also launch from that daemon's installation. For side-chat creation and Fork, running a freshly built CLI in the
worktree still calls that same daemon. It does not test the new transport there.

No independently provisioned authenticated test daemon was available. The task
explicitly prohibits deployment and shared-service restart or account mutation.
Therefore actual patched-daemon side-chat/Fork success and authenticated app
rendering remain **unproved**, despite the separate successful source-CLI proof. No existing user session was forked, no private
transcript was copied, and no provider reply was fabricated as real evidence.

After authorized activation in a suitable environment, create a controlled
Codex parent, send a harmless tool instruction that emits literal U+2028 and
U+2029, and verify the output in the session. Create a side chat through the
supported lifecycle and a Fork through the app. Read back distinct child/native
thread identities, original working directory and provider home, correct parent
lineage, and a successful next turn in each child. Retain the actual receipts
separately from these deterministic tests.

## Verification and retained first failures

- Complete transport test file: 55/55 on Node 20.19.0 and Node 26.6.0.
  The eight new cases fail 3/8 on the Node20 baseline and 8/8 on Node26;
  Unicode splitting itself reproduces on Node26.
- Full CLI: 190 files / 2,030 tests, with canonical `TMPDIR=/private/tmp`.
  The first run and an environment-cleaned rerun both failed four unchanged
  Commander-context tests due to macOS `/var` versus `/private/var` paths;
  this also prevented one access mock from matching its intended file. The
  unchanged targeted file passed 19/19 with canonical TMPDIR. No assertion,
  timeout, skip, or fixture was weakened.
- The first CLI typecheck ran before building its control-agent dependency and
  reported missing module declarations; building the dependency and rerunning
  the unchanged typecheck passed.
- The first local contract run passed lineage, patch discipline, public boundary,
  rename, product/community/launcher and component gates, then hit an existing
  GNU-style `sed -i` command under BSD sed. The rerun selects installed GNU sed
  and canonical TMPDIR. That run reached app tests: 3,932 passed, five assertions
  failed, ten existing skips, and three teardown-hook failures. The unchanged
  browser tests exposed visibility, timer, animation and shortcut timing failures;
  their exact host causes are not all established. No full local contract pass is
  claimed. A bounded serialized rerun passed all 48 desktop-workspace cases while
  retaining the local Focus timer failure. The failing app test/source/config
  files are byte-identical to the original frozen main.
- The first source-head hosted Contract run failed two unchanged 30-second
  `beforeAll` hooks (desktopWorkspace and sideChatHeader): 3,753 app tests passed,
  184 were blocked, and ten existing skips remained. The same exact head's Unit
  job passed the complete app suite (3,937 passes, ten existing skips), all
  2,030 CLI tests, 83 wire tests, 260 control-agent tests, and 198 server tests.
  This establishes intermittency without identifying the stalled initialization
  step. Final exact-head contract/check receipts and any retries belong to the PR.
- Separate local remaining-package runs passed wire 83, control-agent 260,
  agent 52 and server 198 tests. Initial concurrent dependent-package builds
  encountered temporarily missing declarations; sequential dependency-order
  runs passed. The server's first run had one existing local-time versus UTC
  expectation failure (197 passes); its unchanged full suite passed with
  `TZ=UTC`, matching hosted CI.
- The source-head production comparison had exactly four changelog differences
  and 24 zero-difference variants. The maintained golden updater consumed run
  `36947687973` for the exact source head. All four desktop/mobile light/dark
  captures were independently visually reviewed before committing. No threshold,
  assertion, or screenshot capture source changed.
- Frozen pnpm 10.11.0 installation, CLI/server builds, app i18n (1,669 keys per
  locale; 45 routes; 338 surfaces; 84 smoke cases), production Web export and
  browser smoke passed. Initial changelog generation reported 175 entries; after rebasing it reports
  176 entries, newest
  “October 1 — Codex conversation reliability”.

## Claude sibling investigation

`claude/utils/claudeSessionFork.ts` also uses `readline` in
`forkAndTruncateSession`. On affected Node runtimes it can split a native JSONL
record before parsing/copying it; whole-session `forkSession` copies bytes and
avoids this framing boundary. This is a separate persisted-transcript rewrite
path with different marker/truncation semantics, not a Codex stdout consumer.
It remains unchanged under #373's explicitly narrow transport scope. The
`claudeLocal` readline channel carries fetch instrumentation rather than the
conversation-copy path. The sibling risk is recorded rather than silently
expanding the patch.

## Main refresh

While this PR was being verified, main advanced from the frozen
`793b05b8394cf1495834a6d2d0e24cb812b7a5c6` to
`2ad0a066559c18de86383cbc2d70201486b1d485` by merging the separately owned Inbox
change. This branch was rebased without a merge-main commit. Both changelog
entries and every incoming ledger row were preserved; the JSON was regenerated.
The Codex production and regression-test files are byte-identical to the original
reviewed source. The four old captures above are historical evidence: main's
current baselines were retained during rebase, and replacement images come
from the new exact-source CI capture described below. The PR owns final-head receipts.

The independent serialized seven-file app rerun before this rebase finished with
174 passes, five failures and nine existing skips. Remaining failures were two
Focus timers, two panel overlays and one shell transition. Desktop Workspace,
Markdown and the three earlier teardown failures passed. No local full app or
contract pass is claimed, and no test assertion or runtime bound was changed.

## Rebased capture and verification

The maintained golden updater consumed comparison run `36949371856`, source
`86547575993f796e429e231de3887fb97a931560`. Only the four changelog images differ;
24 variants remain pixel-identical. Independent visual review confirms the
Codex entry, retained Inbox entry and ordinary content reflow at both widths
and themes. This follow-up changes no product code or test assertions.

Rebased local checks pass: CLI 2,030 tests; Node26 transport 55 tests; server
216 tests; i18n 1,671 keys per locale; frozen installation, typecheck/build,
lineage, public-boundary and patch-discipline checks. The rebased Unit run's
first attempt passed 3,997 app tests with ten existing skips but timed out one
unchanged five-second Commander-context browser case. Main `2ad0a066` passed
both Quality (`36948267958`) and Contract (`36948267944`) with those same
browser sources/configuration. The specific delayed substep is unproved.
The first failure remains in CI; final-head completion is required in the PR.
