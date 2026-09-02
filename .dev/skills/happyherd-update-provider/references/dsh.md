# dsh

Verified 2026-09-02 against dsh `0.1.2-alpha.4` and the current HappyHerd
source. Recheck the installed binary and ACP behavior before relying on these
volatile facts.

## Execution boundary

- Launch dsh exactly as `dsh --profile acp`.
- The audited initialize response used ACP `protocolVersion: 1` and identified
  the agent as `deepseek-harness-acp` version `0.0.1`.
- The daemon must inherit `DEEPSEEK_API_KEY`. HappyHerd does not store the key
  or add dsh to a credential pool.

## Capability contract

- HappyHerd live-discovers dsh models and reasoning efforts through one bounded,
  non-prompting `session/new` probe. The probe uses an isolated temporary
  `DSH_HOME` and working directory, sends no MCP servers, and disposes the
  process and temporary home immediately afterward.
- Discovery reads only the explicit `model` and `thought_level` select
  categories from `dsh-acp:session/new:configOptions`. Only opaque JSON tuples
  matching `["deepseek-official", nonempty model slug]` become public models;
  malformed and other-provider values are ignored. Each category's
  `currentValue` supplies its live default.
- The verified `0.1.2-alpha.4` CLI advertised `deepseek-v4-flash` (default),
  `deepseek-v4-pro`, and `deepseek-v4-flash-vision-exp`, plus reasoning efforts
  `off`, `low`, `high` (default), and `max`. Treat this as volatile provider
  output, not a HappyHerd allowlist. Catalog versioning reports the installed
  dsh CLI version rather than the ACP agent application's version.
- A missing, malformed, or failed probe omits the dsh catalog entirely and
  publishes an actionable error to Web Desktop and Web Mobile.
- dsh model selector values are opaque JSON `[provider, model]` tuples. The
  adapter resolves the public model slug at the dsh boundary and sends the
  provider's exact opaque value.
- Prompt images, audio, and embedded context are unsupported. HTTP MCP is
  supported.
- There is no permission-mode picker. Provider tool requests use the existing
  one-shot Human allow/reject prompt and the provider-advertised response
  options.

## Continuity

HappyHerd does not expose first-class dsh resume or fork. The audited provider
has newer close, list, and resume methods, but does not advertise the legacy
top-level `loadSession` capability used by HappyHerd's ACP continuity path.

## Verification focus

- Prove the exact wrapper command and detected-only app visibility.
- Prove the isolated live probe, exact config categories and official tuples,
  current-value defaults, installed CLI version, disposal, and cleanup.
- Prove dynamic model addition/removal and actionable fail-closed Web behavior
  when discovery is absent, malformed, or rejected.
- Prove model and effort are validated and applied before the first prompt;
  missing, malformed, unknown, or rejected provider options must fail closed.
- Prove model and reasoning categories cannot be mistaken for an operating or
  permission mode.
- Keep generic ACP prompt, tool, and permission normalization unchanged.
