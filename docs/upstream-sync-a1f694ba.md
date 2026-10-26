# Approved upstream sync through `a1f694ba`

```text
HappyHerd main 6c2aa135d ──┐
                           ├─ non-squashed history merge → owned adaptations
Happy upstream a1f694ba ───┘                                  │
                                                              ├─ hosted voice accounting
                                                              ├─ current voice tool guide
                                                              └─ Node 24 server baseline

Deferred UIKit / Kotlin clients and native release paths → excluded
```

[Issue #441](https://github.com/NickGuAI/HappyHerd/issues/441) records the
maintainer's explicit approval for this pinned upstream target and its three
adaptations. Newer upstream commits are outside this integration.

## Frozen history and conflict resolution

- Distribution baseline: `6c2aa135d4a8816cf5df2c0857efcf7a97e53086`.
- Previous integrated upstream: `fda37d23fa044bb03093a62bdb48a1d5689790c9`.
- Approved upstream target: `a1f694ba3e4e652838b602eacd3b107619024dc2`.
- Structural merge: `6352fabf25312cace3cd913a257d862d13fe15ae`.
- Merge parents, in order: the distribution baseline and the approved upstream target.
- Merge subject: `Merge commit 'a1f694ba3e4e652838b602eacd3b107619024dc2'`.

The approved range contains 672 commits and 1,969 changed files (1,680 added,
289 modified). The pinned subtree merge produced 284 conflicts: 274
modify/delete conflicts (213 UIKit, 49 Kotlin Android, 11 retired TypeScript
catalogs, and one iOS workflow), five content conflicts, and five path-location
conflicts. The latter were four shared fonts and the relocated voice-route
test. Raw conflict output and the complete unmerged index were retained for
review before resolution.

The structural merge preserves the distribution baseline tree byte for byte.
It records full upstream ancestry while excluding the deferred clients, retired
catalogs, and native-only workflow changes. The separate owned adaptation
commit applies only the approved changes in the existing HappyHerd paths. This
also preserves the owned release skill, package identities, Bun build stages,
root workflow ownership, current Expo client, and existing voice transcription
and local voice paths.

## Resulting behavior

Hosted voice queries the last 30 days with `call_start_after_unix` in Unix
seconds and follows provider cursors across every page. Conversation count no
longer gates access. The 20-minute free allowance and five-hour hard cap stay
in place. Free users do not need RevenueCat configuration; subscribed access
above the free allowance still requires an active entitlement.

History failures, partial-page failures, invalid/repeated cursors, malformed
durations, and the shared 15-second history timeout return an error before a
voice token can be issued. Reading may stop once the hard duration cap is
reached; totals above that point are lower bounds. The legacy numeric
`conversationLimit` response field stays for shipped clients, while current
Expo Settings displays the conversation count without a quota bar or maximum.

The en/cn/de custom-agent instructions and architecture guide now match
`sendMessageToSession(sessionId, message)` and
`processPermissionRequest(requestId, decision)`. No tool runtime changes are
needed.

Server Docker build/runtime images, the active root quality/contract workflows,
server Node declarations, and ES library baseline move to Node 24/ES2022. The
lockfile is regenerated with pnpm 10.11.0. The CLI still declares Node >=20,
and the production workflow executes the built CLI under Node 20 after its
Node 24 build. No inactive upstream workflow is promoted to root CI.

## Preparation evidence

- Pinned merge: exact two-parent topology and subject; final structural tree
  equals its distribution parent.
- Focused hosted voice and existing transcription routes: 34 tests passed,
  including timeout rejection before token issuance on the first and later pages.
- Focused app voice settings/dictation: 14 tests passed; a count of 103 is
  displayed without a destructive count-limit state.
- Server typecheck and source lint: passed.
- Frozen installation: passed with pnpm 10.11.0 on Node 24.5.0.
- Localization: 1,736 en/cn/de keys, 45 routes, 349 surfaces and 84 smoke cases
  validated; inventory regenerated.
- Changelog parser: 201 entries; latest title is
  “October 26 — Accurate hosted voice allowances”.

The full contract suite, production export/smoke, built CLI Node 20 execution,
required PR checks, independent review, post-main workflows, and cleanup are
separate acceptance steps recorded by the owning issue and PR. This report
does not claim a release, deployment, installation, or daemon restart.

## Proposal automation

The read-only preparation check found the existing
`happyherd-upstream-merge-proposal` automation active with timezone `Etc/UTC`
and schedule `17 9 * * *`. Its latest run completed on 2026-10-26 at
09:31 UTC. The automation was not changed.
