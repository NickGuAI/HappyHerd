# Native installer and release assets

HappyHerd installs from a prepared macOS or Linux release asset. The installer
detects the platform, downloads the matching archive, extracts it into the
current user's home, saves the server choice, and starts the normal local host
when requested.

The Orca-style native macOS app remains a later phase. It is not part of this
installer.

## Install

Run the installer as a normal user:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The system needs `curl` and `tar`. It does not need Node.js, npm, pnpm, Bun,
compilers, `sudo`, or a temporary-directory workaround. The installer does not
download repository source or build packages on the user's machine.

It selects one of these assets:

- `happyherd-darwin-arm64.tar.gz`
- `happyherd-darwin-x64.tar.gz`
- `happyherd-linux-arm64.tar.gz`
- `happyherd-linux-x64.tar.gz`

Each archive contains the built `@happyherd/cli`, self-host server and Web app,
platform tools, and a bundled Node runtime. The installer puts program files in
`$HOME/.local/share/happyherd`, writes the `happyherd` command to
`$HOME/.local/bin`, and preserves any unrelated `happy` command.

The default command needs a stable GitHub Release that contains these four
assets. The first new stable tagged release must be published before that
latest-release download can succeed.

## Choose a local or remote server

On an interactive first run, the installer asks for a server endpoint. Press
Enter to use `http://127.0.0.1:3005`, or enter a remote URL. To set a remote URL
without a prompt, pass it directly:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | \
  sh -s -- --server https://happy.example.com
```

The choice is saved in `~/.happyherd/settings.json`. Users do not need to
export `HAPPY_SERVER_URL` or `HAPPY_WEBAPP_URL`.

The localhost choice starts the bundled self-host server and the ordinary
detached Happy daemon. On a fresh noninteractive install, authentication is
deferred and the installer prints the next command:

```sh
happyherd auth login && happyherd daemon start
```

## Upgrade without losing state

Run the same install command again to upgrade the program files. The installer
keeps the current server endpoint unless `--server` supplies another one. It
preserves normal `~/.happyherd` state, including accounts and sessions, as well
as provider homes and user-managed Skills.

## Select a version or prepared asset

Install a specific tagged version:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | \
  sh -s -- --version 1.2.3
```

This selects tag `happyherd-v1.2.3`. Without `--version`, the installer uses
the latest stable GitHub Release.

Release testing and offline staging can use an already prepared local file or
an HTTP URL:

```sh
./install.sh --asset ./happyherd-linux-x64.tar.gz --no-start
```

`--no-start` installs and configures the program files without starting the
server or daemon.

## Uninstall and legacy cleanup

Remove only the installed program files:

```sh
"$HOME/.local/share/happyherd/uninstall.sh"
```

This preserves settings, accounts, and session data in `~/.happyherd`.

A separate cleanup command removes obsolete root-owned issue #98 program
files from old installations:

```sh
sudo "$HOME/.local/share/happyherd/cleanup-legacy.sh"
```

The cleanup keeps the normal user configuration, provider homes, sessions,
settings, and user-managed Skills.

## Build and publish releases

`.github/workflows/native-installer-release.yml` owns the release matrix. It
builds each target on its matching GitHub-hosted macOS or Linux runner, then
tests the actual archive by checking CLI execution, remote server selection,
repeated upgrade preservation, localhost health, and uninstall preservation.

During this build, `scripts/build-native-installer-asset.sh` first resolves the
runner's build scratch directory to its physical path so macOS `/var` aliases
cannot split the deployment across `/var` and `/private/var`. Rather than using
pnpm legacy deploy, the packaging process on release runners prepares a
generated deployment lock and installs the frozen production dependency closure
in a hoisted layout before adding the already-built CLI, self-host server, Web
app, platform tools, and bundled Node runtime.

A manual workflow run builds and tests the four assets without publishing
them. Pushing a `happyherd-v*` tag attaches all four assets to the matching
GitHub Release. Prerelease tags remain prereleases, so the default installer
continues to select the latest stable release.

A local Linux build proves only the Linux architecture on which it ran. The
tagged matrix must pass to prove macOS and ARM delivery. The tagged publish job
and a download from the resulting GitHub Release are the evidence that the
public assets exist; source, local tests, and an untagged workflow run do not
prove publication.
