# Claude code-submission repair

Owning TickTick task: `6aa5e9b58f0815166f75d442`, project `6a8c62678f087c81d0c3ec91`.
Base: `772033be804296394d6c52581679008c7eca6ff0` (includes PTY startup repair `d5cab69b`).
Authority: implement a repair and open a PR. No merge, deployment, restart, account mutation, or task completion.

## Cause and repair

The manager reparsed the original authorization URL from retained terminal output after code submission, changing `starting` back to `waiting-user`. The UI therefore reopened the empty code field even without a provider rejection. Preserve the pending state after initial URL discovery; retain terminal output for successful token extraction.

A PTY write callback acknowledges queuing, not native input consumption. Ink handles a multi-character paste as one input event; concatenating the code and carriage return does not produce a distinct Enter event. Send the code first, allow 100 ms for native input/React state to settle, then send Enter separately. Cancellation or process settlement during that interval suppresses Enter. This pacing is an adapter heuristic, not a provider acknowledgement.

Consume stdin stream errors and finish failed writes as failed attempts, with a bounded public error. Do not retry a possibly partial code in the same terminal input field; the existing Retry action starts a fresh login. No new authentication method, credential store, privilege boundary, wire state, or UI copy is introduced.

## Evidence collected during implementation

An isolated Linux runner used Node 24.20.0, Vitest 3.2.4, Ink 6.5.1, React 19.2.0, and @lydell/node-pty 1.2.0-beta.15. The initial five-case regression suite failed four cases on the base, including the real Ink/React/PTY Enter case, and exposed an unhandled Writable error. With the production repair, the existing login-manager suite (15), the five regression cases, and session-environment suite (8) passed: 28 tests total.

The temporary runner expired before its test file could be retained. The checked-in regression file reconstructs those five cases and requires an exact-head rerun; the earlier 28-test result is implementation evidence, not an exact-head CI receipt. It uses actual Ink useInput, React state, and a real PTY; it accepts only exact fixture text on a return-key event, not a substring match. Its credential is synthetic and exercises the real account persistence path.

A broader baseline storage run passed 18 of 19 tests. The chmod-based removal-denial test failed under root, which can bypass those filesystem permissions; repeat as an unprivileged user. Full monorepo dependency installation exceeded the isolated runner's /tmp capacity and was not completed. Minimal dependencies were installed separately; no lockfile change is proposed.

## Required remaining verification

From server/ with the repository's pinned pnpm 10.11.0 and supported toolchain:

```sh
pnpm --filter @happyherd/cli exec vitest run --project unit src/credentialPool/loginManager.test.ts src/credentialPool/loginManager.submission.test.ts src/credentialPool/store.test.ts src/daemon/sessionEnvironment.test.ts
pnpm --filter @happyherd/cli typecheck
```

Also required: applicable package/build/contract checks, product changelog and owned-patch bookkeeping, exact-head independent review, and rendered CredentialsSettingsView desktop/mobile checks. No authenticated production browser journey, physical iPhone Safari test, or successful real Claude OAuth exchange was performed. Native provider rejection that leaves its terminal process open remains an explicit live-verification case; this patch does not infer rejection from a repeated URL.

## Activation decision

The changed runtime owner is daemon-resident CLI credential login management. A later approved activation must install the reviewed CLI and reload that daemon using the maintained procedure. No server/auth schema or UI implementation change is proposed. No activation is authorized or performed here. Status: not signed off pending the named verification gaps.
