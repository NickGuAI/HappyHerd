# Public launcher releases

HappyHerd's end-user launcher uses the independent tag namespace
`happyherd-v<version>`. This is separate from upstream-compatible `cli-*`,
native, web, server, and governed-agent releases.

For launcher version `1.2.1-beta.1`, a tagged workflow publishes exactly:

```text
happyherd-v1.2.1-beta.1-darwin-arm64.tar.gz
happyherd-v1.2.1-beta.1-darwin-x64.tar.gz
happyherd-v1.2.1-beta.1-linux-arm64.tar.gz
happyherd-v1.2.1-beta.1-linux-x64.tar.gz
happyherd-v1.2.1-beta.1-win32-x64.zip
install.sh
install.ps1
release-manifest.json
SHA256SUMS
```

This version is a beta. Its GitHub release is created with prerelease metadata,
so it is not presented as the stable/latest release. The deployed v1 manifest
schema remains exactly `schemaVersion`, `product`, `version`, `sourceSha`,
`publishedAt`, `assets`, and `installers`; beta status is carried by the SemVer
suffix and GitHub release metadata, not a new manifest field.

The five archives are built on matching native GitHub-hosted runners so each
contains the correct operating-system credential-store adapter. Every archive
contains `happyherd/release.json` with its version, target, and exact 40-byte
Git source SHA. The outer release manifest repeats that provenance and carries
the filename, format, byte count, and SHA-256 for every target.

## Workflow

`.github/workflows/public-launcher-release.yml` runs manually as a complete
build rehearsal and automatically for `happyherd-v*` tags. A tag must exactly
match the version in `server/packages/happyherd-cli/package.json`. Native jobs
build the maintained Happy runtime, build the launcher, and create a locked
production deployment. Each native runner executes the staged launcher's
version and `doctor` commands before it can upload an asset. The metadata job requires all five targets, verifies
their bytes and embedded receipts, then renders both installers and
`SHA256SUMS`. Only the final tag job receives `contents: write` and publishes the
already verified artifacts.

## Installer boundary

Both installers include their own Node.js and Python runtimes; the target does
not need host Node.js or Python. They select only their exact OS/CPU asset,
verify its installer-baked filename, SHA-256, byte count, source SHA, manifest
identity, archive paths, and embedded source receipt, then swap the fixed
target-specific installation directory.
The previous installation remains recoverable until the verified new directory
has passed launcher-link publication, receipt writing, and `happyherd doctor`.
Any final failure restores the recognized prior installation.

The normal no-argument installer downloads the canonical release. A caller
that already holds a release-lock may use only the following offline interface:

```text
sh /absolute/install.sh \
  --local-manifest /absolute/release-manifest.json \
  --local-asset /absolute/happyherd-v1.2.1-beta.1-linux-x64.tar.gz

& C:\absolute\install.ps1 `
  -LocalManifest C:\absolute\release-manifest.json `
  -LocalAsset C:\absolute\happyherd-v1.2.1-beta.1-win32-x64.zip
```

Use the archive matching the current canonical target: `darwin-arm64`,
`darwin-x64`, `linux-arm64`, `linux-x64`, or `win32-x64`. Both paths must be
absolute regular files with the baked filenames. There is no environment
override, fallback, or custom install root. Inputs are copied into an
administrator-protected staging directory before the pinned checks and archive
extraction run.

Installed launchers and uninstallers are fixed by platform:

```text
Linux launcher:   $HOME/.local/bin/happyherd
Linux uninstall:  sh /opt/happyherd/$(id -u)/uninstall.sh
macOS launcher:   $HOME/.local/bin/happyherd
macOS uninstall:  sh "/Library/Application Support/HappyHerd/$(id -u)/uninstall.sh"
Windows launcher: %ProgramFiles%\HappyHerd\<ownerKey>\happyherd.cmd
Windows uninstall: & "$InstallRoot\uninstall.ps1"
```

Linux keeps issuer tokens in an isolated Secret Service session, macOS uses a
dedicated service Keychain whose master is sealed to the protected helper, and
Windows uses the broker service identity's Credential Manager. The client
capability file is administrator-owned and explicitly readable only by the
target employee (plus Windows SYSTEM/Administrators). A second local user is
denied both raw reads and broker calls in every native lifecycle test.

`happyherd upgrade --manifest <url>` checks the same manifest and reports the
verified platform installer and expected digest. It does not silently replace a
running agent session.
