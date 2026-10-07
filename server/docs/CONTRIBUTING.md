# Contributing to HappyHerd

<!-- rename:preserve -->
HappyHerd maintains a distribution of [Happy](https://github.com/slopus/happy).
Contribute distribution changes to
[HappyHerd](https://github.com/NickGuAI/HappyHerd), and retain upstream attribution
and compatibility identifiers. Upstream Happy has its own maintainers and
contribution process.
<!-- /rename:preserve -->

## Report a problem or propose a change

Use [HappyHerd issues](https://github.com/NickGuAI/HappyHerd/issues). Describe
what happened, what you expected, and the release or source revision involved.
Keep credentials and private session content out of public reports.

Use one owning issue and a focused branch for each change. Read the repository
[agent guide](../../AGENTS.md), [development index](../../.dev/AGENTS.md), and
[development lifecycle](../../.dev/playbooks/development-lifecycle.md) before
editing. These define the patch ledger, review, changelog, and verification
requirements for this distribution.

## Source setup

Use Node 20 and the repository-pinned pnpm 10.11.0. Additional checks require
Bun 1.3.11 and ShellCheck; see the [verification matrix](../../.dev/VERIFY.md).

```sh
git clone https://github.com/NickGuAI/HappyHerd
cd HappyHerd/server
pnpm install --frozen-lockfile
```

Run package commands from `server/`:

```sh
pnpm --filter happyherd-app start
pnpm --filter happyherd-app typecheck
pnpm --filter @happyherd/cli build
pnpm --filter @happyherd/cli test
pnpm --filter ./packages/happyherd-server --fail-if-no-match standalone:dev
```

For the local server, configure the development client with its actual endpoint:

```sh
EXPO_PUBLIC_HAPPYHERD_SERVER_URL=http://localhost:3005 pnpm --filter happyherd-app start
```

These are source-development commands, not instructions to install a public npm
package or replace a running machine's CLI. For released software use the
[installer guide](../../docs/public-launcher-release.md). For native clients,
use the [native build guide](../../docs/native-app-builds.md): configured iOS
identities, retained Android compatibility identifiers, local compilation,
signing, and public distribution are separate concerns.

## Review evidence

Explain the user-visible outcome and provide evidence appropriate to the
changed behavior. Follow the verification matrix and record failures as well
as successful checks. Current source, local builds, published downloads, and
live service behavior are distinct evidence; none implies the others.

<!-- rename:preserve -->
The [workspace README](../README.md) maps the components. For background on the
upstream foundation, see [Happy's documentation](https://happy.engineering/docs/).
HappyHerd support remains in this repository's issues.

<!-- /rename:preserve -->