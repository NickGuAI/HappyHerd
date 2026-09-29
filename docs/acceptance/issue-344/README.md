# Claude background subagent outcomes (#344)

Contract: https://github.com/NickGuAI/HappyHerd/issues/344. Base:
`abefe670ec8bdc7e44732ef52c90d8046486e294`. Delivery is source and a review-ready
PR; merge, installation, deployment, daemon restart and issue closure are not
part of this delivery. The PR and final issue receipt pin the reviewed head.

## Reproduction and repair

The new mapper regression initially failed all eight original cases: the SDK
bridge dropped structured launch results, launch acknowledgments completed a
child, parent closure stopped it, system lifecycle events disappeared, and
progress/terminal events lost their child association. A separate scanner
regression observed zero messages for a native `agent_progress` row.

The repair preserves SDK `tool_use_result` and reads native `toolUseResult`;
correlates task IDs with the original Task/Agent call and turn; keeps known
background/provider-managed children running across parent closure; maps actual
completed/failed/stopped (native killed) outcomes; handles events arriving
before their descriptor or launch receipt; and unwraps native progress into the
existing sidechain mapper. Normal synchronous results retain their existing
completion behavior. Bash/MCP task events do not create subagent cards.

Native terminal meta messages and SDK system notifications share the same
lifecycle mapping. Raw native messages retain their UUID for deduplication.
The app production implementation, wire schema, server and daemon are unchanged.

## Automated evidence

Run package commands from `server/`, with Node 20, pnpm 10.11.0,
`TMPDIR=/private/tmp`, `TZ=UTC`, and Vitest workers limited to one.

- CLI: `pnpm --filter @happyherd/cli exec vitest run --project unit src/claude/utils/sessionProtocolMapper.background.test.ts src/claude/utils/sessionProtocolMapper.test.ts src/claude/utils/sdkToLogConverter.test.ts src/claude/utils/sessionScanner.test.ts --maxWorkers=1 --minWorkers=1`.
- App normalization/reducer: `sources/sync/reducer/subagentLifecycle.spec.ts`,
  existing `typesRaw.spec.ts` and `reducer.spec.ts`.
- Card rendering: `sources/components/tools/views/SubagentView.spec.ts`.
- Visible entry: `sources/components/sideChatHeader.browser.test.ts -t 'keeps a background child Running'`.

The browser fixture renders production SessionView, SideChatPanel and tool
cards with synthetic storage/transport. The user opens **Side chats**, sees a
Running child after parent completion, expands its text/tool activity, closes
and reopens the panel, observes its actual terminal status, and reloads. A
second child's Running state is unchanged. Header and badge are checked for
completed, failed and cancelled independently.

| Surface | Theme | Outcomes / retention | Evidence plane |
| --- | --- | --- | --- |
| Web 1440×900 | Light | Running → completed/failed/cancelled; close/reopen; refresh | Rendered fixture |
| Web 1440×900 | Dark | Same independent cases | Rendered fixture |
| Web 390×844 | Light | Same independent cases through the compact sheet | Rendered fixture |
| Web 390×844 | Dark | Same independent cases through the compact sheet | Rendered fixture |
| iOS / Android | Both | Shared normalization and component tests only | Device journey unproved |
| macOS / Windows native host | Both | No native host run | Native journey unproved |

## Verification boundaries and activation

Cold raw-event replay and duplicate delivery are tested separately from browser
fixture refresh. The rendered fixtures do not establish an authenticated live
Claude run, a provider reconnect after process replacement, or deployed/native
behavior. Those require the reviewed CLI artifact to be installed and activated
under separate authority, then the exact deployed host/device journey.

The CLI mapper and scanner execute in the Claude session process; changing them
does not itself require a daemon restart. Changelog data needs the selected app
artifact to reach clients. No runtime installation, deployment or restart was
performed. The final PR/issue receipt records check results, independent review,
CI conclusions and any remaining external prerequisites for its exact head.
