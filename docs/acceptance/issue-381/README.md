# Create account failure and recovery (#381)

The signed-out Human starts at `/`, presses **Create account**, sees a localized
failure with **Cancel** and **Retry**, then retries after recovery and reaches the
authenticated account-key backup screen. Pending presses submit once. Cancel
restores the welcome action; successful authentication survives reload.

| Surface | Evidence | Result and boundary |
| --- | --- | --- |
| Web Desktop, 1440 × 900 | `scripts/smoke-welcome-recovery.mjs` | Production export, pointer gestures, held request, 503, offline, 401, retry, authenticated backup screen and reload |
| Web Mobile, 390 × 844 | Same script, Chromium touch context | Same production journey with taps; browser evidence, not native |
| Desktop/mobile × en/cn/de | `SignedOutLanding.browser.test.ts` | Production Home, RoundButton, modal stack and HTTP client; localized errors, keyboard activation, target sizes, pending state and recovery. Signing, auth storage and authenticated destinations are doubles |
| Shared iOS/Android welcome | `CreateAccount.native.test.ts` | Production Home, RoundButton and ModalManager; native Alert dispatch, same-turn duplicate presses, retry/reset, missing token, entropy/login failure and success. Native hosts and auth services are test doubles |

The production smoke uses a loopback contract backend that verifies real
Ed25519 request proofs and serves synthetic tokens and account data. Production
AuthProvider, storage and authenticated routing run unchanged. It does not prove
the deployed server/database or WebSocket synchronization. No shared account is
created. Authenticated key screens are deliberately not captured.

A device-level native journey remains unproved. Xcode and iOS simulator runtimes
are available, but no exact-head native app artifact was supplied or built. Such
proof requires a simulator/dev-client artifact with the shipped native modules
and an isolated auth endpoint. No shared device was changed. Android tooling is
not available on the evidence host. Desktop native wrappers were not exercised.

## Repeatable checks

From `server/`, using Node 20 and pnpm 10.11.0:

```sh
pnpm --filter happyherd-app exec vitest run sources/components/SignedOutLanding.browser.test.ts sources/components/CreateAccount.native.test.ts 'sources/app/(app)/index.test.ts'
pnpm --filter happyherd-app typecheck
pnpm --filter happyherd-app i18n:check
APP_ENV=production pnpm --filter happyherd-app exec expo export --platform web --output-dir dist-ci
pnpm --filter happyherd-app web:smoke
```

`web:smoke` includes production recovery and runs in the existing production-build
CI job. Optional `HAPPYHERD_EVIDENCE_DIR` saves only signed-out screenshots.
The changelog parser reports **October 2 — Retry account creation**, 176 entries.
Generated locale types and UI inventory are included. CI owns Linux visual-golden
comparison; PR receipts identify the exact source and any baseline refresh.

## First failures retained during development

- The new browser assertion exposed missing Web `aria-busy`; RoundButton now
  supplies the supported ARIA alias while retaining native accessibility state.
- The pre-existing authenticated-route unit fixture needed its newly imported
  modal boundary stub; native tests needed a Metro image-source stub in Node.
- Initial production harness selected an absent `aria-label` instead of the
  button's accessible text. A TCP teardown caused browser transport retries;
  browser offline/online now models disconnection while preserving strict
  pending duplicate counts. Screenshots wait for modal opacity, not merely mount.
- CLI build initially lacked the control-agent build artifact. Building that
  declared dependency before CLI/server builds resolved it without source edits.

Raw diagnostic logs remain local; no private transcripts or runtime credentials
are included. Assertions, timeouts, masks and skips were not relaxed.
