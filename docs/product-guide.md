# HappyHerd product guide

<!-- rename:preserve -->
HappyHerd is a maintained distribution of [Happy](https://github.com/slopus/happy).
Start at the [quickstart](first-run.md) and use
[HappyHerd's release page](https://github.com/NickGuAI/HappyHerd/releases) for
its downloads. Happy's app-store listings and hosted services belong to upstream.
<!-- /rename:preserve -->

## Pick the right documentation

- **Installing a public release:** follow the [installer guide](public-launcher-release.md)
  and the notes for the exact release you choose.
- **Organizing ongoing work:** the [Projects and Assistant guide](projects-and-assistant.md)
  describes current source, including Commander and persistent-session behavior.
- **Running your own server:** use the [deployment guide](deployment.md).
- **Building native clients:** use [native build instructions](native-app-builds.md);
  a successful build is separate from a signed, published application.
- **Contributing:** use the [contribution guide](../server/docs/CONTRIBUTING.md)
  and [development index](../.dev/AGENTS.md).

## What is released, and what is only in source?

As checked October 7, 2026, [1.2.4](https://github.com/NickGuAI/HappyHerd/releases/tag/happyherd-v1.2.4)
is the latest stable installer release. Its four archives target macOS/Linux
arm64/x64 and include the CLI, self-host server, and Web app. The bundled CLI is
version 1.2.3. The release records source revision
[`189c504`](https://github.com/NickGuAI/HappyHerd/tree/189c504b5ab16eea7fa16e3c2fb33e98d147390d).
Read its release notes for the supported behavior and explicit limitations,
including unfinished native question and restored-plan work.

The `main` branch and its guides describe newer source. The
[product changelog](../server/packages/happyherd-app/CHANGELOG.md) records source
changes, not proof that a corresponding download has shipped. For example,
the current first-machine setup, shared Commander guidance, and later session
reconnection repairs must not be inferred from the 1.2.4 version number.
The installer script fetched from `main` can be newer than the archive it selects.

<!-- rename:preserve -->
No native HappyHerd graphical macOS, iOS, Android, or Windows download is
established by that release. Upstream Happy downloads cannot fill that gap.
The Web client is served by a configured HappyHerd server; localhost is reachable
only on that same computer, not automatically from a phone or another machine.
<!-- /rename:preserve -->

## Launch work and media

The [launch overview (#387)](https://github.com/NickGuAI/HappyHerd/issues/387)
tracks the remaining work. Documentation corrections here do not complete
[first-run onboarding (#378)](https://github.com/NickGuAI/HappyHerd/issues/378)
or [release verification (#383)](https://github.com/NickGuAI/HappyHerd/issues/383).

The dedicated Claude/Opus media tasks
[#384](https://github.com/NickGuAI/HappyHerd/issues/384),
[#385](https://github.com/NickGuAI/HappyHerd/issues/385), and
[#386](https://github.com/NickGuAI/HappyHerd/issues/386)
own creation, selection, editing, and final embedding of product media.
This guide makes no claim that those assets are complete.

## Ownership and help

<!-- rename:preserve -->
Happy supplies the inherited client/synchronization foundation; HappyHerd owns
its maintained changes and release packaging. The [lineage record](lineage.md)
and [owned-patch ledger](owned-patches.tsv) make that distinction reviewable.
Use [HappyHerd issues](https://github.com/NickGuAI/HappyHerd/issues) for this
distribution, and clearly identify the release or source commit you are using.

<!-- /rename:preserve -->