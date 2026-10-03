# HappyHerd native runtime

This directory owns the source and build of HappyHerd's native provider runtime.
It is a separate pnpm workspace because its Node and compiler requirements differ
from the app/CLI workspace under `server/`. No checkout, PR, installed daemon, or
unreleased package from another repository is needed to build this source.

<!-- Preserved native compatibility names and source provenance. -->
<!-- rename:preserve -->
## Provenance and scope

The seven core packages were imported from the Git-tracked source of
`slopus/happy-agent` at `37886c58dbf9fff0d4c2f6922c52dbbbf69f2a74`, whose base is
`b2baf1586b9b4e7ed03bad91541ccad0a969c3ef`. That import includes the reviewed
read-only `session-context-window` machine RPC. HappyHerd now maintains it here.
`source-provenance.json` records the exact source selection and omissions.
The MIT license and third-party notices are retained. Upstream package names,
protocol identifiers, database schema, paths and provider records are compatibility
identities and remain unchanged.

```text
HappyHerd app → existing encrypted machine RPC → native HappyConnection
                                                ↓ owner/account/session mapping
                                           original native database
                                                ↓ ordered retained records
                                           shared Context window
```

The daemon, module collection, Agent Base, API client, compute, providers and
supervisor resolve to local workspace packages. Ordinary third-party dependencies
remain locked registry packages. Native SQLite persistence, original cwd/state
home and remote/native identity mapping remain owned by this same runtime.
No second transport or CLI fallback supplies native context.

The terminal UI, plugins, worklets, separate gyms, upstream CI/release workflows,
agent instruction files, live provider tests and unrelated recorded provider
fixtures (and the two suites that consume them) are outside this import. No private transcripts, credentials, node_modules,
build outputs or external working-tree changes were imported. Optional Tailcat
release binaries are omitted: native source builds already resolve an explicitly
configured executable or PATH, and Tailcat is off by default. This build does not
supply Tailcat exposure or a standalone Bun release bundle.

## Build and verify

Use Node 24, pnpm 10.28.1 and Rust 1.96.0 (the supervisor's pinned toolchain).
Bun is needed by the retained provider unit-test scripts. On macOS, Xcode command
line tools supply Swift for the upstream menu-bar build.

```sh
cd native
pnpm install --frozen-lockfile
pnpm build
pnpm build:supervisor
pnpm check
pnpm test:context
TMPDIR=/private/tmp pnpm test # macOS: use its canonical temporary-directory path
pnpm lint
```

`build` produces the seven JavaScript packages. `build:supervisor` builds the native
sandbox executable from the checked-in Rust source. Both are required for a fully
source-built runtime; JavaScript compilation alone does not establish sandbox
availability. The existing resolver locates the local native target. Build output
stays ignored and is never committed. `pnpm start -- --help` inspects the CLI;
starting or pairing a runtime requires the operator's separately chosen account,
state home and working directory. Do not restart a shared daemon as a build step.

## Credentials and Context reads

The ordinary Codex provider supports its existing Codex login: it reads the
configured `auth_file`, otherwise `CODEX_HOME/auth.json`, otherwise the native
user's `.codex/auth.json`. No credential value belongs in this repository, a build,
a test fixture or a handoff. A disposable acceptance runtime should use only its
explicitly authorized provider identity. Native OAuth refresh remains the provider's
normal owner: daemon startup schedules an immediate background refresh, then repeats
it every three hours; unauthorized responses can also refresh the selected login file.
This is not a promise that model execution never writes credentials.

Opening Context itself does not invoke inference, read provider credentials, start
or resume an agent, mutate context, or refresh OAuth. It reads retained native
records in native order and reports unrecorded runtime input honestly. Unit fixtures
and scripted compaction tests remain distinct from authenticated model acceptance.

<!-- /rename:preserve -->
