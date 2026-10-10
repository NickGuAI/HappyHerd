# Claude runtime model discovery

Contract: [issue #421](https://github.com/NickGuAI/HappyHerd/issues/421).
Baseline: `7d3963acde2d2e013dd2fdb59db4e5ebe5337b0f`.

The daemon refreshes Claude models through the Agent SDK's initialization
handshake. Discovery and remote sessions share the installed-executable
resolver. Model aliases and explicit canonical IDs remain distinct choices;
per-model efforts come from the runtime. Failed or empty discovery retains the
existing release catalog with fallback provenance rather than claiming live
discovery succeeded.

## Runtime evidence

On October 10, 2026, the patched source completed a prompt-free probe against
Claude Code **2.1.296**, using the frozen **0.3.283** Agent SDK, in **909 ms**.
The process exited successfully with empty stderr. The query used no tools,
MCP servers, settings sources, or persisted session and closed after discovery.

| Runtime result | Checked behavior |
|---|---|
| `sonnet` → `claude-sonnet-5-5` | Model absent from the release catalog becomes selectable; `high` is accepted |
| `haiku` → `claude-haiku-5-5` | Model absent from the release catalog is discovered |
| `default` and `opus` → `claude-opus-5-5` | One default row and one canonical row; pinned row retains the named model label |
| Explicit `claude-sonnet-5-5` / alias `sonnet` | Launch-settings validation returns the exact requested model and effort |
| Unavailable saved model ID | Validation rejects it without substitution; the app retains its unavailable selection |

This is live discovery and local launch-settings validation, not an
authenticated model response or provider-session resume. The tested plain
Claude CLI reported no active login; no authentication or account state was
changed for verification.

## Regression coverage

Local checks: 64 focused CLI tests; 45 app model-option tests; 224 app
selection/launch tests; two composer browser cases; CLI and app typechecks;
CLI package build; source lint and public-boundary checks.

- CLI capability, SDK adapter/probe, executable resolver, machine account
  environment, and launch-settings tests cover the changed mechanism.
- App model-option and selection/launch tests preserve exact machine catalog
  ownership, saved selections, model-specific effort, and outgoing choices.
- The existing production composer browser fixture exercises model and effort
  selection at 1440×900 and 390×844. Its machine metadata is a fixture; it is
  separate from the live runtime discovery above.
- Package typechecks, CLI build, source lint, public boundary, and PR quality
  checks provide the remaining build and repository evidence.

Rendered fixture evidence: [desktop](claude-runtime-model-effort-1440x900.png)
and [mobile](claude-runtime-model-effort-390x844.png).

Activation requires installing the reviewed CLI and reloading the daemon.
The model behavior does not require a central-server change. This PR does not
install, deploy, merge, or restart services.
