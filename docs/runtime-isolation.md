# Runtime isolation

HappyHerd uses an explicit deployment profile rather than embedding one domain
or port in its runtime scripts. Every profile owns separate server data, logs,
CLI state, and secrets. A profile must not reuse legacy Happy, `qmherd`, or Herd
state.

The default profile is `deploy/runtime.env.example`. Bao Lab uses
`deploy/runtime.baolab.env.example`, keeps the existing public route untouched,
and binds HappyHerd to the service port that route already targets:

| Boundary | Default | Bao Lab |
|---|---|---|
| Domain | `happyherd.gehirn.ai` | `baolab.gehirn.ai` |
| Host port | `20015` | `20001` |
| Data | `/var/lib/happyherd/data` | `/var/lib/happyherd/data` |
| Logs | `/var/log/happyherd/server.log` | `/var/log/happyherd/server.log` |
| CLI home | `/var/lib/happyherd/cli` | `/var/lib/happyherd/cli` |
| Master secret | `/etc/happyherd/master-secret` | `/etc/happyherd/master-secret` |
| Voice key | unset | `/etc/happyherd/openai-api-key` |
| Container | `happyherd` | `happyherd` |

The public runtime configuration lives at `/etc/happyherd/runtime.env`. Master
and provider secrets live in separate mode-`0600` files and are never committed,
echoed, or placed in the Docker command line. The container receives the voice
key only as a read-only file mount. The image value must be an immutable digest.

## Provision and run

```bash
sudo install -d -m 0750 /etc/happyherd
sudo install -m 0600 deploy/runtime.baolab.env.example /etc/happyherd/runtime.env
# Replace only HAPPYHERD_IMAGE with the released digest.
# When voice is enabled, install the OpenAI key as mode 0600 at the declared path.
sudo scripts/prepare-runtime.sh /etc/happyherd/runtime.env
sudo install -m 0644 deploy/happyherd.service /etc/systemd/system/happyherd.service
sudo systemctl daemon-reload
sudo systemctl enable --now happyherd.service
```

The unit runs the immutable container in the foreground, persists application
state only under the HappyHerd data root, and writes stdout/stderr only to the
HappyHerd log. Web configuration is injected from the profile and analytics are
disabled. Both `/health` and the legacy `/api/health` path return the same
database-backed readiness result; neither can fall through to the Web shell.

## Host daemon

The daemon is built from the same source commit as the server image. Extract its
archive under `/opt/happyherd/releases/<source-sha>/daemon`, point
`/opt/happyherd/current` at that release, and install the daemon environment and
one-shot boot entry:

```bash
sudo install -o ec2-user -g ec2-user -m 0600 deploy/happyherd-daemon.env.example /etc/happyherd/daemon.env
sudo install -m 0644 deploy/happyherd-daemon.cron /etc/cron.d/happyherd-daemon
sudo install -d -o ec2-user -g ec2-user -m 0700 /home/ec2-user/.happyherd
sudo -u ec2-user env PATH=/home/ec2-user/.local/bin:/usr/local/bin:/usr/bin:/bin claude --version
sudo -u ec2-user env PATH=/home/ec2-user/.local/bin:/usr/local/bin:/usr/bin:/bin codex --version
sudo -u ec2-user /opt/happyherd/current/scripts/start-host-daemon.sh /etc/happyherd/daemon.env
```

The boot entry invokes upstream `happy daemon start` and exits after the
detached daemon reports ready. It is a bootstrap, not a supervisor: neither the
daemon nor Claude/Codex provider processes live in a HappyHerd-owned systemd
cgroup. Consequently, `happy daemon stop`, version handoff, and daemon restart
cannot terminate an active provider session or cause the server to archive it.

The account key remains in the unprivileged user's isolated `HAPPY_HOME_DIR`;
Claude and Codex use the host's existing subscription-authenticated CLIs through
the declared `PATH`. The bootstrap preflights both provider commands before
starting. Install them under the stable user-owned
`/home/ec2-user/.local/bin`; do not point this path at a version-specific NVM
directory. Only the central `happyherd.service` Web/API server is supervised by
systemd.

## Guardrail

```bash
scripts/test-runtime-isolation.sh
scripts/validate-runtime-isolation.sh /etc/happyherd/runtime.env runtime
```

Validation fails for malformed or mismatched public identity, invalid ports,
overlapping runtime roots, legacy `.happy` or `.happy-server-data`, Herd state,
any `qmherd` path, an unpinned image, or a missing/weakly-permissioned secret.

## PMAI Discord Agent profile

The PMAI Discord integration adds a trusted edge client without moving
plaintext into `happy-server`. It is packaged as
`happyherd-pmai-discord-agent-<arch>-<os>.tar.gz` alongside the daemon artifact
from the same source commit. The host installer extracts both beneath the same
immutable release and switches them with one `current` symlink.

Two unprivileged identities split credentials that must never meet:

| Process | User | Private state | Credentials it may read |
|---|---|---|---|
| Discord bridge | `pmai-discord-bridge` | `/var/lib/pmai-discord-bridge` | Discord bot, PMAI service signing/transport, Happy control-client account key |
| Happy daemon and Codex | `pmai-happyherd-agent` | `/var/lib/pmai-happyherd-agent` | Dedicated Happy machine account and dedicated Codex login |

The Codex user cannot traverse the bridge state, secret directory, or daemon
HappyHerd home. It receives only a short-lived, opaque session capability and
the loopback broker URL. PMAI turns fail unless the Happy OS sandbox is enabled;
the workspace has no write grant. The provider starts with hosted web search
and apply-patch disabled, while a synchronous hook denies shell, filesystem,
subagent, plugin, and non-PMAI tool calls. Only the five governed PMAI MCP tools
are exposed. Shared Discord surfaces remain read-only; the broker enforces
actor scope and same-actor exact-action confirmation.

Provision the public layout and units from an installed release:

The release bundles the exact ripgrep (`rg`) executable required by the sandbox
runtime, while preparation installs Bubblewrap for filesystem/process isolation
and `socat` for mediated loopback networking. Runtime validation executes all
three through the dedicated agent identity and fails closed if any is absent.

```bash
sudo /opt/happyherd/current/scripts/prepare-pmai-discord-agent-runtime.sh
sudoedit /etc/pmai-discord-agent/bridge.env
sudoedit /etc/pmai-discord-agent/daemon.env
sudo /opt/happyherd/current/scripts/provision-pmai-happy-account.sh
```

The provisioner creates a new dedicated HappyHerd account, issues distinct
bridge and daemon client tokens for that account, registers its isolated
machine, writes the machine ID into the bridge profile, and starts the detached
daemon. It does not consume a personal HappyHerd credential. Authenticate
Codex separately and only as `pmai-happyherd-agent`, with the executable
installed under `/var/lib/pmai-happyherd-agent/.local/bin` and its authentication
under the declared isolated `CODEX_HOME`. Never copy an account key, Codex
home, Commander, or workspace from `ec2-user` or another personal runtime. The
daemon bootstrap is an `@reboot` detached process for the same reason as the
normal HappyHerd host daemon: bridge restart or release rollback must not
terminate an active Codex turn.

The bot token previously appeared outside a secret store. Production refuses
to connect to Discord until that token is reset in Discord, installed as a new
mode-`0600` file, and accompanied by a receipt bound to the application ID,
post-incident rotation time, and installed token hash:

```bash
sudo /opt/happyherd/current/scripts/write-pmai-discord-token-rotation-receipt.sh \
  /etc/pmai-discord-agent/secrets/discord-token DISCORD_APPLICATION_ID
```

Install the separate PMAI signing and transport secrets, then validate before
enablement. The validator checks distinct users and credential stores, exact
path ownership, Commander/workspace templates, sandbox policy, Happy machine
binding, token rotation, daemon liveness, and matching release payloads without
printing secret values.

```bash
sudo /opt/happyherd/current/scripts/validate-pmai-discord-agent-runtime.sh \
  /etc/pmai-discord-agent/bridge.env runtime
sudo systemctl enable --now pmai-discord-agent.service
sudo /opt/happyherd/current/scripts/health-pmai-discord-agent.sh
```

`/mcp` must remain loopback-only. Sandboxed Codex reaches it through the
HappyHerd network mediator using the dedicated `pmai-broker.localhost` alias;
the production validator requires exactly that alias and the corresponding
domain allowlist. A TLS reverse proxy may expose only the service-authenticated
`/internal/discord/execute` route to the PMAI API. The public PMAI authorization
route and all five provider routes remain owned by Part 1; if any of them is
absent, revoked, expired, or denies scope, the bridge fails closed before
privileged agent work.

Rollback switches both daemon and bridge code to one installed source SHA,
hands the detached daemon to that version, restarts only the bridge, and then
requires full readiness:

```bash
sudo /opt/happyherd/current/scripts/rollback-pmai-discord-agent.sh PREVIOUS_SOURCE_SHA
```
