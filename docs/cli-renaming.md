# CLI rename and migration SOP

Owner: [#297](https://github.com/NickGuAI/HappyHerd/issues/297). Non-CLI naming
belongs to [#307](https://github.com/NickGuAI/HappyHerd/issues/307).

## Scope and inputs

The native implementation is `server/packages/happyherd-cli`, published as
`@happyherd/cli`. Its primary entry is `bin/happyherd.mjs`; helpers are
`happyherd-mcp`, `happyherd-agent-mcp`, and `happyherd-agent-codex-policy`.
There is no installed legacy primary command or wrapper package. Use
`happyherd --help` for current options, including `--happyherd-starting-mode`.

`scripts/rename-cli.mjs` takes `--from` and `--to` in display case (for example,
`Happy` and `HappyHerd`), optional `--root`, and optional `--manifest`.
`scripts/cli-rename-scope.json` defines owned documentation and preserved
external/compatibility tokens. Names are ASCII alphanumeric, beginning with a
letter. Lowercase, display-case, uppercase and lower-camel variants are handled
in one pass; an existing target is never expanded again.

The script reads **Git-tracked files only**, renames CLI-owned paths/text and
updates CLI directory references in shared files. Symlinks and submodules are
skipped. Binary archives, licenses under `tools/`, and provider transcript
fixtures move byte-for-byte. Runtime homes and dependency/build output are not
traversed. URLs and imported external symbols remain literal. Review the
compatibility module's current prefix/home manually on a subsequent rename;
retain its historical input spellings. A source rename cannot provision DNS,
npm scopes, signing identities or external package releases.

## Execution

Use a clean isolated topical worktree and retain its starting SHA. Track new
source files before running the tool. Never target a dirty operator checkout
or runtime home.

```bash
node scripts/rename-cli.mjs --from Happy --to HappyHerd
node scripts/rename-cli.mjs --from Happy --to HappyHerd --apply
git add -A
node scripts/rename-cli.mjs --from Happy --to HappyHerd --check
git diff --cached --find-renames
```

Without `--apply`, only the plan is printed; `--check` exits nonzero if work
remains. Destination collisions fail before writes. `--patch` emits a patch
instead. Review historical examples, cleanup predicates, attribution, settings
and serialized protocol keys after every run; do not reinterpret old bytes as
new branding. Do not add blanket scan exclusions to hide new active names.

## Runtime migration contract

| Surface | Contract |
|---|---|
| Environment | Use `HAPPYHERD_*`. Legacy `HAPPY_*` inputs are accepted when the canonical variable is absent. Values are never rewritten. |
| Home | Explicit canonical override, then legacy override, then existing `~/.happyherd`, then existing `~/.happy`, otherwise new `~/.happyherd`. Expand leading `~` only. If both homes exist, select the intended original home explicitly; do not merge them. |
| State | Reuse the selected home in place. Preserve settings, machine ID, keys, session IDs, encrypted history, reconnect records, Commander files, credential pools, provider home paths, daemon state and locks. No age expiry, credential import or copying. |
| Settings | Read `daemonAutoStartWhenRunningHappy` into `daemonAutoStartWhenRunningHappyHerd` only if the new key is absent. Preserve unknown and historical fields. |
| Children | Strip both old/new session-scoped keys from ambient daemon/tmux state. Normalize explicit legacy launch inputs before spawning. |
| Historical prompts | Read `<happy-system>` and current markers without rewriting Human text or stored transcripts. |
| Upgrade/uninstall | Install only new commands. Retain exact legacy-owned launcher matching for cleanup, never command aliases. Preserve unrelated user commands. |

For a deliberate runtime upgrade, stop the owning daemon with the installed
version, install the reviewed CLI, and start it as the same account with the
same explicit home/server selection. Existing provider processes keep their
loaded implementation until restarted. Update operator scripts to use current
CLI flags. Source renaming itself does not restart processes.

## Shared contract with #307

Retain these wire/stored-data spellings until both readers and writers migrate:
`happyCliVersion`, `happyHomeDir`, `happyLibDir`, `happyToolsDir`,
`happySessionId`, `requiresHappyAgentAuth`, `happyAgentAuthenticated`, and
`spawn-happy-session`. They support existing apps, daemons and encrypted
records; they are schema boundaries rather than installed CLI branding.
`Happy EnCoder` is a cryptographic derivation domain and must remain byte-exact.
The historical shutdown-source enum `happy-cli` also remains a wire value.
Pairing QR/manual URLs retain `happy://terminal?` in `legacyCompatibility.ts`:
the shipped app's `sources/hooks/useConnectTerminal.ts` only accepts that
scheme. #307 must add dual-scheme readers before switching the CLI's emitted
scheme; renaming just the installer test parser would hide broken app pairing.
The CLI now emits `mcp__happyherd__change_title`; #307 must teach the app's
`sources/sync/reducer/messageToEvent.ts` to recognize both old and new title
tool names so historical turns retain their specialized presentation.

The CLI consumes #307-owned `happy-agent` (`HappyControlClient` imported under
a renamed local alias), `@slopus/happy-wire`, `happy-app`, `happy-server` and
`happy-server-self-host`. Its server launcher still emits `HAPPY_STATIC_DIR`
and `HAPPY_INJECT_HTML_CONFIG` for that server. The separately published
`@slopus/happy-terminal` is external. Existing API/webapp hostnames are working
addresses, not names for this source script to invent.

**#307 should follow/rebase on this PR.** Update CLI dependency imports, server
package resolution and server env writes when their owners are renamed. Keep
historical reader compatibility for persisted metadata and encryption domains;
migrate both sides before retiring wire spellings. Do not recreate
`packages/happy-cli` or turn `packages/happyherd-cli` into a wrapper. Extend the
scope manifest or reuse `renameText`, rather than blind global replacement.

Shared files: `server/package.json`, `server/pnpm-workspace.yaml`,
`server/pnpm-lock.yaml`, app CLI-version imports, Dockerfiles, CLI
build/install/release scripts, CLI references in `.dev`/docs, the required app
changelog/JSON and `docs/owned-patches.tsv`. Preserve the new CLI path while
applying #307 package changes. Historical ledger subjects are immutable;
evidence paths follow source moves. Use `git diff --name-only BASE...HEAD` for
the precise inventory of this PR.

## Verification and recovery

```bash
node --test scripts/rename-cli.test.mjs
node scripts/verify-cli-public-command.mjs
node scripts/verify-product-identity.mjs
node scripts/test-cli-rename-runtime.mjs
scripts/test-public-launcher-release-contract.sh
# From server/, Node 20 and pnpm 10.11.0:
pnpm install --frozen-lockfile
pnpm --filter happy-agent build
pnpm --filter @happyherd/cli build
pnpm --filter @happyherd/cli test
pnpm --filter @happyherd/cli test:session-continuity
pnpm --filter happy-app exec tsx sources/scripts/parseChangelog.ts
```

The script regression archives the pre-rename repository (`CLI_RENAME_BASE`,
default `c1dd1b1e`), runs `Happy → HappyHerd → Meadow` in a disposable repo,
and checks command/package/path changes, existing targets, idempotence,
collisions, binary bytes and provenance. Fetch the baseline first in a shallow
checkout. Repeat against new upstream surfaces. Real authenticated provider
turns and installed release matrix results are separate from unit/build proof.

Recover source by discarding only the disposable worktree or reverting the
owned commit in a topical PR. Never apply an inverse blanket replacement: it
would damage provenance and pre-existing target names. For runtime rollback,
reinstall the prior release against the same explicit original home. Keep
backups outside Git with original permissions; never regenerate keys or delete
sessions as part of naming recovery.
