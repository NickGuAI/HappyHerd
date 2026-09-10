# HappyHerd

HappyHerd is a maintained distribution of
[Happy](https://github.com/slopus/happy). It preserves Happy's complete upstream
history under `server/` and layers independently reviewable product,
governance, release, and agent-runtime contracts on top.

Repository ownership, deployment domains, infrastructure identifiers, operator
paths, and organization-specific integrations are configuration—not generic
source code. A public-boundary gate checks that invariant before changes ship.

## Continuous integration

Every pull request that changes a path outside `.dev/` runs the
[quality gates](.github/workflows/quality-gates.yml)—Clean install, Lint,
Typecheck, Unit tests, and Production build—and the independent
[Contract suite](.github/workflows/contract-suite.yml). A `.dev/`-only change
runs only the path-scope jobs needed to satisfy protected-main status reporting;
all install, lint, typecheck, test, build, and contract jobs are skipped.

## License and support

HappyHerd is distributed under the [MIT](LICENSE) license, the same license as
upstream Happy. If HappyHerd is useful to you, you can
[buy the developer one $5 coffee](https://buymeacoffee.com/nickguy).

## Repository layout

- `server/` — full-history Happy subtree plus HappyHerd-owned runtime changes.
- `branding/` — HappyHerd-owned brand assets.
- `deploy/` — generic, secret-free deployment templates.
- `examples/` — explicitly named organization integrations.
- `docs/` — lineage, component deployment, runtime, and public-release contracts.
- `scripts/` — verification, upstream comparison, component build, and deployment tools.

## Self-host deployment

The self-host server intentionally includes the Web bundle, matching upstream
Happy. It is built and deployed independently of the CLI/daemon, mobile app,
and governed agent:

```sh
scripts/build-server-image.sh --image ghcr.io/example/happyherd:main --push
sudo scripts/deploy-server.sh ghcr.io/example/happyherd:main \
  /etc/happyherd/runtime.env
```

The deployment command pulls the chosen image, restarts the central server,
and verifies `/health`. Rollback is the same command with an older tag. Install
or upgrade the host CLI separately with `sudo scripts/install-host-cli.sh`;
the Linux boot adapter delegates daemon lifetime to the native HappyHerd CLI.

See [docs/deployment.md](docs/deployment.md) for the complete component map and
[docs/runtime-isolation.md](docs/runtime-isolation.md) for state and credential
boundaries.

## Install and run locally

Install HappyHerd on macOS or Linux as your normal user:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The installer selects a prepared release for the current operating system and
CPU. The archive contains the built `@happyherd/cli`, self-host server, Web app,
platform tools, and Node runtime. Installation needs only `curl` and `tar`; it
does not need Node.js, npm, pnpm, Bun, compilers, `sudo`, or a `TMPDIR`
workaround.

An interactive first run asks for a server endpoint. Press Enter for the local
default, `http://127.0.0.1:3005`, or enter a remote URL. The choice is stored in
`~/.happyherd/settings.json`, so no server URL environment variables are
needed. The local default starts the bundled server and ordinary detached Happy
daemon. A noninteractive fresh install prints the authentication command to run
next.

Re-run the command to upgrade. It keeps the current server choice unless you
pass another `--server` value, and it preserves accounts, sessions, provider
homes, user-managed Skills, and normal `~/.happyherd` state. Use `--version
1.2.3` for tag `happyherd-v1.2.3`, `--asset FILE_OR_URL` for a prepared asset,
or `--no-start` to skip starting the server and daemon.

The default command requires a stable GitHub Release containing the four new
native assets. Tagged release CI supplies the macOS and ARM evidence that a
local Linux build cannot provide.

See [docs/public-launcher-release.md](docs/public-launcher-release.md) for the
installer and cleanup contract.

See [docs/lineage.md](docs/lineage.md) for upstream provenance.

## Projects and assistant

[HappyHerd Projects and Assistant Guide](docs/projects-and-assistant.md)
