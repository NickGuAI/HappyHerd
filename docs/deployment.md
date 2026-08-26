# Component-native deployment

HappyHerd deploys the component that changed. There is no global release
bundle, cross-host Git-identity gate, activation symlink, generated deployment
receipt, or rollback controller.

The human-reviewed disposition of the removed and retained deployment
boundaries is recorded in
[deployment-guardrail-audit.md](deployment-guardrail-audit.md).

## Server and bundled Web

Build and optionally publish a normal GHCR tag:

```bash
scripts/build-server-image.sh \
  --image ghcr.io/example/happyherd:main \
  --push
```

The build uses a disposable HappyHerd builder and removes its cache when the
command finishes. The resulting image remains available for tagging or local
use.

Install the stable service support files once on a Linux server:

```bash
sudo scripts/install-server-service.sh /etc/happyherd/runtime.env
```

Each deployment is one command:

```bash
sudo scripts/deploy-server.sh \
  ghcr.io/example/happyherd:main \
  /etc/happyherd/runtime.env
```

The command pulls the selected image, restarts `happyherd.service`, and checks
local and public `/health`. After both checks pass, it removes unused images
labeled as HappyHerd; Docker retains images referenced by any container and it
does not touch other projects or volumes. It does not build any other
component. To roll back, run the same command with an older published tag.

## Happy CLI and host daemon

Install or upgrade only the CLI package:

```bash
sudo scripts/install-host-cli.sh
```

On Linux, install the small boot adapter once:

```bash
sudo scripts/install-linux-daemon-bootstrap.sh \
  /etc/happyherd/daemon.env \
  ec2-user
```

The adapter invokes `/usr/local/bin/happy daemon start`. The CLI owns the
native daemon lifecycle; systemd does not own the daemon or Claude/Codex
provider processes. A CLI upgrade therefore does not require a server image or
mobile build. Replace `ec2-user` with the real host account that owns the
HappyHerd home and provider credentials. When invoked through `sudo`, omitting
the second argument selects `SUDO_USER`; noninteractive root installs must pass
the account explicitly.

## Governed agent

When governed-agent source changes, build and install only that component:

```bash
sudo scripts/install-agent-runtime.sh
```

This lane expects the Happy CLI to be installed independently. Follow
[runtime-isolation.md](runtime-isolation.md) for its operator configuration and
credential boundaries.

## Mobile and public launcher

Mobile artifacts are produced only from mobile changes through the mobile
project's native release process. The tagged public launcher and its five
platform integrity matrix remain documented in
[public-launcher-release.md](public-launcher-release.md); that end-user channel
is not a self-host deployment coordinator.

## Verification ownership

Run `scripts/test-component-deployment-contract.sh` for deployment-shell
changes. Then run the tests belonging to the component that changed. The full
repository contract suite remains an integration gate, but it does not create
or activate a lockstep release.
