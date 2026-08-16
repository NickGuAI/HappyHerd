# Runtime isolation

HappyHerd uses explicit deployment profiles rather than embedding an operator,
domain, registry, host path, or organization in runtime code. Every profile
owns separate server data, logs, CLI state, and secret files. Profiles must not
reuse legacy Happy or Herd state.

The default template is `deploy/runtime.env.example`; a second independent
template is `deploy/runtime.secondary.env.example`. Both use documentation
domains and a placeholder image repository. Operators copy a template outside
the source tree and replace every placeholder with their own values.

Secrets live in separate mode-`0600` files. They are never committed, echoed,
or placed on a container command line. Images must be selected by immutable
digest.

## Server profile

```bash
sudo install -d -m 0750 /etc/happyherd
sudo install -m 0600 deploy/runtime.env.example /etc/happyherd/runtime.env
# Replace the example domain, repository, and image digest.
sudo scripts/prepare-runtime.sh /etc/happyherd/runtime.env
sudo install -m 0644 deploy/happyherd.service /etc/systemd/system/happyherd.service
sudo systemctl daemon-reload
sudo systemctl enable --now happyherd.service
```

The unit runs the immutable container in the foreground, persists application
state only under the configured data root, and writes logs only under the
configured log root. Both `/health` and `/api/health` return the same
database-backed readiness result.

Validate a profile before activation:

```bash
scripts/validate-runtime-isolation.sh /etc/happyherd/runtime.env runtime
```

Validation rejects malformed public identity, invalid ports, overlapping
runtime roots, legacy state, mutable images, and missing or weakly protected
secret files.

## Host daemon

The host daemon is built from the same source commit as the server image. Its
environment template uses a dedicated service home; operators may substitute a
different unprivileged identity without encoding that identity in the public
repository.

```bash
sudo install -m 0600 deploy/happyherd-daemon.env.example /etc/happyherd/daemon.env
sudo install -m 0644 deploy/happyherd-daemon.cron /etc/cron.d/happyherd-daemon
sudo -u happyherd-runtime /opt/happyherd/current/scripts/start-host-daemon.sh \
  /etc/happyherd/daemon.env
```

The cron entry is a detached bootstrap, not a supervisor. Version handoff and
daemon restart therefore do not terminate an active provider session. The
bootstrap verifies that the replacement daemon reports the exact installed
release SHA. The daemon holds only an in-memory registration index; provider
sessions own their lifetimes and re-register after a daemon handoff.

## Governed Discord agent

`@happyherd/happyherd-agent` is a generic Discord-to-HappyHerd runtime. An
operator supplies a strict tool manifest, authorization endpoint, isolated
HappyHerd account, isolated Codex home, and Discord allowlists. The generic
release does not know which organization or provider families the manifest
represents.

```text
Discord message
      │
      ▼
isolated bridge ── authorization grant ── organization service
      │
      ├── encrypted HappyHerd session
      │
      └── loopback-only governed MCP broker
                    │
                    ▼
             manifest-approved operation
```

Two unprivileged service identities split credentials:

| Process | Private state | Credentials it may read |
|---|---|---|
| Discord bridge | `/var/lib/happyherd-agent-bridge` | Discord token, service signing/transport material, bridge HappyHerd key |
| Happy daemon and Codex | `/var/lib/happyherd-agent-runtime` | dedicated HappyHerd machine key and dedicated Codex login |

Codex receives only an opaque short-lived capability, the loopback broker URL,
and the current manifest's tool descriptions. Shared Discord surfaces are
read-only. Personal operations and every write require a DM, actor-bound scope,
and exact-action confirmation. Missing, expired, or denied authorization fails
closed before a privileged turn starts.

Provision and verify an installed release:

```bash
sudo /opt/happyherd/current/scripts/prepare-happyherd-agent-runtime.sh
sudoedit /etc/happyherd-agent/bridge.env
sudoedit /etc/happyherd-agent/daemon.env
sudoedit /etc/happyherd-agent/agent-manifest.json
sudo /opt/happyherd/current/scripts/provision-happyherd-agent-account.sh
sudo /opt/happyherd/current/scripts/write-discord-token-rotation-receipt.sh \
  /etc/happyherd-agent/secrets/discord-token DISCORD_APPLICATION_ID
sudo /opt/happyherd/current/scripts/validate-happyherd-agent-runtime.sh \
  /etc/happyherd-agent/bridge.env runtime
sudo systemctl enable --now happyherd-agent.service
sudo /opt/happyherd/current/scripts/health-happyherd-agent.sh
```

The `/mcp` listener remains loopback-only and is reachable from sandboxed Codex
only through `happyherd-agent-broker.localhost`. A reverse proxy may expose the
separately authenticated execution route to the organization service.

The generic template includes one neutral guide tool. A concrete organization
example lives in [`examples/pmai-happyherd-agent/`](../examples/pmai-happyherd-agent/).
