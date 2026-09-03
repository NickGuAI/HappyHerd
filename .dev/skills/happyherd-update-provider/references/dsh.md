# dsh

Verified 2026-09-03 against installed dsh `0.1.2-alpha.4` and the current
HappyHerd source. Recheck the installed binary and ACP behavior before relying
on these volatile facts.

## Execution boundary

- HappyHerd runs dsh provider argv exactly as `dsh --profile acp`.
- HappyHerd consumes `--permission-mode` only in its wrapper and never forwards
  it in dsh argv. It removes any ambient `DSH_PERMISSION_MODE`, then sets the
  exact selected value in the child environment.
- The daemon must inherit `DEEPSEEK_API_KEY`. HappyHerd does not store the key
  or add dsh to a credential pool.

## Capability contract

- Capability refresh runs one bounded, non-prompting `session/new` probe in an
  isolated temporary `DSH_HOME` and working directory with zero MCP servers to
  discover `model` and `thought_level` options.
- The refresh also reads `dsh --profile acp --dump-config` as inert text. It
  never executes `!!js` YAML tags, and derives the provider-native permission
  preset order, code, optional name and description, sandbox, approval policy,
  and default.
- Discovery reads only the explicit `model` and `thought_level` select
  categories from `dsh-acp:session/new:configOptions`. Only opaque JSON tuples
  matching `["deepseek-official", nonempty model slug]` become public models;
  malformed and other-provider values are ignored. Each category's
  `currentValue` supplies its live default.
- The verified CLI advertised models `deepseek-v4-flash` (default),
  `deepseek-v4-pro`, and `deepseek-v4-flash-vision-exp`, plus reasoning efforts
  `off`, `low`, `high` (default), and `max`. Treat this as volatile provider
  output, not a HappyHerd allowlist. Catalog versioning reports the installed
  dsh CLI version rather than the ACP agent application's version.
- If provider config is missing, malformed, inconsistent, or disabled; a
  preset cannot be selected through `DSH_PERMISSION_MODE`; the settings-file
  path is custom; or `~/.dsh/settings.yaml` has a top-level `permission`
  namespace that can override `permission.defaultPreset`, discovery omits dsh
  entirely and reports an actionable error to Web Desktop and Web Mobile.
- Model selector values remain opaque JSON `[provider, model]` tuples. The
  adapter resolves the public model slug at the dsh boundary and sends the
  provider's exact opaque value.
- Native ACP prompt images, audio, and embedded binary content are unsupported.
  HappyHerd's dsh attachment actions instead upload Photos and Device files of
  the existing supported types to the selected machine/workspace, then add the
  exact host paths to the initial, follow-up, or queued message for dsh file
  tools. This is workspace context, not an ACP image/audio content block. HTTP
  MCP is supported.

## Permission semantics

- The exact current permission preset catalog is:
  - `read-only` (sandbox `read-only`, approval `ask`)
  - `workspace-write` (sandbox `workspace-write`, approval `ask`, default)
  - `danger-full-access` (sandbox `danger-full-access`, approval `never`)
- Full New Session on Web Desktop and Web Mobile, plus HomeDock on applicable
  native phone surfaces, select from the exact target-machine catalog. Agent
  Defaults mirrors the chosen catalog source.
- The selected tuple is target-validated, and `spawnSettings.permission` is
  the daemon-authored receipt.
- An active dsh composer renders only that receipt as a read-only chip. It never
  uses stale session-mode metadata and offers no runtime permission switch.
- Existing ACP model/reasoning and one-shot provider permission callback
  behavior is unchanged. `danger-full-access` disables dsh sandbox approval
  prompts but does not add HappyHerd autoapproval; residual provider-advertised
  callbacks remain allow/reject only.
- Presets affect file mutation boundaries, not read access, network access, or
  process visibility.

## Continuity

dsh has no first-class HappyHerd resume or fork.

## Verification focus

- Prove wrapper argv stripping of `--permission-mode` and clean child
  `DSH_PERMISSION_MODE` injection.
- Prove the isolated live ACP probe, exact config categories and official
  tuples, current-value defaults, installed CLI version, disposal, and cleanup.
- Prove inert `dump-config` parsing without executing `!!js`, including dynamic
  preset addition/removal and fail-closed behavior for malformed, inconsistent,
  disabled, unselectable, overridden, or custom-path provider configuration.
- Prove target validation, the `spawnSettings.permission` receipt, and the
  read-only active-composer chip without session-mode mutation.
- Prove Full New Session, native HomeDock, and active Session route dsh Photos
  and Device files through the existing selected-machine uploader, retain its
  size/count/progress/cancel/retry/failure behavior, and deliver exact
  machine-scoped host-path references without inline attachment payloads.
- Prove the three preset file-mutation boundaries while preserving existing ACP
  model, reasoning, and one-shot callback behavior.
