# First computer onboarding (#379)

The change replaces the unpublished npm instruction in the production empty
session list with the root README's public macOS/Linux installer. It displays
the app's current server, terminal authorization with the existing account,
and daemon startup followed by the existing New Chat action. Pairing and
account ownership mechanisms are unchanged. Installer compatibility remains
[#371](https://github.com/NickGuAI/HappyHerd/issues/371), not part of this patch.

## Journey and proof boundary

A signed-in person with no machines or sessions opens the phone home, reads
and selects the install command, chooses the displayed server on their
computer, and authorizes the terminal through the visible manual-URL action
(or the existing native camera action). After daemon registration, the empty
state exposes New Chat. Instructions have no persisted state; canceling the
URL dialog does not authorize a terminal. Existing online/offline and archive
actions remain covered.

The browser regression renders production `PhoneHome` → `SidebarView` →
`SessionsListWrapper` → `EmptyMainScreen`, with synthetic empty-account state.
Web and Android-branch manual entry render the production modal and input.
iOS uses an explicit prompt adapter; camera and encrypted authorization are
bounded adapters. This proves shared production phone rendering and visible
interaction, **not** an authenticated native-device, native camera, or live
app pairing journey. The terminal/API integration below is separate proof.
Desktop receives the same shared empty state where used; no desktop shell,
macOS-native shell or Windows distribution change is claimed.

Run the focused rendered suite from `server/`:

```sh
NODE_ENV=test HAPPYHERD_KILV_SCREENSHOTS=/tmp/first-run-captures \
  pnpm --filter happyherd-app exec vitest run \
  sources/components/EmptyMainScreen.browser.test.ts
```

## Exact public installation: failed, dependency retained

On 2026-10-02, Darwin arm64, a disposable fresh home with a system-only PATH
ran this exact displayed command:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The public main script matched source `2ad0a066559c18de86383cbc2d70201486b1d485`
byte for byte (SHA-256
`188fb5cd881c9ca6b35dc07207abf281eefc252adaf01aded0dacc97c5047e77`).
The 416 MB latest stable `happyherd-v1.2.4` download completed. Installation
exited **1**, without installing a command, with the actual error:

```text
error: prepared release has no HappyHerd command
```

The stable asset retains pre-rename executable and server package paths;
main expects the renamed paths. This is the precise #371 / PR #376 compatibility
boundary. **The public installation journey has not passed.** Raw output is
retained locally; no runtime logs, accounts, or credentials are committed.

## Prepared dependency proof: passed

Without modifying this branch's installer, the independent lane fetched the
unchanged, reviewed PR #376 installer at
`54c25ddd97d709948f3f3ba7d6981cc38209e9e6` (script SHA-256
`5f0b83f08e3eb7c39d878de4f6031f034b86de253b512de95ace7243e6ca9a63`).
It installed the actual published `happyherd-darwin-arm64.tar.gz`; SHA-256
`18f623f2bd913574026685eca8eac62f2e25929ee341c3c5a59ee45982cfa5c5`
matched GitHub release metadata. The asset reports CLI version 1.2.3 despite
its release tag 1.2.4.

In a fresh disposable home, the prepared command was:

```sh
sh "$PR376_INSTALLER" --asset "$STABLE_DARWIN_ARM64_ASSET" \
  --server http://127.0.0.1:43791
```

Installation exited 0 and printed the selected server plus
`happyherd auth login && happyherd daemon start`. The installed server ran on
that unused loopback port. The unchanged
`scripts/test-native-installer-auth.mjs` from source `2ad0a066` ran using the
bundled Node, installed asset, disposable home, server URL, and that exact
installer command as its rerun arguments. It exited 0 and reported:

```text
native-installer-auth: v2 CLI pairing passed
native-installer-auth: registered machine online and encrypted RPC usable
native-installer-auth: rerun retained account, machine key, session and history; next message persisted
```

The harness approved pairing through the ordinary API with disposable test
state. The daemon and server were stopped, uninstall succeeded, health became
unreachable, and runtime credentials/state were removed. This verifies only
Darwin arm64 terminal/API behavior, not other installer targets or a provider
turn. No shared service or account was changed.
