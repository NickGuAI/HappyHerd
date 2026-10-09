# Native installer and release assets

For the user entry point, see the [quickstart](first-run.md) and
[product guide](product-guide.md). As checked October 8, 2026, the latest stable
release is [1.2.4](https://github.com/NickGuAI/HappyHerd/releases/tag/happyherd-v1.2.4),
with four macOS/Linux arm64/x64 CLI/server/Web archives and bundled CLI 1.2.3.
The installer source can be newer than the archive it downloads.

HappyHerd installs from a prepared macOS or Linux release asset. The installer
detects the platform, downloads the matching archive, extracts it into the
current user's home, saves the server choice, and starts the normal local host
when requested.

The native macOS GUI and iOS app have separate
[build and distribution instructions](native-app-builds.md). They are not part
of this CLI/server installer.

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
`$HOME/.local/bin`, and preserves any unrelated `happyherd` command.

The default command needs a stable GitHub Release that contains these four
assets. The current installer accepts both the pre-rename stable archive (including
`happyherd-v1.2.4`) and the current archive layout. It selects the matching
internal CLI entry and self-host package together, rejecting mixed or incomplete
layouts before stopping the installed runtime. The public command remains
`happyherd`; release payloads and their internal dependency names stay unchanged.
A failed staged validation leaves the prior installation in place; this is not
a transaction that rolls back failures after replacement begins.

## Choose a local or remote server

On an interactive first run, the installer asks for a server endpoint. Press
Enter to use `http://127.0.0.1:3005`, or enter a remote URL. To set a remote URL
without a prompt, pass it directly:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | \
  sh -s -- --server https://happy.example.com
```

The choice is saved in `~/.happyherd/settings.json`. Users do not need to
export `HAPPYHERD_SERVER_URL` or `HAPPYHERD_WEBAPP_URL`.

The localhost choice starts the bundled self-host server and the ordinary
detached HappyHerd daemon. On a fresh noninteractive install, authentication is
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

Pull requests and manual workflow runs build and test the four assets without publishing
them. Pushing a `happyherd-v*` tag attaches all four assets to the matching
GitHub Release. Prerelease tags remain prereleases, so the default installer
continues to select the latest stable release.

A local Linux build proves only the Linux architecture on which it ran. The
four-target build/smoke matrix must pass on the reviewed head to prove macOS and ARM builds and installation. The tagged publish job
and a download from the resulting GitHub Release are the evidence that the
public assets exist; source, local tests, and an untagged workflow run do not
prove publication.

The HappyHerd native installer workflow now verifies real CLI authentication over PTY, daemon connectivity, and encrypted read-only machine RPC operations. It registers disposable account keys in memory to establish and verify an encrypted, server-persisted session history that persists across installer reruns. Setting the manual `verify_published` input to `true` on `workflow_dispatch` skips local compilation entirely to fetch and run the latest live public script (`curl ... | sh`) on macOS/Linux arm64/x64 runners to check the published install path.

Pull requests also exercise the candidate installer against the actual latest
stable download on all four native targets, in disposable homes without
starting services. This checks the README shell pipeline with the candidate
script, installed version, repeat installation, server selection, and uninstall.
It records the downloaded archive digest and source revision separately from
the newly built archive matrix. The public `main/install.sh` URL cannot serve
the candidate until merge: `verify_published` intentionally downloads that live
URL and remains post-merge proof. No release publication is needed to repair
the existing stable download; publishing replacement assets is a separate act.

## 1.2.5 release candidate plan

Proposed installer tag: `happyherd-v1.2.5`; current source CLI: `1.2.5`.
This is a candidate, not an available release. The reviewed source baseline is
`3a3773303a5539f6c9deddbd04197b92cbab9a76`; the release revision must be the
subsequent exact reviewed `main` commit incorporating the #383 PR. Record that
SHA after separately authorized merge and final checks, before requesting tag
publication. Do not tag the baseline or describe the PR's CI artifacts as public
downloads. Re-evaluate the candidate if main or the promised features change.

The release scope is the existing four CLI/server/Web archives only. The
[README availability table](../README.md#downloads-and-platform-availability)
remains pinned to the actually published stable release until publication and
public-download verification are complete. Native graphical macOS and iOS remain
unavailable through this release; #369/#375 own their applicable native proof.

The current source includes Projects/Assistant/Commander changes, durable
side-chat lifecycle, and later first-machine setup and provider-continuation
repairs beyond stable 1.2.4. These are candidate source capabilities, not a claim
that a customer installing 1.2.4 receives them. The [product guide](product-guide.md)
and [Projects and Assistant guide](projects-and-assistant.md) describe that source
boundary. #382 owns claims; #378 owns the actual public-artifact first-task and
same-conversation journey; #384/#385/#386 own release-matching launch media.

### Candidate identity and proof

New archives retain `runtime/build-info.json` after installation at
`~/.local/share/happyherd/runtime/build-info.json`. It records the checked-out
Git revision, target, actual staged CLI/server package versions and bundled Node
version. It is descriptive data, not an installer admission rule; historical
archives without it remain supported. The build and prepared-install logs print
this identity and the CLI's version output. PR builds use the exact PR head.

For a new tagged release, the existing workflow reads this data from all four
built archives and prepends a download/version/channel table to GitHub's generated
notes. Existing release reruns refresh assets but preserve their curated notes;
a maintainer must review any note correction separately. No tag-to-package-version
equality is assumed (stable tag 1.2.4 contains CLI 1.2.3).

| Step | Required evidence | Current status |
| --- | --- | --- |
| Review candidate source | Exact PR head, focused metadata/archive regression, independent review, all applicable Quality/Contracts/image/native installer CI | To be recorded on the #383 PR; passing builds are not publication |
| Select release revision | Authorized merge, freshly fetched clean main, exact SHA and final main checks; verify included claims/dependency decisions | Pending; merge is not authorized by this task |
| Publish existing channels | Separate approval naming `happyherd-v1.2.5`, exact SHA, four assets and stable status; existing tagged workflow produces release and identity notes | Unperformed; tag/release/package publication not authorized |
| Verify public installer | Exact README command resolves new stable tag on macOS/Linux arm64/x64; retain archive identity/digest, installed version and source revision | Pending new public artifacts; existing stable CI exercises 1.2.4 |
| Verify documented first task | #378's account/terminal authorization, real provider result and retained conversation on the selected public artifact | External dependency; do not duplicate the account journey |
| Align claims and media | #382 claims plus #378 quickstart and #384/#385/#386 media identify that same publicly obtainable release | Pending; build screenshots are not launch media |

After publication, the existing `verify_published` workflow is the four-platform
public-script/install/auth/RPC proof, subject to separate approval for its actual
runtime/account effects. It does not prove #378's real-provider first task.
Only then update the README's stable release rows and record release-specific
journey evidence. Keep #383 and its PR draft while publication or original live
acceptance remains unmet. No release, install, service restart or deployment is
implied by preparing this plan.
