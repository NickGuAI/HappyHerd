# Approved upstream integration: 4b7d763e

**Draft integration candidate; not approved for merge or release.**

## Frozen source and topology

- Distribution baseline: `772033be804296394d6c52581679008c7eca6ff0`.
- Approved upstream: `4b7d763ee3afda04985f3210b9cb9acf9359c7d9`; later upstream changes are excluded.
- Previous integrated upstream: `9215aae61859b7903f9c5e190e09c8e3e93fa721`.
- Merge: `2f549143a9b2574f72339076a4eefa70ec7b189b`; first parent `772033be804296394d6c52581679008c7eca6ff0`; second parent `4b7d763ee3afda04985f3210b9cb9acf9359c7d9`.
- Exact subject: `Merge commit '4b7d763ee3afda04985f3210b9cb9acf9359c7d9'`.
- Integration changes are restricted to `server/`. This report and lineage update are a separate owned commit.

## Owning task and decisions

https://ticktick.com/webapp/#p/6a6dfdf8b014d115c15aa92c/tasks/6aa51e198f08ca8557e5752b

Adopt branch comparisons against the origin/main merge base inside the existing single Workspace. Retain Codium, its registration and build dependencies. Include expo-tailcat as an experimental standalone package, without enabling a tunnel, native CI, publishing or release automation.

Preserve the richer HappyHerd tool-result/error protocol, bot conversation ownership, Projects/sidebar, composer Git status, provider choices, exact-message navigation, queue/image rendering, Workspace drafts and side-chat lifecycle. Do not restore the separate Changes route or retired TypeScript translation catalogs. Preserve the in-place CLI implementation, public package @happyherd/cli and happyherd binary.

The candidate adapts tool/raw-patch presentation, Astra ordering/defaults, prewarming, watched-turn expansion, worktree reads, five-second daemon checks, offline guidance, off-thread syntax and detail presentation. These interaction changes still require review and functional verification.

## Preparation evidence

Dependency lock reconciliation and frozen installation completed. Conflict paths were resolved mechanically; this is not proof of functional equivalence.

| Check | Exit code | Result |
| --- | ---: | --- |
| syntax-generation-build-diff-syntax | 0 | Passed |
| catalog-generation | 0 | Passed |
| inventory-generation | 1 | BLOCKER: failed or timed out |
| changelog-generation | 0 | Passed |
| app-typecheck | 2 | BLOCKER: failed or timed out |

## Failed-check details

### inventory-generation

```text
packages/expo-tailcat                    |  WARN  Unsupported engine: wanted: {"node":">=22"} (current: {"node":"v20.20.2","pnpm":"10.11.0"})

> happy-app@1.0.0 ui:inventory:generate /home/runner/work/HappyHerd/HappyHerd/server/packages/happy-app
> node scripts/generate-ui-surface-inventory.mjs --write

[ui-inventory] wrote 40 routes, 278 surfaces, and 84 smoke cases
file:///home/runner/work/HappyHerd/HappyHerd/server/packages/happy-app/scripts/generate-ui-surface-inventory.mjs:139
    throw new Error(`Production UI contains ${analysis.hardcodedCopy.length} hardcoded copy findings:\n${details.join('\n')}`);
          ^

Error: Production UI contains 9 hardcoded copy findings:
sources/components/diff/DiffHeaderRight.tsx:85:48 [jsx:Text] Unified
sources/components/diff/DiffHeaderRight.tsx:85:60 [jsx:Text] Split
sources/components/diff/syntax/factory.generated.ts:36:34589 [descriptor:label] symbol
sources/components/diff/syntax/factory.generated.ts:36:36542 [descriptor:label] important
sources/components/diff/syntax/factory.generated.ts:36:72184 [descriptor:placeholder] selector
sources/components/diff/syntax/factory.generated.ts:36:74952 [descriptor:title] important
sources/components/diff/syntax/factory.generated.ts:36:75040 [descriptor:title] important
sources/components/diff/syntax/factory.generated.ts:36:95307 [descriptor:description] string
sources/components/diff/syntax/factory.generated.ts:36:95324 [descriptor:description] language-markdown
    at file:///home/runner/work/HappyHerd/HappyHerd/server/packages/happy-app/scripts/generate-ui-surface-inventory.mjs:139:11

Node.js v20.20.2
/home/runner/work/HappyHerd/HappyHerd/server/packages/happy-app:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  happy-app@1.0.0 ui:inventory:generate: `node scripts/generate-ui-surface-inventory.mjs --write`
Exit status 1
```

### app-typecheck

```text
sources/app/(app)/_layout.tsx(1,10): error TS2300: Duplicate identifier 'createPlainHeader'.
sources/app/(app)/_layout.tsx(6,24): error TS2300: Duplicate identifier 'createPlainHeader'.
sources/app/(app)/new/index.tsx(2495,42): error TS2304: Cannot find name 'agentType'.
sources/app/(app)/new/index.tsx(2712,42): error TS2304: Cannot find name 'agentType'.
sources/components/ChatList.tsx(456,14): error TS2304: Cannot find name 'currentTurnComplete'.
sources/components/HappyAgentDiffView.tsx(150,70): error TS2322: Type 'number' is not assignable to type 'string'.
sources/components/sessionPresentation.test.ts(184,37): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'subtitle' does not exist in type 'Attributes & ChatHeaderViewProps'.
sources/components/sessionPresentation.test.ts(191,82): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'subtitle' does not exist in type 'Attributes & ChatHeaderViewProps'.
sources/components/sessionPresentation.test.ts(197,31): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'subtitle' does not exist in type 'Attributes & ChatHeaderViewProps'.
sources/components/sessionPresentation.test.ts(203,31): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'subtitle' does not exist in type 'Attributes & ChatHeaderViewProps'.
sources/components/sessionPresentation.test.ts(208,31): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'subtitle' does not exist in type 'Attributes & ChatHeaderViewProps'.
sources/components/sessionPresentation.test.ts(311,31): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'subtitle' does not exist in type 'Attributes & ChatHeaderViewProps'.
sources/components/tools/ToolFullView.tsx(35,58): error TS2552: Cannot find name 'getTerminalToolCommand'. Did you mean 'terminalCommand'?
sources/components/tools/ToolFullView.tsx(49,26): error TS2304: Cannot find name 'CommandView'.
sources/components/tools/views/CodexPatchView.tsx(10,10): error TS2300: Duplicate identifier 't'.
sources/components/tools/views/CodexPatchView.tsx(19,10): error TS2300: Duplicate identifier 't'.
sources/components/tools/views/CodexPatchView.tsx(29,13): error TS2304: Cannot find name 'getPatchKindLabel'.
sources/components/tools/views/CodexPatchView.tsx(199,25): error TS17001: JSX elements cannot have multiple attributes with the same name.
sources/sync/storage.ts(234,9): error TS1117: An object literal cannot have multiple properties with the same name.
sources/sync/storage.ts(235,9): error TS1117: An object literal cannot have multiple properties with the same name.
sources/sync/storage.ts(403,11): error TS2451: Cannot redeclare block-scoped variable 'botSessions'.
sources/sync/storage.ts(406,11): error TS2451: Cannot redeclare block-scoped variable 'botSessions'.
sources/utils/flatSessionList.test.ts(75,13): error TS2554: Expected 1 arguments, but got 2.
sources/utils/flatSessionList.test.ts(89,12): error TS2554: Expected 1 arguments, but got 2.
sources/utils/toolDisplay.test.ts(6,5): error TS2300: Duplicate identifier 'getToolDisplayTitle'.
sources/utils/toolDisplay.test.ts(8,5): error TS2300: Duplicate identifier 'getToolDisplayTitle'.
sources/utils/toolDisplay.ts(126,17): error TS2323: Cannot redeclare exported variable 'getToolDisplayTitle'.
sources/utils/toolDisplay.ts(126,17): error TS2393: Duplicate function implementation.
sources/utils/toolDisplay.ts(287,17): error TS2323: Cannot redeclare exported variable 'getToolDisplayTitle'.
sources/utils/toolDisplay.ts(287,17): error TS2393: Duplicate function implementation.
/home/runner/work/HappyHerd/HappyHerd/server/packages/happy-app:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  happy-app@1.0.0 typecheck: `tsc --noEmit`
Exit status 2
```


## Remaining acceptance boundaries

Required PR Quality and Contract checks, affected-package tests, single-Workspace branch comparisons, native/web session focus and side-chat journeys must pass before marking ready. A failed generation/typecheck is not waived by opening a draft PR. Review the exact-head CI results, not merely this preparation run.

The live happyherd-upstream-merge-proposal automation definition and latest run were not available in this isolated checkout. Its expected schedule is 09:17 Etc/UTC daily; no runtime automation was mutated. No production deployment, release, installation on a user machine, restart, merge to main or TickTick completion was performed.

Preparation run: https://github.com/NickGuAI/HappyHerd/actions/runs/34804079801
