# Reviewed upstream sync, September 6.

```text
╔════════════════════╗    ╔══════════════════════════════╗
║ upstream 9215aae6   ║ →  ║ server/ subtree + adaptations ║
╚════════════════════╝    ╚══════════════╦═══════════════╝
                                       ↓
                         tests → review → PR → main
```

## Integration & Baseline Analysis

The integration was pinned to the approved target 9215aae61859b7903f9c5e190e09c8e3e93fa721, incorporating 10 commits and 111 incoming paths from the previous integrated upstream b824cd0a4681d41af631a8e422a813873e4455b0. The local baseline was 5fa7b591453af495d29cbc5a27b2ac4ac52d4a9e. Although upstream advanced to 5795677c42f3da10e8b34c01e995f4c3ddc79be1, only the approved target was included. The integration contains a non-squashed subtree at server/ with two parents, where the upstream target is the second parent.

The actual pinned merge encountered 44 conflicts (30 content and 14 modify/delete), which were resolved using reviewed decisions. The maintained live-head rehearsal script also stopped at conflicts and did not reach the install or contracts phases.

## Core Implementation

A native syntax-highlighted diff engine was implemented, incorporating virtualized and progressive diff files. Features include initially collapsed files, an initially unchecked Ignore whitespace option, full context expansion, raster before/after images, and portable commands. Raw Pierre/Seam Preview line comments are fully retained.

The user interface features a flat work ribbon that expands upward with an end Hide action. This preserves attachments, subagents, the queue, unread state, Jump, and exact-message focus beyond the 60-message window. The existing source patch mechanism repairs FlashList 2.3.0 inverted Web geometry, which had been identified during real browser testing.

## Model Providers & Configuration

Model choices are grouped by provider, and unavailable saved selections are disabled after active catalog rows. Support has been added for optional Claude Fable 5.1 with 1M context and low through max effort, while Opus 5 remains the default. The Agy system features four logical models, defaulting to Gemini 3.8 Flash medium, with independent low, medium, and high Gemini effort settings. Legacy saved strings are supported at the provider boundary. ACP and Agy bounded visible failures have been integrated alongside a daemon CLI version refresh. The SDK dependency ^0.3.259 resolved exactly to 0.3.260, while the unrelated Codium 0.3.241 was retained.

## Excluded Scope & Out-of-Scope Items

Explicitly excluded from this phase were an extra Changes route, wholesale Pierre removal, a broad lockfile refresh, turning syntax highlighting off by default, enabled custom stale choices, hardcoded Astra, and an OpenClaw revival. Diagnostics are limited to development-only environments.

## Verification & Testing

Real Git Windows-shaped commands were tested on Linux; there was no Windows host available for testing, and no iOS device verification occurred. The Agy binary was unavailable for live smoke testing. The scope excludes deployment, release, and service restarts. Tests, build, and CI results will be appended as structured evidence after execution.

## Structural evidence

| Field | Value |
|---|---|
| Sync merge | `f312a0dcc98dc7cd361761697f1116638bdd73a9` |
| First parent | `5fa7b591453af495d29cbc5a27b2ac4ac52d4a9e` |
| Second parent | `9215aae61859b7903f9c5e190e09c8e3e93fa721` |
| Subject | `Merge commit '9215aae61859b7903f9c5e190e09c8e3e93fa721'` |
| CLI implementation | `server/packages/happy-cli` |
| Public package / binary | `@happyherd/cli` / `happyherd` |

## Verification surfaces

| Surface | Command or test |
|---|---|
| Lineage | `scripts/verify-lineage.sh` |
| Owned patches | `scripts/verify-patch-discipline.sh` |
| Merge provenance | `scripts/test-upstream-sync-provenance.sh` |
| Integration contracts | `scripts/contract-suite.sh` |
| Localization | `pnpm --filter happy-app i18n:check` |
| Diff interactions | `sources/components/diff/diffJourneys.browser.test.ts` |
| Chat interactions | `sources/components/ChatList.browser.test.ts` |
| Model picker interactions | `sources/components/sideChatHeader.browser.test.ts` |
| Production Web | Expo export and `pnpm --filter happy-app web:smoke` |
| CLI / server | Package production builds |
