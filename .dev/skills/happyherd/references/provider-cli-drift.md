# Provider CLI invocation and drift

**Deliberately not imported:** the source repository's orchestration router,
authentication instructions, provider session storage, background-workflow
recovery, and direct-launch control plane. Never use these notes to bypass
`happyherd`, copy credentials, or replace HappyHerd's Codex app-server and
GrokBuild ACP owners.

Use this reference when an installed Codex or GrokBuild binary may have drifted
from the adapter, capability parser, or focused provider documentation. These
are maintainer checks, not an alternate user-facing launch path.

## Current HappyHerd boundary

- Codex sessions are owned by
  `server/packages/happy-cli/src/codex/runCodex.ts` and
  `server/packages/happy-cli/src/codex/codexAppServerClient.ts`; the external
  source's `codex exec` form is relevant only to a separately approved
  headless utility.
- GrokBuild sessions use the fixed ACP transport assembled in
  `server/packages/happy-cli/src/agent/acp/acpAgentConfig.ts`. Permission
  choices are parsed from the installed CLI by
  `server/packages/happy-cli/src/capabilities/agentCapabilities.ts`.
- Provider changes belong under the `happyherd-update-provider` skill. The live
  binary, current source, and its Codex/GrokBuild references outrank the
  external snapshots below.

## Read-only drift audit

Capture identity and command-specific help before changing a claim or argument:

```bash
command -v codex
codex --version
codex exec --help
command -v grok
grok --version
grok --help
grok models
```

Run `grok models` only with an already configured provider identity; do not add
or expose credentials for the audit. Do not substitute top-level `codex
--help` for `codex exec --help`, and do not probe `happyherd grok --help`, which
can launch a real session.

Compare exact command tokens, not prose or section names:

- executable identity and resolved path;
- version and the help surface for the actual subcommand or transport;
- entry point, flag spelling, allowed values, defaults, and mutually exclusive
  options;
- output mode, exit semantics, and expected artifact;
- current HappyHerd source arguments and focused tests.

A rejected flag is drift evidence. Remove or update a stale claim instead of
adding a compatibility fallback. Record which binary and version proved each
claim; help/version checks are the default because live turns may spend quota.

## External invocation snapshots

The source recorded Codex CLI 0.144.6 with this non-interactive shape:

```bash
codex exec --sandbox read-only --color never \
  -o /absolute/path/to/last-message.txt \
  "Read /absolute/path/to/prompt.md and follow it exactly."
```

Its reusable checks were: use `-o` instead of scraping mixed stdout; add
`--output-schema` only with a real schema and validate the result; use `--cd`
or `--skip-git-repo-check` deliberately; and verify the required result file is
non-empty after exit zero. On that version, `codex exec` rejected interactive
`-a/--ask-for-approval`; recheck the `exec` help rather than preserving that
fact indefinitely.

The source recorded GrokBuild 1.0.4 with either headless form:

```bash
grok --prompt-file /absolute/path/to/prompt.md --output-format json --cwd /absolute/path/to/workspace
grok -p "Read /absolute/path/to/prompt.md and write the result to /absolute/path/to/result.md."
```

Its reusable checks were: invoke the unambiguous `grok` binary; verify xAI
identity with version plus model discovery; do not invent `grok exec` or `grok
print`; wait for process exit rather than polling sleeps; and validate JSON or
the requested result artifact. These prompt forms do not replace HappyHerd's
`grok --no-auto-update agent stdio` ACP transport.

## Acceptance record

For a drift audit, report the provider, resolved binary, observed version,
exact help command, HappyHerd owner, confirmed/rejected claims, and focused
tests. If a live smoke is explicitly authorized, also require exit zero,
non-empty requested artifacts, schema conformance when requested, and no secret
or raw session data in receipts.

## Source evidence

Within the `ai-agent-cli-skill` source snapshot:

- `AGENTS.md`
- `skills/codex_cli.md`
- `skills/grok_cli.md`
- `docs/test.md`
- `docs/working.md`
