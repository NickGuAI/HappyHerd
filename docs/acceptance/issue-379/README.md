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

## Rendered acceptance matrix

The 61-case suite includes the 54 combinations of en/cn/de, Web/iOS/Android
branches, light/dark, and 320/360/390 × 400, plus the existing seven
scroll/archive/online/offline cases. It checks selectable, byte-faithful
commands against README, the displayed server, keyboard Tab/Enter,
cancel-without-authorization, URL submission, the Web input's 16 px font,
no horizontal overflow, and final discovery text above the native dock.
Screenshots below were captured from implementation revision
`3859bb6cb23d85141c41f2f9bbedc21bb6de3e31`; subsequent fixture teardown and
baseline updates do not change the rendered production component.

| Surface and representative viewport | Install | Manual entry / next action | Final daemon/discovery step |
| --- | --- | --- | --- |
| Web Mobile, English, light, 320 × 400 | [Command](first-run-en-web-light-320x400-install.png) | [Real prompt](first-run-en-web-light-320x400-prompt.png) | [Discovery](first-run-en-web-light-320x400-daemon.png) |
| Shared iOS phone branch, German, dark, 360 × 400 | [Command](first-run-de-ios-dark-360x400-install.png) | [Native actions](first-run-de-ios-dark-360x400-action.png) | [Dock clearance](first-run-de-ios-dark-360x400-daemon.png) |
| Web Mobile, Chinese, light, 320 × 400 | [Command](first-run-cn-web-light-320x400-install.png) | [Real prompt](first-run-cn-web-light-320x400-prompt.png) | Covered in the same automated matrix |

These are source-owned rendered fixtures with synthetic account state, icon
adapters and a dock footprint, not screenshots of a deployed/authenticated
account. Physical iPhone Safari zoom, native safe-area/camera/OS prompt
behavior and authenticated app-to-terminal pairing remain unperformed.

## Verification receipts and first failures

- Pinned pnpm 10.11.0 frozen installation completed without a lockfile change.
  Node 20.19.0 and Bun 1.3.11 were used locally.
- App typecheck, i18n/copy/inventory checks, source lint, production Web export
  and Web smoke passed. Production iOS export also assembled successfully.
- CLI build passed after building its control-agent dependency; server build
  passed. The initial CLI build's missing control-agent declarations were
  retained, not patched around.
- Locale generation reports 1680 keys; UI generation reports 45 routes,
  338 surfaces, 84 smoke cases. Changelog parsing reports 176 entries with
  newest title “October 2 — Connect your first computer”.
- Early fixture failures exposed directory alias resolution, missing locale
  selection and grouped viewport cases exceeding the existing per-test
  timeout. The fixture was corrected and viewports became individual cases;
  timeouts and assertions were not relaxed. A native 14 dp prompt was checked
  against its existing native contract while Web retains the 16 px assertion.
- Full capture and repeat runs on `3859bb6c` passed all 61 assertions but
  exceeded the unchanged 10-second teardown timeout. Fixture teardown now
  stops accepting connections, drains its own sockets and closes the browser
  concurrently. The corrected full 61-case run passed, including teardown.
  No product behavior, assertion, skip or timeout changed.
- Initial contract runs retained a historical-name prose failure (corrected
  in this acceptance note) and a macOS BSD `sed` incompatibility. The complete
  suite was rerun with GNU `sed`, without editing the contract scripts.
- The first CI visual comparison retained exactly four expected changelog
  mismatches out of 28 variants; the other 24 were pixel-identical. Baselines
  are refreshed using `pnpm --filter happyherd-app golden:update` from the
  completed exact-revision CI comparison, never by loosening the pixel test.
  The retained comparison is run `36993580991`, source `3859bb6c`; its
  production job completed the comparison before the superseded workflow was
  cancelled. The maintained script regenerated all 28 images, and only the
  four changelog images changed.

The first final-head CI unit run (`36994964047`, revision `74e9b227`) passed
4051 app tests but hit an existing focus fixture setup race: installing a
running clock and then pausing at its install timestamp can request a time
already in the past. A blank-page reproduction with a 250 ms protocol delay
failed with the exact CI error. Starting the clock at epoch zero before the
existing pause target passed the same reproduction and retained the exact
`Date.now() === 1800000000000` value before the app loads. This prerequisite
fixture repair changes no product behavior, assertions, timeouts or skips.
The separately reproduced macOS focus-render and Linux-only shortcut
assumptions remain outside this product change.

Final exact-head CI conclusions and independent review are recorded in
[PR #389](https://github.com/NickGuAI/HappyHerd/pull/389). This patch changes the
Web/shared-phone frontend only; no server or daemon runtime activation is
required to review it. Merge and deployment remain outside the authorization.
