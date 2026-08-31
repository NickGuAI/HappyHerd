# Simple local installer

HappyHerd's first installation phase is a user-owned local CLI bootstrap. It
installs the public `@happyherd/cli` package and the runtime needed by the
existing Happy server and daemon. The native Orca-style macOS app is a
follow-up phase and is not required for this installer.

## Install

Run this as the normal user on macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The installer does not require a release manifest, checksum file, source
receipt, issuer connection, privileged broker, credential vault, or exported
server URL. `happyherd` is the package's sole primary command. The installer
preserves unrelated `happy` commands and removes only the exact launcher it
previously managed under that name.

## Local-first setup

The local default starts the server and detached daemon. Inspect or restart
them with the HappyHerd command:

```sh
happyherd daemon status
happyherd server --no-persist
```

The first run asks for a server endpoint. Press Enter to use the local default,
`http://127.0.0.1:3005`, or enter a remote URL explicitly. Happy persists the
selection in its normal settings, so later commands do not need
`HAPPY_SERVER_URL` or `HAPPY_WEBAPP_URL` exports.

The daemon is the existing per-user Happy daemon. It stays running after the
terminal closes and retains upstream Happy authentication, encrypted sessions,
provider login, and session state.

## Upgrade and cleanup

Rerun the same bootstrap command to upgrade; it keeps the current server choice
unless a different `--server` value is supplied. To remove a retired privileged
#98 installation, run the separately bounded cleanup copied by the installer:

```sh
sudo "$HOME/.local/share/happyherd/cleanup-legacy.sh"
```

To remove only the current program files:

```sh
"$HOME/.local/share/happyherd/uninstall.sh"
```

Both paths preserve the user's normal `~/.happyherd` state, Happy sessions,
server selection, provider homes, and user-managed Skills.

There is no separate HappyHerd launcher release workflow or platform payload.
The bootstrap downloads the repository source and builds the normal runtime in
the user's home. It does not reintroduce a release manifest, `SHA256SUMS`,
source-SHA receipt, digest gate, broker, vault, helper, issuer, verified-Skill
registry, or rollback controller.

## Server and source options

Choose a remote server without an environment export:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | \
  sh -s -- --server https://happy.example.com
```

Build an existing checkout instead of downloading `main`:

```sh
./install.sh --source .
```
