# Issue 321 transport recovery acceptance

The executable live acceptance owner is `scripts/issue-321-live-acceptance.mjs`.
It creates a private disposable PGlite server/database, account, CLI home,
Commander, workspace, copied Codex authentication, and daemon. Its two loopback
proxies provide a stale endpoint while the owning daemon reaches the same
server/database through the current endpoint. It never restarts the shared
daemon or mutates an existing HappyHerd account/session.

The runner snapshots the built CLI into its private directory before launch so
concurrent test builds cannot replace running acceptance code. Source HEAD,
tracked diff hash, CLI entry hash and runner hash belong in the receipt. Account
keys remain in memory or ordinary private runtime storage. Provider credentials,
raw transcripts, server data, and raw logs must never enter this directory.

Run from the repository root after building the CLI and exporting the production
Web app:

```sh
node scripts/issue-321-live-acceptance.mjs /absolute/path/to/web-export --baseline
node scripts/issue-321-live-acceptance.mjs /absolute/path/to/web-export
```

Each run writes sanitized receipts/screenshots under a distinct ignored
`.artifacts/issue-321/` directory. Both real Chrome contexts authenticate using
the normal Restore Account form; desktop is 1440×900 and mobile is 390×844.
They issue repeated recovery gestures for the same session. Receipt success
requires a real Codex response, unchanged conversation/thread/Commander/path,
and one tracked owner plus one queued-message execution.

## Preliminary evidence

The [baseline reproduction](baseline-reproduction.json) passed on October 2,
2026. A real Codex response completed first. The same HappyHerd conversation and
provider thread then remained alive under wrapper PID 27262 while its old
endpoint returned HTTP 503 and the isolated daemon reached the same database
through the current endpoint. The server still reported `active: true`, which
reproduces the stale-endpoint/live-process discrepancy. The receipt records its
precise preliminary source/diff and built-entry hashes. This is reproduction
evidence, not final recovery signoff.

## Preserved first failures

- [Initial attempt](first-failure.json): a session-inspection child exited during
  the first-reply observation. It used the mutable source build. No recovery
  pass was claimed; subsequent attempts snapshot the executable first.
- A snapshot attempt encountered `ENOENT` while a concurrent build removed
  `dist`, before starting a server/daemon. Subsequent launches use a completed
  build snapshot; this did not change a product assertion or timeout.
- [Private snapshot dependency failure](snapshot-dependency-failure.json):
  the copied CLI could not resolve the workspace-hoisted `axios` dependency,
  causing the original pairing wait to expire. The private snapshot now has
  both package-local and workspace-parent dependency links, plus early process
  exit detection. The pairing timeout was not increased.
- [Wire observer failure](wire-observer-failure.json): the provider completed
  its reply, but the runner expected the unrelated string `assistant`.
  Inspection showed the maintained format is `role: session`, nested
  `role: agent`, and `ev: {t: text, text: ...}`. The assertion now matches that
  exact event shape and exact reply text, excluding the user prompt. The
  original 240-second failure is retained; no timeout, mask or skip changed.

- [Original browser selector failure](selector-failure.json): the runner sought
  the exact short text `Reconnect`; the actual accessible button is
  `Reconnect to current server`. The selector now uses that exact accessible
  button label. The original 45-second failure is retained and unchanged.

## Preliminary full recovery pass

The [full recovery receipt](preliminary-live-recovery.json) passed on October 2,
2026 with the final cause copy and actual production Web export. Each independent
Chrome context logged in through the normal Restore Account form. Desktop
1440×900 and Mobile 390×844 each pressed the visible recovery button, exercising
repeated gestures against the same disconnected process. Neither API responses
nor application state were mocked. A normal authenticated machine metadata
update gave the disposable machine a neutral display name.

- [Desktop disconnected](desktop-disconnected.png) and
  [Mobile disconnected](mobile-disconnected.png) show the known stale-address
  cause and explicit automatic replay/do-not-resubmit instruction.
- [Desktop recovered](desktop-recovered.png) and
  [Mobile recovered](mobile-recovered.png) show the exact real Codex reply
  `RECOVERED_321_OK`. Before capturing these, the runner required the recovery
  button to detach and that exact agent response to become visible.
- The queued input had a persisted sequence number and no execution before the
  gestures. After reconnect, exactly one canonical agent text event matched the
  response marker. The final supported status was `connected`.
- HappyHerd session ID, Codex thread ID, Commander, workspace, wrapper PID and
  the single native Codex PID were unchanged. Both saved private authentication
  files were byte-identical across recovery; no authentication bytes appear in
  evidence. All task-owned tracked sessions and the isolated daemon were stopped
  afterward.

These checked-in artifacts are preliminary source/diff-fingerprinted proof.
Final exact-head acceptance must run after the implementation commit and attach
its sanitized receipt to the issue/PR, leaving the reviewed source unchanged.
The final runner also records full CLI-distribution and Web-export tree hashes.


## Regression and verification receipts

The CLI package passed 2,051 tests on the pinned Node 20 runtime. Independent
review found an HTTP pagination race after socket deduplication; its regression
first failed (one HTTP request instead of two), then passed after advancing the
HTTP page cursor before skipping already-delivered records.

The first full app run exposed a native-import regression introduced by transport
polling. Moving registration to the existing socket owner kept the status store
independent and repaired the affected unit/browser consumers. A subsequent full
run passed 4,014 tests with one unchanged animation timing assertion failing
(166 ms against a 150 ms tolerance) under the installed Chrome. That exact
assertion passed with the pinned Playwright browser; its tolerance was not changed.

Node 26 produced a CLI version deprecation warning and macOS temporary-directory
symlinks broke canonical-path fixture expectations. Verification now uses the
repository's pinned Node 20 and a canonical temporary directory. The original
Linux-only keyboard fixture now tests both Linux and macOS exact shortcuts.
Two paused-clock focus countdown assertions also failed on untouched base
`2ad0a066`; flushing queued effects with zero clock advancement restored their
original exact expected values. No assertions, timeouts, screenshot masks, or
skips were relaxed.

The final row/header integration additionally exercises the actual desktop and
compact list rows, their status avatar, and the outer conversation header across
transport transitions. The committed exact head's complete contract suite, CI,
independent review and final isolated live receipt are attached to the PR handoff.
