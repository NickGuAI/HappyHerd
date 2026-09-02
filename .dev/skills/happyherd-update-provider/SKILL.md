---
name: happyherd-update-provider
description: Add, update, test, or diagnose a HappyHerd provider integration across Human UI, terminal launch, shared metadata, daemon routing, provider adapters, callbacks, rendering, and resume or restart. Use when onboarding a provider, changing its models or modes, repairing provider-specific behavior, or designing provider integration tests.
---

# HappyHerd Provider Method

Treat a provider as a vertical product contract, not a launch command. Establish
the provider's current native behavior, find the HappyHerd boundary that owns
each translation, and prove the result from the Human-facing surface through
the provider and back.

## Load the relevant context

1. Read the closest repository guide and start at `.dev/AGENTS.md` when the
   project has a `.dev/` context pack.
2. Read `.dev/playbooks/provider-onboarding.md` and use `.dev/ROUTING.md` and
   `.dev/VERIFY.md` to locate owners and checks.
3. Read exactly one provider reference unless the task explicitly compares
   providers:

   - Claude Code: `references/claude.md`
   - Codex: `references/codex.md`
   - GrokBuild: `references/grokbuild.md`
   - dsh: `references/dsh.md`
   - Antigravity: `references/antigravity.md`
   - Happy provider: `references/happy.md`
   - Retired Gemini compatibility: `references/gemini.md`
   - Generic ACP or OpenCode: `references/generic-acp.md`

   For a brand-new provider with no reference, do not borrow an analogous
   provider's assumptions. Establish facts from its native sources, then add a
   one-level `references/<provider>.md` after verification.

References are evidence leads, not live-state proof. Recheck volatile flags,
SDK types, installed versions, catalogs, and runtime behavior at the source
that currently owns them.
Native runtime and installed SDK compatibility jointly bound support. If the
SDK cannot represent a catalog value, report it unsupported for that version
rather than casting or substituting.

## Establish the contract before changing code

Write down the supported end state in provider-native terms:

- how HappyHerd discovers availability, models, effort levels, and permission
  or operating modes;
- which choices the Human sees on Web Desktop, Web Mobile, and other supported
  surfaces;
- which settings a Main Agent can supply from the terminal;
- which values must survive shared transport unchanged;
- how the daemon validates and persists them for the exact machine;
- how the adapter maps them to native launch or runtime controls;
- how native permission requests and raw events map back into HappyHerd; and
- what resume, fork, abort, reconnect, and daemon restart must preserve.

Leave a capability dimension empty when the provider does not advertise it.
Do not invent an effort selector, fallback model, permission mode, or content
type to make providers look uniform.

Track two settings records with different jobs. The initial launch receipt is
immutable evidence of how the session started. The latest current
Human-selected model, effort, and permission fields are mutable session state.
On resume, resolve each field independently in this order: its latest current
value, the corresponding initial-receipt value, then the exact-machine
advertised default. The target daemon must validate the resolved tuple, return
an authoritative settings receipt, and the UI must mirror that returned
receipt. Do not replace this precedence with one all-or-nothing settings
object; a legacy record may be missing only one field.

Treat a present receipt field whose value is `null` as an explicit
provider-ambient selection, not as a missing field. Only an absent field in a
legacy receipt falls through to the next precedence tier.

Distinguish facts observed in current source or runtime from assumptions. If
the provider is unavailable locally, state which live evidence cannot be
collected; do not replace it with an argv assertion.

## Classify native behavior

Do not copy names or flags into a provider-generic enum just because two
providers look similar. Classify what each advertised choice actually does:

- interactive approval;
- allow without a Human prompt;
- deny without a Human prompt;
- read-only or plan behavior;
- provider-defined behavior that does not fit those classes.

Keep launch policy, runtime operating mode, permission callback policy, and UI
display state separate unless the provider explicitly unifies them. For
dynamic catalogs, preserve the provider-native code and validate it against
the exact provider catalog at the adapter or daemon boundary.

## Trace the complete vertical slice

Follow one selected value and one representative native event through every
supported boundary:

1. Human UI and terminal selection.
2. App state, RPC, and open shared metadata transit.
3. Exact-machine daemon validation and session persistence.
4. Provider adapter argument or SDK option construction.
5. Native process, SDK, or protocol behavior.
6. Permission callbacks and raw text, thinking, tool, result, and error events.
7. Wire normalization and Human-facing rendering.
8. The resume, fork, abort, reconnect, and restart operations affected by the
   change. For a new provider, assess every continuity operation it claims to
   support.

Shared schemas should carry provider-native strings without teaching every
transport layer a provider enum. Validate at the exact provider boundary so a
new valid native value is neither discarded early nor accepted by the wrong
provider.

When a turn explicitly requests an invalid or unsupported permission mode,
reject that turn with a Human-visible error. Never ignore the request and run
the turn under the previous mode.

For permission behavior, assess these four independent gates and require proof
only where the provider advertises the capability or HappyHerd claims it:

- the selected mode reaches native launch or runtime configuration;
- when a callback channel exists, a later provider permission callback
  produces the intended allow, deny, or Human prompt behavior;
- the UI continues to display the actual effective mode; and
- when continuity is supported, resume and restart restore the same policy.

Use the full `select → launch → permission callback → daemon restart → resume
→ permission callback` chain only when those capabilities are advertised or
claimed. If there is no callback channel, prove native launch behavior and
zero pending Human approvals. If cross-process resume is unsupported, verify
and report that unsupported state. When the native provider owns callbacks or
restoration, use its native fixture or live contract, or state exactly which
evidence is unavailable. An invalid or cross-provider explicit mode must never
run under any branch.

## Design tests from behavior and boundaries

Build a matrix for every advertised provider mode. Each row should cover:

| Evidence | Question |
|---|---|
| Catalog | Is the mode advertised by its authoritative source and rendered only when available? |
| Transit | Does its exact native code survive UI or terminal through RPC and shared metadata? |
| Validation | Does the selected provider accept it while rejecting invalid or cross-provider values? |
| Native selection | Does the adapter produce the documented SDK option, flag, or runtime request? |
| Callback | When supported, does a synthetic late permission request prompt, allow, or deny exactly once as intended? Otherwise, is the absence of a HappyHerd callback and pending Human request proved? |
| Display | Does each supported Human surface remain truthful after launch, transitions, aborts, and resume? |
| Continuity | For continuity the provider advertises or HappyHerd claims, do resume and daemon restart preserve the effective policy? Otherwise, is unsupported status explicit? |

Record display proof explicitly rather than collapsing responsive behavior
into one claim:

| State | Web Desktop | Web Mobile |
|---|---|---|
| Initial launch | Selected tuple and returned receipt agree | Selected tuple and returned receipt agree |
| Live transition or abort | Display matches the effective provider mode | Display matches the effective provider mode |
| Invalid explicit mode | Visible rejection; no turn runs | Visible rejection; no turn runs |
| Restart and resume | Returned daemon receipt is mirrored | Returned daemon receipt is mirrored |

For a new provider or protocol-shape change, add a capability and event matrix
covering catalog provenance, explicitly unsupported dimensions, text and
thinking streams, tool lifecycle, results and errors, attachments when
advertised, and supported continuity operations.

Start fixtures from the real provider or specification-shaped input, not from
an already-normalized HappyHerd event. For tool events, preserve stable call
identity and provider-supplied title, input, output, error, and completion
semantics through sparse or split updates. Include one unfamiliar valid tool
so generic rendering is proved independently of provider-specific display
registries.

Run the narrow owning tests first, then every affected package check selected
by `.dev/VERIFY.md`. Finish with harmless live provider smokes when its binary,
authentication, and environment are available. Exercise each materially
different permission behavior class when practical. A non-interactive mode
smoke must show the native outcome and zero Human approval prompts.

## Diagnose from the symptom to the owner

Work backward before editing:

| Symptom | Inspect first | Then trace |
|---|---|---|
| Provider rejects startup | Adapter arguments or SDK options | Capability source and daemon validation |
| Wrong or missing mode in UI | Display state and session receipt | Launch selection and persistence |
| Unexpected Human approval | Native callback handler | Effective launch policy and callback classification |
| Tool output is missing or misleading | Raw event mapper | Wire reducer and generic renderer |
| Resume changes behavior | Persisted session policy | Resume caller, exact-machine validation, native relaunch |
| Only one surface fails | Surface host and state owner | Shared component and responsive/native boundaries |

Capture the smallest raw evidence that distinguishes the layers: exact spawn
arguments or SDK options, current session receipt, provider callback payload,
normalized wire event, and rendered state. Add a regression test at the first
boundary where expected and actual behavior diverge.

## Make the proportional repair

Fix the owning mechanism and scan the same mechanism for reachable sibling
providers or modes. Do not add a provider framework, compatibility rail,
policy engine, security feature, or fallback for an unobserved future case.
Preserve the upstream architecture and remove obsolete special cases when the
current provider contract no longer needs them.

When a source change makes development context stale, update only the affected
`.dev` entries. When verified provider facts change, update only that
provider's reference. For a user-visible HappyHerd change, update its product
changelog and generated changelog data in the same delivery.

## Done when

- Authoritative capability sources are captured and referenced.
- Every changed or advertised behavior class has deterministic evidence or an
  explicit unsupported or unavailable status.
- Invalid explicit modes and cross-provider values are rejected before
  execution and never run.
- Web Desktop and Web Mobile remain truthful wherever a Human UI exists.
- Applicable checks selected from `.dev/VERIFY.md` pass.
- The provider reference, affected development context, and product changelog
  are updated when their facts or user-visible behavior changed.

## Handoff

Report:

- the provider contract and authoritative sources used;
- the violated boundary and root cause;
- the smallest repair and any same-mechanism siblings checked;
- the per-mode evidence matrix, focused tests, package checks, and live smoke;
- unavailable prerequisites or residual supported gaps; and
- any provider reference or `.dev` context updated from verified facts.
