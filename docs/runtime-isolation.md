# Runtime boundaries

HappyHerd keeps deployment configuration outside the repository and keeps each
runtime's durable state separate. These are ordinary operational boundaries,
not a requirement that unrelated components share a build, Git SHA, image
digest, activation directory, or rollback transaction.

The default server template is `deploy/runtime.env.example`; a second template
is `deploy/runtime.secondary.env.example`. Operators copy a template to
`/etc/happyherd/runtime.env`, replace the examples, and keep secret values in
separate mode-`0600` files. A server image is selected by a normal registry
tag.

## Central self-host server

The self-host image contains the API server, Prisma migrations, and the Web
bundle served by that server. The central server is the one HappyHerd component
owned by `happyherd.service`:

```bash
sudo install -d -m 0750 /etc/happyherd
sudo install -m 0600 deploy/runtime.env.example /etc/happyherd/runtime.env
# Edit the copied public URL, paths, image tag, and secret-file path.
sudo scripts/install-server-service.sh /etc/happyherd/runtime.env
sudo scripts/deploy-server.sh ghcr.io/example/happyherd:main \
  /etc/happyherd/runtime.env
```

`deploy-server.sh` pulls the exact operator-selected tag, restarts only the
central server, and verifies both local and public `/health`. After successful
health checks it removes only unused images labeled as HappyHerd; Docker keeps
images referenced by any container. Rollback is explicit: rerun the same
command with a previously published image tag.

The service persists application state only under `HAPPYHERD_DATA_DIR`, writes
logs under `HAPPYHERD_LOG_DIR`, and reads its master secret from
`HAPPYHERD_MASTER_SECRET_FILE`. The image is replaceable; those host paths are
durable.

## Host CLI, daemon, and provider sessions

The HappyHerd CLI is built and installed independently of the server image:

```bash
sudo scripts/install-host-cli.sh
sudo install -m 0600 deploy/happyherd-daemon.env.example \
  /etc/happyherd/daemon.env
sudo scripts/install-linux-daemon-bootstrap.sh /etc/happyherd/daemon.env ec2-user
sudo -u ec2-user \
  /usr/local/lib/happyherd/start-host-daemon.sh \
  /etc/happyherd/daemon.env
```

Replace `ec2-user` with the actual account that owns the configured
`HAPPY_HOME_DIR` and provider credentials. The bootstrap initializes an empty
Happy home to `http://127.0.0.1:3005`; otherwise the ordinary daemon keeps the
server selection already persisted there. The template does not require
`HAPPY_SERVER_URL` or `HAPPY_WEBAPP_URL` exports.

The Linux cron entry is only a boot-time availability adapter. It calls the
maintained HappyHerd CLI's native detached `daemon start` lifecycle and exits. The
daemon and Claude/Codex provider processes are not placed in a HappyHerd-owned
systemd cgroup. They may reconnect and complete sessions independently of
central-server or CLI upgrades.

The daemon does not compare its Git identity with the server. Compatibility is
owned by the existing wire/API contract and component tests.

## Governed Discord agent

`@happyherd/happyherd-agent` is optional and has its own build/install lane. It
composes `happy-agent/control` with Discord and a policy-bounded organization
service broker. Install it only when that component changes:

```bash
sudo scripts/install-host-cli.sh
sudo scripts/install-agent-runtime.sh
sudo /usr/local/lib/happyherd-agent-support/scripts/prepare-happyherd-agent-runtime.sh
sudoedit /etc/happyherd-agent/bridge.env
sudoedit /etc/happyherd-agent/daemon.env
sudoedit /etc/happyherd-agent/agent-manifest.json
sudo /usr/local/lib/happyherd-agent-support/scripts/provision-happyherd-agent-account.sh
sudo /usr/local/lib/happyherd-agent-support/scripts/validate-happyherd-agent-runtime.sh \
  /etc/happyherd-agent/bridge.env runtime
```

Two unprivileged identities keep bridge credentials apart from the dedicated
Happy/Codex runtime. Codex receives an opaque short-lived capability and the
loopback broker URL, not the Discord token or organization-service credential.
The `/mcp` listener remains loopback-only.

## Independent release lanes

- **Server + Web:** one self-host container image, because upstream Happy
  intentionally bundles the Web export into the self-host server.
- **CLI + host daemon:** native HappyHerd CLI package, upgraded without rebuilding
  or restarting the central server.
- **Mobile:** its own app build, only when mobile source changes.
- **Governed agent:** its own package and operator-controlled service, only when
  agent source changes.
- **Local installer:** a user-owned bootstrap installs the HappyHerd CLI
  and ordinary daemon without a separate integrity, broker, vault, or issuer
  layer; it does not control self-host server deployment.

See [deployment.md](deployment.md) for the operator sequence.
