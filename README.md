# HappyHerd

<!-- rename:preserve -->
Keep working with your AI coding agents from a browser, organize conversations
by project, and return to a persistent assistant on your own machine.
HappyHerd is a maintained distribution of [Happy](https://github.com/slopus/happy),
with its complete upstream history preserved under `server/`.
<!-- /rename:preserve -->

Use it to check an agent's progress away from your terminal, keep project work
together, or delegate a separate conversation while retaining the main chat.
The agents run on your connected machines; the server synchronizes the clients.

[Get started](#get-started) · [Downloads](https://github.com/NickGuAI/HappyHerd/releases)
· [Documentation](docs/product-guide.md) · [Report an issue](https://github.com/NickGuAI/HappyHerd/issues)

<!-- rename:preserve -->
## Happy and HappyHerd
<!-- /rename:preserve -->

<!-- rename:preserve -->
Happy supplies the foundation: mobile/Web clients, Claude Code and Codex
integration, and encrypted conversation synchronization. HappyHerd preserves
that work and maintains its own product changes, packaging, and documentation.
Upstream Happy's hosted app, store listings, desktop releases, and community
belong to upstream; they are not HappyHerd downloads or support channels.
<!-- /rename:preserve -->

<!-- rename:preserve -->
| What you can do | Ownership and evidence | Availability |
| --- | --- | --- |
| Follow coding-agent conversations across clients | Inherited from [Happy](https://github.com/slopus/happy); see [source lineage](docs/lineage.md) | HappyHerd Web client is bundled with the self-host server |
| Organize projects and use a persistent Assistant with a selected Commander | HappyHerd-owned [Projects and Assistant guide](docs/projects-and-assistant.md) | Current source; the guide includes changes newer than the public release |
| Browse work files, manage named provider accounts, and schedule agent work | HappyHerd-owned changes documented in the [1.2.4 release notes](https://github.com/NickGuAI/HappyHerd/releases/tag/happyherd-v1.2.4) | Released capabilities and limitations are listed in those notes |
| Open and manage durable side chats | HappyHerd-owned [side-chat lifecycle](.dev/playbooks/side-chat-lifecycle.md) | Current source; do not assume the latest lifecycle is in 1.2.4 |
<!-- /rename:preserve -->

## Downloads and platform availability

As checked on October 7, 2026, the latest stable installer release is
[HappyHerd 1.2.4](https://github.com/NickGuAI/HappyHerd/releases/tag/happyherd-v1.2.4),
published September 20. It contains CLI, server, and Web app archives for
**macOS and Linux, each on arm64 and x64**. Its bundled CLI reports version
1.2.3. These archives are terminal/server distributions, not native graphical apps.

The release does **not** distribute a HappyHerd macOS GUI, iOS or Android app,
Windows installer, or npm package. Native client source and
[build instructions](docs/native-app-builds.md) do not establish public app
availability. Use the bundled Web client with your own server; no HappyHerd
hosted service is promised here. See the [product guide](docs/product-guide.md)
for the release/source boundary and launch work still in progress.

## Get started

On a supported macOS or Linux machine, install as your normal user:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The installer downloads a prepared release; it requires `curl` and `tar`, not a
local compiler or package manager. An interactive first run asks for a server
endpoint. The local default is `http://127.0.0.1:3005`; selecting it starts the
bundled server and ordinary HappyHerd daemon. Open that address in a browser on
the same computer and follow the account and terminal-connection prompts.
For a remote server, use its actual Web address instead of localhost.

If a noninteractive fresh install defers authentication, follow its printed
next step:

```sh
happyherd auth login && happyherd daemon start
```

Use the chosen provider's supported authentication/setup before starting work:

```sh
happyherd claude
# Or use Codex:
happyherd codex
```

See the [installer guide](docs/public-launcher-release.md) for server selection,
upgrades, version selection, and removal. The live installer script and the
stable archive have separate revisions: installing the latest archive does not
install all features from `main`. End-to-end onboarding improvements remain
tracked in [#378](https://github.com/NickGuAI/HappyHerd/issues/378).

## Guides and development

- [Product guide and launch status](docs/product-guide.md)
- [Projects, Assistant, and Commanders](docs/projects-and-assistant.md)
- [Self-host deployment](docs/deployment.md) and [runtime boundaries](docs/runtime-isolation.md)
- [Source components](server/README.md) and [contribution guide](server/docs/CONTRIBUTING.md)
- [Development and verification](.dev/AGENTS.md)

The repository keeps upstream source history in `server/`, owned branding in
`branding/`, deployment templates in `deploy/`, and maintenance scripts in
`scripts/`. Owned changes are recorded in the [patch ledger](docs/owned-patches.tsv).

Pull requests outside `.dev/` run the [quality gates](.github/workflows/quality-gates.yml)
(Clean install, Lint, Typecheck, Unit tests, Production build) and the independent
[Contract suite](.github/workflows/contract-suite.yml).

## License, credits, and support

<!-- rename:preserve -->
HappyHerd and upstream Happy are distributed under the [MIT](LICENSE) license. Credit for the
upstream foundation belongs to the [Happy contributors](https://github.com/slopus/happy).
For HappyHerd help or bugs, use [this repository's issues](https://github.com/NickGuAI/HappyHerd/issues).
You can also [buy the developer one $5 coffee](https://buymeacoffee.com/nickguy).

<!-- /rename:preserve -->