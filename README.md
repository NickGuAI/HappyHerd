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
all install, lint, typecheck, test, build, contract, and upstream-rehearsal jobs
are skipped.

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
- `scripts/` — verification, upstream-sync, component build, and deployment tools.

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
the Linux boot adapter delegates daemon lifetime to the native Happy CLI.

See [docs/deployment.md](docs/deployment.md) for the complete component map and
[docs/runtime-isolation.md](docs/runtime-isolation.md) for state and credential
boundaries.

## Install and run locally

On macOS or Linux, install HappyHerd as your normal user with one command:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The installer downloads the source, builds it in a user-owned directory, and
creates `happyherd` and `happy` commands. `happyherd` is a thin alias that
forwards directly to the bundled Happy CLI.

Start the local server and ordinary detached daemon:

```sh
happyherd daemon status
# If the local server was stopped:
happyherd server --no-persist
```

The installer asks for a server URL and defaults to
`http://127.0.0.1:3005`. The choice is stored in normal Happy settings; a
remote server is used only when the user explicitly selects one. The local
server and ordinary detached daemon start automatically for the local default.
No issuer,
manifest, checksum, broker, credential vault, or environment-variable setup is
part of the local install.

See [docs/public-launcher-release.md](docs/public-launcher-release.md) for the
installer and cleanup contract.

See [docs/lineage.md](docs/lineage.md) for upstream provenance.
