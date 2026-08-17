# HappyHerd

HappyHerd is a maintained distribution of
[Happy](https://github.com/slopus/happy). It preserves Happy's complete upstream
history under `server/` and layers independently reviewable product,
governance, release, and agent-runtime contracts on top.

Repository ownership, deployment domains, infrastructure identifiers, operator
paths, and organization-specific integrations are configuration—not generic
source code. A public-boundary gate checks that invariant before changes ship.

## Repository layout

- `server/` — full-history Happy subtree plus HappyHerd-owned runtime changes.
- `branding/` — HappyHerd-owned brand assets.
- `deploy/` — generic, secret-free deployment templates.
- `examples/` — explicitly named organization integrations.
- `docs/` — lineage, build provenance, release, and rollback contracts.
- `scripts/` — reproducible verification, upstream-sync, and deployment tools.

## Install and connect

Tagged `happyherd-v*` releases contain native-platform archives, `SHA256SUMS`,
a source-SHA release manifest, and installers for macOS, Windows, and Linux.
From this repository's Releases page, download and inspect `install.sh` from
the current beta release. Run it as your normal local account on macOS or
Linux:

```sh
sh ./install.sh
```

On Windows, download and inspect `install.ps1` from the same release. Open
PowerShell as your normal local account (not an Administrator) and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PWD\install.ps1"
```

The installer requests sudo or Windows UAC only for its isolated local service.
Linux automatically installs `acl`, `dbus-daemon`, and `gnome-keyring` through
apt, dnf, or yum when they are absent. Windows requires a registered local user
profile; all platforms require an internet connection for online installation.
Node.js and Python are bundled.

Open a new terminal if the launcher was not already on `PATH`, then verify and
connect:

```text
happyherd doctor
happyherd connect https://issuer.example --no-open --json
happyherd install-skills --issuer https://issuer.example
happyherd launch claude
happyherd launch codex
```

The JSON connection mode writes newline-delimited approval, progress, and final
receipt records. Its first approval record contains `verificationUri` and
`userCode`; the final receipt contains issuer, expiry, scopes, and Skill-bundle
availability, never the bearer credential. Omit `--json` for human-readable
output and omit `--no-open` to open the approval page automatically.

`install-skills` atomically publishes each verified Skill into both local
Claude and Codex discovery roots. HappyHerd ownership receipts prevent it from
replacing a user-managed Skill with the same name. A stale managed copy makes
`doctor` and `launch` fail until the verified bundle is repaired.

Web-only chat sandboxes cannot execute these host-local Skill files or reach an
issuer that is outside their network allowlist. Run Claude or Codex through the
local HappyHerd launcher when a Skill needs scripts or governed API access.
Tools obtain a credential only through a bounded child process:

```text
happyherd run-tool --issuer https://issuer.example \
  --skill generic-guide --script scripts/check.py -- --read
```

The access token is read from the OS secret store and enters only the verified
tool child's `HAPPYHERD_ACCESS_TOKEN`; it is absent from agent sessions,
arguments, provider registries, and receipts.

To disconnect one organization or clear every local issuer connection:

```text
happyherd disconnect https://issuer.example
happyherd disconnect --all
```

To remove the native installation and its managed Skills, use the installed
uninstaller from the employee account. It requests elevation only for the
protected service and system-owned files:

```text
Linux: sh /opt/happyherd/$(id -u)/uninstall.sh
macOS: sh "/Library/Application Support/HappyHerd/$(id -u)/uninstall.sh"
```

```powershell
$HappyHerdCommand = (Get-Command happyherd.cmd -CommandType Application -ErrorAction Stop).Source
& (Join-Path (Split-Path -Parent $HappyHerdCommand) 'uninstall.ps1')
```

The issuer is discovered through `/.well-known/happyherd.json`. Long-lived
issuer credentials stay in the operating system secret store and are never
passed to an agent session. See [docs/issuer-protocol.md](docs/issuer-protocol.md)
for the wire contract and
[docs/public-launcher-release.md](docs/public-launcher-release.md) for release
and installer verification.

See [docs/runtime-isolation.md](docs/runtime-isolation.md) for deployment
boundaries and [docs/lineage.md](docs/lineage.md) for upstream provenance.
