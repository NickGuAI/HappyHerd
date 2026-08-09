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
