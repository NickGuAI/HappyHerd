# #364 source-phase acceptance

Owner: <https://github.com/NickGuAI/HappyHerd/issues/364>.
Base: `632dc24332e49bfd773c5163ab8c045a3b74a5cf`.
Branch: `task/issue-364-astra-20261015`.
Session: `cmva5cvoq157rt01sya3ckx3r`; assigned GPT-6-Astra / medium / yolo.
No additional provider session was created.

## Repair boundary

Antigravity now reaches the existing encrypted machine RPC from the shared
Context window. Without a verified native identity and replay contract it
returns the explicit localized `agy_context_unavailable` receipt and Retry.
No native success, full-content reconstruction, or live provider proof is
claimed. See [the source investigation](skills/happyherd-update-provider/references/antigravity.md#context-window-investigation-364--2026-10-15).

The Human journey is Settings → Features → Experimental → Context window,
then the existing session menu → Context window → explanation → Retry.
Account experiment state remains off by default and survives route reload.
Desktop 1440×900 and Mobile 390×844 are targeted; native platforms are outside
this issue's specified render matrix. Prepared browser tests use the existing
production route/SessionView harness and synthetic unavailable RPC responses.

## Initial evidence, 2026-10-15

- Read the issue and current comments with `gh issue view` once; `gh pr list`
  returned no open task-owned PR. Initial tree was clean at the supplied base.
- Read actual adapter, registration, wire and shared-view source, official
  Antigravity docs and installed IDE package source. No native state content
  was accessed. No provider was started.
- `pnpm --version`: `10.11.0`; host `node --version`: `v26.6.0`.
  Root CI documents Node 20; this host syntax check is not CI proof.
- `pnpm --filter happyherd-app i18n:generate`: passed, 1737 keys in en/cn/de.
- Ran the existing changelog parser via Node's built-in TypeScript stripping
  and CommonJS import adaptation, with no dependency install: 200 entries;
  latest `October 15 — Explain unavailable Antigravity context`.
- Built-in TypeScript syntax stripping passed for all 9 changed `.ts` files;
  this is syntax evidence only, not typechecking.
- `node scripts/lint-source.mjs`: passed. `git diff --check`: passed.

First failures retained: some initial reads and the browser-test insertion
used a redundant `server/` prefix with `server/` as cwd (file-not-found;
corrected before insertion). One source search named a nonexistent
`src/agent/backends` directory; source ownership was located under `src/agy`.
The first parent message send used the root `.task` path while its file was
under `server/.task`; it returned ENOENT, then succeeded with the same message
ID at the correct path. The note was subsequently relocated to ignored
`.artifacts/issue-364`. The first parser attempt used unsupported
`stripTypeScriptTypes` mode `transform`; rerunning in its default strip mode
succeeded. A read of the guessed `generate-i18n.mjs` filename failed; the actual
package script is `validate-i18n.mjs --write`. None was a package/test result.

## Required proof still pending the parent's capacity slot

No dependency installation, package test/build, browser, device or runtime
suite has run. Prepared regressions are unexecuted. Run, in order:

1. Frozen dependencies with pinned pnpm; retain the first failure if any.
2. Wire context schema tests, CLI `readContextWindow` and
   `apiMachine.contextWindow` tests, app `sync/contextWindow` tests.
3. `sideChatHeader.browser.test.ts -t 'Antigravity Context window'`, with
   `HAPPYHERD_CONTEXT_WINDOW_SCREENSHOT_DIR` pointing to task-owned artifacts.
4. App UI inventory/tree regeneration, i18n checks, affected CLI/app package
   checks and web export, then applicable repository contract gates.
5. Review the exact committed head against #364 and these named limitations;
   publication remains separately gated by the parent.

Native compaction/retention/hidden-content/fork/rollback fixtures are **not
available** from the inspected CLI source contract. A synthetic success would
fabricate proof. Authenticated live RPC/render/full-content reads are
**unproved** and no live Antigravity invocation is authorized. No assertion or
budget was weakened to turn these gaps green.

## Provisional lane classification

- Shared protocol / daemon-resident CLI: additive error receipt through the
  existing handler; package and encrypted RPC evidence pending.
- Web/frontend: provider dispatch and en/cn/de notice; rendered desktop/mobile
  proof and export pending. Existing shared view/Retry is reused.
- Provider reference / recipe / changelog: source-derived documentation.
- No central server, provider installation, transcript, or ordinary chat change.

Status: **Not signed off**. Merge, deployment, restart, issue closure and
publication were not performed. Parent owns final coordination and handoff.
