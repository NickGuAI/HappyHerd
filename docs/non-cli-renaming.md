# Non-CLI product naming and upstream synchronization

Issue #307 owns application, Web, native/mobile/desktop, control agent, server,
shared packages, assets, localization, and their build/test/deployment consumers.
Issue #297 / PR #316 owns the native CLI implementation and its rename SOP.
This change depends on PR #316; review the #307 commits separately from that base.

## Canonical source identities

| Previous source | Current source / package |
| --- | --- |
| `happy-app` | `happyherd-app` |
| `happy-app-logs` | `happyherd-app-logs` |
| `happy-agent` | `happyherd-control-agent` |
| `happy-server` | `happyherd-server` |
| `happy-server-self-host` | `happyherd-server-self-host` |
| `happy-wire`, `@slopus/happy-wire` | `happyherd-wire`, `@happyherd/wire` |

The control package has a distinct name because `happyherd-agent` already owns
the governed bridge. Its exported client is `HappyHerdControlClient`.
`happyherd-cli` and `@happyherd/cli` retain their independent #297 identity,
entrypoints, and version. App Expo/Tauri version references still read that CLI
package. Self-host Web bundling still calls its `scripts/bundle-webapp.cjs`.

Because the CLI is separately owned, non-CLI renames preserve the `@happyherd/cli`
package, the `happyherd-cli` package directory, its commands and helpers, and the
`happyherd` MCP namespace. Shared CLI environment variables also retain their names:
`HAPPYHERD_SERVER_URL`, `HAPPYHERD_WEBAPP_URL`, `HAPPYHERD_HOME_DIR`,
`HAPPYHERD_PROJECT_DIR`, and `HAPPYHERD_VARIANT`.

The automation `runtimeOwner` value `happyherd`, attachment encryption domains,
and serialized peer identities remain byte-exact. These scoped exceptions preserve
existing workflows and data while internal source symbols can follow the product
name. Renaming source does not rewrite user data.

## Run the parameterized source transformation

Use an isolated, clean worktree. The script enumerates Git-tracked regular files;
it preserves tracked symlink targets and never traverses dependencies, build
products, runtime homes or user databases.
Review/stage newly imported source first so Git can enumerate it.

```sh
node scripts/rename-product.mjs --from Happy --to HappyHerd
node scripts/rename-product.mjs --from Happy --to HappyHerd --apply
git add -A
node scripts/rename-product.mjs --from Happy --to HappyHerd --check
node --test scripts/rename-product.test.mjs
```

`--root PATH` selects another checkout. `--manifest PATH` selects a JSON scope
relative to that root (default `scripts/product-rename-scope.json`). Names are
alphabetic-leading alphanumeric identifiers; use display casing, e.g. `HappyHerd`
and `Meadow`, so lowercase, uppercase and camel-case variants remain consistent.
Existing target substrings are protected in a single nonrecursive pass.
Collisions are detected before writing. Apply records path moves with `git mv`
so tracked ignored files and symlinks remain tracked; content edits remain
unstaged. It does not commit or publish.

The regression runs `Happy → HappyHerd → Meadow` on a disposable full repository,
checks idempotence after both operations, retains the CLI package identity while
updating its provider imports, and compares historical/auth/crypto/binary bytes.
The temporary name is source-transformation proof, not a released deployment:
review the semantic compatibility manifest before adopting another runtime name.

## Compatibility and persisted identity

Naming is not a data migration. Never regenerate keys, rewrite message content,
replace session/machine IDs, change provider homes, or copy users into new stores.

- `Happy EnCoder`, `Happy Coder`, `Happy Blobs`, `happy-server-tokens`, and
  `github-happy` are cryptographic domains/service namespaces, not display copy.
  Retain their exact bytes. Existing server master secrets remain unchanged.
- Android application IDs, iOS/Tauri bundle IDs, Firebase configuration, SecureStore
  keys, MMKV IDs and SQLite paths retain identity. Codium continues reading its
  historical `Happy`/`happy` directory and `happy-auth.json`. Control-agent and
  app-log defaults continue using `.happy`; the native CLI owns its separate home
  selection rules. Deployed bridge/daemon home paths also remain in place.
- Canonical `HAPPYHERD_*` configuration wins over historical `HAPPY_*` input at
  the affected readers. Browser builds accept both public server-URL variables;
  self-host clients accept historical injected HTML config. Retain existing
  deployment environment files and mounted data volumes during an upgrade.
- Serialized metadata fields (`happyCliVersion`, `happyHomeDir`, resume auth
  flags), historical shutdown enums, `spawn-happy-session`/`resume-happy-session`,
  and `X-Happy-Client` remain mixed-version wire contracts. They are deliberately
  scoped exceptions, shared with #297 and external Rig clients.
- Current title tool `mcp__happyherd__change_title` and historical tool names are
  recognized. New links use `happyherd:`; account/terminal readers and native
  registration also accept `happy:` without changing payload/key bytes.
- URLs, legal attribution, raw provider/session fixtures, historical changelogs,
  migration SQL and Git history are retained. English adjectives and third-party
  icon names are not branding. `rename:preserve` spans record semantic exceptions.

The scoped `--check` measures active source naming after these explicit exclusions;
it is not a claim that a raw case-insensitive search returns zero historical names.

## Validation and recovery

Run frozen install; wire/control-agent builds; all affected package typechecks
and suites (including Codium and governed agent); CLI continuity tests; product,
public-boundary, installer and component contracts. Regenerate app localization
types/UI inventory and changelog JSON, run `i18n:check`, and build/export Web,
CLI, server and self-host Web artifacts. Run the repository contract suite from
the committed tree. Review the actual PR CI, including all four native installer
targets and rendered/golden Web evidence. Native release signing and authenticated
upgrade journeys are separate from source/build assertions.

Before release, retain the configured home, database/mount paths, bundle IDs,
existing session IDs and a historical session continuation receipt. Recovery is
reverting the source commit or selecting the previous artifact with the same
configuration and data stores. Never delete/recreate accounts or storage to fix a
naming regression. Keep any user-authored changes out of source rollback.

## Preserve downstream names after upstream sync

Keep `upstream` pointed at `https://github.com/slopus/happy.git`; fetch its exact
approved commit and follow `docs/cli-upstream-sync.md` and repository lineage
discipline. Import with a full-history `git subtree merge --prefix=server`
(no squash), preserving upstream ancestry and accurate provenance URLs.

Run the #297 CLI script for newly imported CLI source and this non-CLI script for
new/reintroduced non-CLI source. Reapply whenever upstream restores old paths,
package names, imports or product copy—not to databases or exported transcripts.
Review rename conflicts and semantic exceptions against both readers/writers;
never silently resolve an upstream conflict by global substitution. Keep the CLI
directory/version and self-host Web bundling coupling intact. Regenerate derived
artifacts, rerun the complete validation above, and record the exact sync/rename
commits in the owned patch ledger. Git history is never rewritten for branding.
