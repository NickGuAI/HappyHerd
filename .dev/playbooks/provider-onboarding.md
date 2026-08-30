# Provider onboarding

Use this playbook when adding a provider or changing a provider's capability,
message, permission, or tool-event contract. A provider is complete only when
both directions work: user selections reach the exact provider, and raw
provider behavior reaches a meaningful app presentation.

Live source, provider documentation or executable output, the closest
`AGENTS.md`, and the owning TickTick task remain authoritative. If the change
introduces or expands a HappyHerd-owned security mechanism, stop at read-only
investigation and follow the security-feature approval gate in
[`../README.md`](../README.md) before selecting implementation details.

## Contract map

```text
provider source of truth
  → capability catalog → app selection → shared metadata transit
  → CLI admission → exact-daemon/provider validation
  → native launch arguments and/or runtime selector
  → provider process

provider text / thinking / permission / tool events
  → provider mapper or ACP normalization
  → AgentMessage → AcpSessionManager → SessionEnvelope
  → app normalization → reducer → known or generic rendering
```

Do not declare onboarding complete at process spawn. The prompt-admission,
permission-callback, and raw-event return paths are part of the same vertical
slice.

## 1. Establish authoritative capabilities

- Register the provider once in the active harness registry and CLI detection.
- Record the source for models, per-model efforts, permission modes, attachment
  support, and resume/fork behavior. Prefer live machine discovery over static
  copies when the provider exposes it.
- Keep unsupported dimensions empty. Never borrow another provider's default or
  silently fall through to Claude.
- Revalidate saved choices against the exact launch daemon immediately before
  spawn.

Inspect the app registry/defaults route in [`../ROUTING.md`](../ROUTING.md) and
the provider-defaults path in [`../COUPLINGS.md`](../COUPLINGS.md).

## 2. Define permission semantics before wiring them

For every advertised mode, record this matrix in the task or implementation
plan:

| Question | Required answer |
|---|---|
| Source | Provider help/catalog, ACP configuration, or Happy-owned policy |
| Delivery | Process launch flag, runtime selector, or both |
| User promise | Interactive, deny-without-prompt, or no-prompt allow |
| Callback owner | Provider handles it, Happy asks, Happy allows, or Happy denies |
| Resume behavior | How the selected policy is restored and verified |
| Failure behavior | What happens for an unknown mode or absent allow/reject option |

Launch policy and provider operating mode are independent unless the provider
explicitly defines them as one setting. For every non-interactive mode, test a
provider permission callback after startup: Happy must not add a pending
request. An allow-without-prompt mode may select only an allow option the
provider advertised; a deny-without-prompt mode selects an advertised reject
or cancels. An unknown provider or mode fails safe rather than inheriting
another provider's policy. Launch flags alone do not prove this behavior.

Session metadata preserves an immutable launch receipt alongside the synced
current permission, model, and effort selected by the Human. For Claude and
Codex resume, resolve the latest complete current tuple, falling back per
missing dimension to the launch receipt and then to exact-machine advertised
defaults for legacy gaps. The target daemon validates that tuple against its
live catalog, launches it without silent substitution, returns an
authoritative settings receipt, and the app mirrors that receipt. Reject an
invalid tuple rather than executing a different one. Repeat the late-callback
matrix after resume so an allow-without-prompt or deny-without-prompt policy
cannot silently become interactive. GrokBuild permission remains launch-only:
its receipt governs the running process unless the dedicated validated
transition RPC restarts that exact process and returns a matching receipt.

For GrokBuild specifically, `server/packages/happy-cli/src/capabilities/agentCapabilities.ts`
discovers permission modes from `grok --help`,
`server/packages/happy-cli/src/agent/acp/acpAgentConfig.ts` applies them at
process launch, and `server/packages/happy-cli/src/agent/acp/runAcp.ts` keeps
them separate from ACP plan/build selection.

When a permission mode change is requested, the daemon must validate the selection and restart only the tracked Grok process using the corresponding Grok launch policy flag rather than modifying the ACP operating mode. Ensure the shared composer only updates the visible mode after the resumed provider returns a matching launch receipt while retaining transcript, path, identity, and queued messages.

## 3. Preserve open transit and validate at the provider boundary

Shared wire/app metadata carries provider-native strings so a new provider does
not require every transport layer to learn its enum. Validate the value against
the selected exact-daemon catalog or provider adapter before execution.

Audit together:

- `server/packages/happy-wire/src/messageMeta.ts`;
- `server/packages/happy-app/sources/sync/typesMessageMeta.ts`;
- `server/packages/happy-cli/src/api/types.ts` and `apiSession.ts`;
- capability validation, daemon spawn, and the provider adapter.

Add a fixture with a valid provider-native mode that is not a Claude or Codex
value. Assert that the message reaches the selected provider boundary and that
an invalid value is rejected there with an actionable error. As of baseline
`3eac2e3c`, the CLI metadata schema is narrower than the wire and app schemas;
new native codes must not ship while that contradiction remains reachable.

## 4. Normalize raw provider events without losing semantics

Start tests from the provider's real or specification-shaped event, not an
already-normalized `AgentMessage`. For ACP tool events, keep these fields
separate:

- `toolCallId`: stable correlation from start through result or failure;
- `title`: authoritative human-readable display text;
- `kind`: optional category, useful for grouping or icons but not identity;
- `rawInput`: structured arguments;
- content/result/error: outcome data supported by the shared session contract.

ACP updates are sparse, so retain the initial descriptor by call ID when later
updates omit title, kind, or input. A provider-specific `knownTools` entry may
enrich a familiar tool, but an unfamiliar valid tool must still use the
provider's meaningful title in compact and expanded generic views. Do not add a
provider as a new direct consumer of a frozen shared protocol merely to bypass
an adapter limitation; change the shared contract and all consumers together
when the supported outcome requires it.

The current generic ACP path is
`AcpBackend.ts` → `sessionUpdateHandlers.ts` → `AgentMessage.ts` →
`AcpSessionManager.ts` → `happy-wire/src/sessionProtocol.ts` → app
`typesRaw.ts`/reducer → `components/tools/ToolView.tsx` and
`utils/toolDisplay.ts`.

## 5. Prove the vertical slice

Use the provider matrix in [`../VERIFY.md`](../VERIFY.md). At minimum, retain:

1. registry and capability-source parity;
2. open metadata transit plus exact-provider validation;
3. exact native launch/runtime selection;
4. a synthetic late permission callback for every advertised behavior class;
5. raw/spec-shaped tool start, split descriptor/output deltas, and status-only
   completion and failure fixtures;
6. stable call correlation and meaningful generic app rendering; and
7. a live smoke against the installed provider when prerequisites are
   available.

For a documented non-interactive mode, the live smoke uses one harmless tool
and records zero approval prompts plus the documented allow or deny outcome.
For an interactive mode, it records the expected prompt. For tool rendering,
use an unfamiliar native tool name so the generic path—not a provider-specific
registry—proves correctness.

Run the focused tests first, then the affected wire, `happy`, and `happy-app`
package checks from [`../VERIFY.md`](../VERIFY.md). Record unavailable live
prerequisites explicitly; do not replace missing behavioral proof with argv or
snapshot assertions.
