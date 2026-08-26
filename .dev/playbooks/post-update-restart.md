# Post-update server and daemon restart

Use this playbook when an operator explicitly updates both the central
server/Web component and one or more native Happy CLI daemon hosts. It is also
the acceptance path after a merged change crosses both component boundaries.

This is not a lockstep release rule. Server/Web, CLI/daemon, mobile, governed
agent, and public launcher remain independent delivery lanes. If only one lane
changed, deploy only that lane through [`docs/deployment.md`](../../docs/deployment.md).

For the combined operation, the activation order is fixed:

```text
operator-selected component artifacts
        │
        ├── selected server + Web image tag
        │          ↓
        │   deploy and restart central server FIRST
        │          ↓
        │   local/public health + image read-back
        │
        └── selected host CLI source or supported installer
                   ↓
            stop → upgrade → start daemon
                   ↓
            daemon/session read-back
                   ↓
            refresh website → verify machine metadata and providers
```

Do not stop or upgrade a host daemon while the intended server restart is still
pending. The server-first order makes the updated API and Web client live before
the daemon reconnects and registers its runtime RPC/capability state; it does
not require the two components to share one Git revision, build artifact, or
rollback transaction. Existing malformed stored metadata still requires the
separate recovery path below.

## 1. Resolve the intended component artifacts without disturbing user work

When the requested update is to current `main`, fetch and inspect it before
changing a runtime:

```bash
git fetch origin main
UPDATE_SHA="$(git rev-parse origin/main)"
git show --no-patch --oneline "$UPDATE_SHA"
```

Identify which component lanes actually changed. Record the operator-selected
server image tag and the source or installer version selected for each CLI
host. They may come from different revisions: component-native deployment does
not require a shared Git SHA, image digest, or release receipt.

For a source-built CLI installation, use an isolated checkout at the intended
CLI revision and require only that its tracked source is unchanged:

```bash
CLI_SOURCE_SHA="$(git rev-parse HEAD)"
git show --no-patch --oneline "$CLI_SOURCE_SHA"
test -z "$(git status --porcelain --untracked-files=no)"
```

Use an isolated worktree when the canonical checkout contains unrelated work.
Never use `git reset`, `git clean`, or removal of another agent's worktree to
prepare an update.

## 2. Select the server image when the server/Web lane changed

`.github/workflows/server-image.yml` publishes both `sha-<commit>` and moving
`main` tags when server-relevant paths change. Deploy the normal registry tag
the operator selected; the maintained deployment interface intentionally
accepts either form:

```bash
REPO_OWNER="$(gh repo view --json owner --jq .owner.login)"
IMAGE="ghcr.io/${REPO_OWNER,,}/happyherd:main"
# Also valid when explicitly selected:
# IMAGE="ghcr.io/${REPO_OWNER,,}/happyherd:sha-<workflow-head-sha>"
```

When the intent is to activate a newly published server/Web build, inspect its
successful workflow run before deployment. This establishes which artifact the
operator meant to select; it is not a cross-component identity gate. Set this
SHA from the selected server-image run, independently of the CLI source:

```bash
SERVER_BUILD_SHA=<selected-server-workflow-head-sha>
gh run list --workflow server-image.yml --commit "$SERVER_BUILD_SHA" \
  --json databaseId,headSha,status,conclusion,url
gh run view <run-id> --json headSha,status,conclusion,url
```

If no run exists because no server-image watched path changed, then the
server/Web lane did not receive a new image from that merge; do not turn a
CLI-only update into a server restart. A deliberate manual build must run from
the operator-selected source. Do not infer that the server and CLI artifacts
must have the same Git identity.

## 3. Deploy and verify the central server first

From the checkout containing the maintained deployment scripts:

```bash
SERVER_ENV=/etc/happyherd/runtime.env

# Refresh installed service support when its source or unit changed.
sudo scripts/install-server-service.sh "$SERVER_ENV"
sudo scripts/deploy-server.sh "$IMAGE" "$SERVER_ENV"
```

`install-server-service.sh` refreshes the stable support scripts and systemd
unit used by the deployment; it is required whenever those repository inputs
changed since their last installation. `deploy-server.sh` then pulls the
selected image, replaces exactly one `HAPPYHERD_IMAGE` assignment, restarts
`happyherd.service`, waits for local `/health`, checks the configured public
`/health`, and prunes only unused HappyHerd-labeled images. Neither command
updates the CLI, daemon, mobile app, or governed agent.

Before touching a daemon, retain these read-backs:

```bash
sudo systemctl is-active happyherd.service
sudo systemctl show happyherd.service \
  --property=MainPID \
  --property=ExecMainStartTimestamp

# Set this to HAPPYHERD_CONTAINER_NAME from the runtime environment.
CONTAINER_NAME=happyherd
sudo docker inspect "$CONTAINER_NAME" \
  --format '{{.Config.Image}} {{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

The proof is the newly started service, configured operator-selected tag,
running image ID, available OCI revision label, and successful local and public
health checks. A successful workflow or image pull alone is not a server
restart.

If deployment fails, leave the host daemon unchanged. Server rollback is
explicit: rerun `scripts/deploy-server.sh` with the previously published tag.

## 4. Stop, upgrade, and start each native host daemon

Record the host account and environment that already own the daemon. The same
account, `HAPPY_HOME_DIR`, server URL, and provider credentials must be used on
both sides of the restart. On Linux, this helper runs native CLI commands in
that existing environment without printing it:

```bash
DAEMON_USER=example-user
DAEMON_ENV=/etc/happyherd/daemon.env
DAEMON_GROUP="$(id -gn "$DAEMON_USER")"

id "$DAEMON_USER"
# The daemon, not root, consumes this file. Preserve least privilege while
# making the maintained user-owned cron/bootstrap path executable.
sudo chown "$DAEMON_USER:$DAEMON_GROUP" "$DAEMON_ENV"
sudo chmod 0600 "$DAEMON_ENV"
sudo -u "$DAEMON_USER" test -r "$DAEMON_ENV"

host_happy() {
  sudo -u "$DAEMON_USER" bash -c '
    set -a
    source "$1"
    set +a
    shift
    exec "$HAPPYHERD_DAEMON_CLI" "$@"
  ' bash "$DAEMON_ENV" "$@"
}
```

Do not overwrite an existing environment file with the repository example.
The expected steady state is mode `0600`, owned by the daemon account that must
read its server URL, Happy home, and provider environment. Root-only ownership
is incompatible with the maintained user-owned cron/bootstrap path.

Capture the pre-restart process and session view, then stop only the daemon:

```bash
host_happy --version
host_happy daemon status
host_happy daemon list
host_happy daemon stop
```

`happy daemon stop` deliberately leaves provider sessions alive. Do not use
`happy doctor clean`, log out, delete the Happy home, or kill provider
processes as part of an update.

For a Linux source installation, install from the recorded `CLI_SOURCE_SHA`
checkout using the pinned Node 20 and pnpm 10.11.0 toolchain:

```bash
cd server
pnpm install --frozen-lockfile
cd ..
git diff --exit-code -- server
sudo scripts/install-host-cli.sh
sudo scripts/install-linux-daemon-bootstrap.sh "$DAEMON_ENV" "$DAEMON_USER"
```

The bootstrap reinstall refreshes the stable start helper and boot entry from
the selected source; it does not start or supervise the daemon. If the
readability preflight fails, correct the environment file through the host's
approved ownership/permission configuration before stopping the daemon.

Start through the maintained detached lifecycle, still as the same account:

```bash
sudo -u "$DAEMON_USER" \
  /usr/local/lib/happyherd/start-host-daemon.sh "$DAEMON_ENV"

host_happy --version
host_happy daemon status
host_happy daemon list
```

Verify a new daemon PID/start time and compare the pre/post session IDs, not
just their counts. Resume at least one retained historical session and prove it
accepts the next turn when the release touches session or recovery behavior.

On macOS, use the command surface that owns the existing installation. For the
manifest/digest-verified public HappyHerd launcher channel, run the pre-restart
read-backs and `happyherd daemon stop` as the logged-in owner of the existing
Happy home. `happyherd upgrade --manifest <release-manifest-url>` verifies and
reports the applicable installer URL and expected digest; it does not install
it, so run the reported installer through the
[documented release process](../../docs/public-launcher-release.md). Then run
`happyherd daemon start`, `happyherd daemon status`, and `happyherd daemon list`
as that same user. A standalone Happy installation instead uses its own package
channel and `happy daemon ...` commands. Do not run
`scripts/install-host-cli.sh`, the Linux bootstrap, or Linux root commands on
the Mac. When both components are being updated, the central server deployment
and health proof still happen first.

## 5. Refresh the website and verify the machine record

After the daemon is healthy, fully reload the HappyHerd website. Verify all of
the following from the refreshed client:

- the existing machine has its expected display name or hostname and is online;
- its normal workspace paths remain present;
- its provider/model/effort/permission catalogs are available as expected; and
- retained sessions remain attached to the same machine and can continue.

When account-wide machine control is already linked, the current installation's
machine command (`happy machine list --json`, or launcher-forwarded `happyherd
machine list --json`) provides an additional encrypted API read-back. It is not
a substitute for checking the user-visible website state. Do not initiate
account-control linking or require a QR code as part of post-update acceptance;
daemon pairing and account-wide machine control are separate concerns.

### If the website shows `unknown machine`

Do not treat online presence as proof that metadata is valid. The Web client
decrypts machine metadata and then requires `host`, `platform`, `happyCliVersion`,
`happyHomeDir`, and `homeDir`; a payload missing any required field becomes
`null` and the route falls back to `unknown machine`. Current native daemon
metadata also carries `happyLibDir` and capability fields.

1. Fully reload the website once and re-run daemon status/list read-backs.
2. Do not rename or delete the machine, run `happy doctor clean`, replace the
   Happy home, or create a new machine ID.
3. If the machine is online but metadata remains invalid, treat activation as
   failed and escalate with the preserved machine ID and metadata version. Do
   not attempt a raw database edit. A maintainer repair must use the existing
   authenticated, versioned `machine-update-metadata` compare-and-swap owner,
   merge from the latest encrypted payload, restore the complete required
   fields, and preserve the machine ID; then restart the daemon and read back
   again.

The current repository has app and daemon API owners for that versioned update
but no public operator recovery command. Until one exists, this is a
maintainer-assisted repair, not permission to edit runtime databases or invent
an ad-hoc migration.

## 6. Retain the acceptance evidence

Record the following in the owning task, incident, or deployment handoff:

- operator-selected server tag, running image ID/revision, and the image
  workflow run when one produced the selected artifact;
- CLI source SHA or installer version for each daemon host;
- server service start timestamp plus local and public health success;
- daemon host/account, old and new CLI version, and new daemon PID/start time;
- pre/post session IDs and one successful historical-session continuation;
- refreshed website machine name, online state, paths, and provider catalogs;
- any rollback or metadata repair, including the preserved machine ID and
  metadata version read-back.
