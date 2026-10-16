# Foreground daemon readiness diagnostic acceptance

This separately authorized installer/foreground-start diagnostic supports investigation of PR #435's first native failure; it is not the Claude child converter repair and does not establish or fix the native failure's cause.

## Actual tested source

The tested working tree was the eight-file reviewed revision 2 patch applied atop e099e8c190663c253779391eb0d3a438d4a7a9db (tree d045b3199e6f893af405edf9cf911167c6bda2d0), not the committed e099 source alone.

- Actual patch SHA-256: 5f12aa9fd0b6ea2b51529799f90c0d97e4aa95a050c5783e9f9cb90e4a8681b0.
- Actual packet catalog SHA-256: 483412f570a373e01aaaa1a6a4ce4b3cac72c74ddfec94e392fadd61fdc8cfbb.
- Later packet 471d1483 was not applied or executed. Its production bytes match; it removes two redundant parser negative examples. The actual tested bytes are retained.
- Exact source and original log hashes are retained in [the proof catalog](installer-readiness-proof.json). Original private first logs/receipts remain immutable.

## First local proof

Node 20.20.2 and pnpm 10.11.0 used only this worktree's existing frozen dependencies. In order, each first execution exited 0:

1. Node test runner: native-installer-readiness-summary.test.mjs and existing native-installer-startup-diagnostic.test.mjs: 10 tests passed.
2. Explicit CLI build.
3. CLI unit Vitest, one worker and no file parallelism, with existing globalSetup build intact: controlClient.readiness.test.ts (21), startupReadiness.test.ts (4), existing controlClient.test.ts (5): 3 files, 30 tests passed.
4. CLI typecheck.

All PID/HTTP readiness probes in focused tests were mocked. These are synthetic helper/observer proofs, not an installed binary, daemon startup, installer, provider, or device run. There was no retry, baseline restoration, mutant, dependency install or prerequisite rebuild. Source before/after and original lock/config/classifier parity passed. All known newly owned process groups were absent at release; no signals were issued. Final free space was 21414756352 bytes.

The observer preserves all existing readiness returns, probes, cleanup, loop counts, delays and process exits, including accepted no-port and HTTP non-OK branches. Sink exceptions are isolated. Foreground failure alone emits a bounded allowlisted summary (at most 50 attempts); the installer parses only that record from its existing captured buffer. Existing classifier categories/counts and original failure precedence remain unchanged. No raw state, PID, URL, port, version, error, token or argv is emitted by the summary.

## Changelog and remaining gaps

After the unchanged CLI proof, the official changelog parser ran once and exited 0: 201 entries, latest title “October 15 — Daemon startup diagnostics”. The separate entry leaves the Claude child entry intact. No CLI proof repeat was needed for documentation/generated metadata changes.

First Native run 38823655830, darwin-x64 job 116725925501, remains failed at the initial foreground daemon start after pairing. Readiness-loop exhaustion is established; the missing state observation and later log counts do not establish timing or a product cause. First Quality run 38823655931's golden comparison failure remains historical. The new changelog makes its captures historical, not proof for this new revision; no baselines were imported.

No CI, installed binary, real daemon or live provider proof exists for this diagnostic revision. Full #414 signoff remains pending reported-session/live-child evidence and final acceptance. Local light-gate receipts and the eventual exact commit identity are reported separately after the commit; no publication or activation is authorized here.
