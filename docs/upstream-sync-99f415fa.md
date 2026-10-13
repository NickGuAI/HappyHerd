# Upstream integration: `99f415fa`

The non-squashed subtree merge `d4eeada9a2f031347f4d4e73d16c1998b1991c12`
integrates the approved upstream commit `99f415fa0d12d233a80a77fd88122bfb19b17477`
under `server/`. It has exactly two parents: HappyHerd main
`31b13966c3b999a61d4d105b0a0887bf7d5bb91c`, followed by the pinned upstream
commit. The merge subject is `Merge commit '99f415fa0d12d233a80a77fd88122bfb19b17477'`.

The actual pinned subtree merge recorded 99 unique conflict paths. A separate
no-argument rehearsal followed live upstream main at `49acf3fe`; that newer
head was not approved or merged. Resolution adapted upstream changes to the
maintained HappyHerd package layout and preserved the
existing public identity `@happyherd/cli`, the `happyherd` executable, and the
`server/packages/happyherd-cli` implementation. It did not restore the legacy
`happy` wrapper or duplicate app and CLI package trees.

The integration carries the accepted Android submission profiles as draft or
internal tracks where appropriate, the scrollable composer choice sheet,
multiline iOS input, cancellable native alerts, scoped machine session
subscribe/unsubscribe protocol handler, offline message-handler restoration,
the virtualized-list frame offset patch, and the relocated development-environment
package. The Claude SDK minimum and privacy disclosure were updated to match
supported runtime behavior. The session subscription handler enforces account
authorization and machine scope; no CLI transport migration is part of this
integration.

Claude compatibility uses the existing provider metadata owner to publish the
native 1M context window for Opus 5.5, Opus 5, and Sonnet 5.5. The SDK floor is
`^0.3.295`, which supports the later Haiku 5.5 metadata when supplied by the
runtime. Model choices and defaults stay
unchanged. The legacy upstream pricing module was not imported;
`providerUsage.ts` remains the provider-reported cost source.

HappyHerd-owned product decisions remain in force: the upstream message
analytics expansion and provider-account hashing were rejected, while the
current analytics implementation remains in place; existing Claude defaults and selectors;
whole-turn reply copying; current onboarding, support, terms, release, and
distribution identity; the existing experiments gate and machine catalog; and
draft persistence. The merge also adds the October 13 user-facing release note
in English, Simplified Chinese, and German, regenerates the changelog JSON,
locale types, and UI surface inventory, and verifies the added release entry.

Focused app, CLI, socket, wire, development-environment, and virtualized-list
checks are recorded with the reviewed delivery for this integration.
