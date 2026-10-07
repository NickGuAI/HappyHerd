# HappyHerd CLI

The command-line interface for HappyHerd; its source package is named `@happyherd/cli`.
Control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

Use the [HappyHerd quickstart](../../../../README.md#get-started) and
[installer guide](../../../../docs/public-launcher-release.md). Public release
1.2.4 provides macOS/Linux CLI, server, and Web archives; it does not publish
an npm package or native graphical/mobile apps. This README describes current
source, which can be newer than that release.

HappyHerd preserves the full history of upstream Happy. The upstream project
previously migrated from `happy-coder`; thanks to
[@franciscop](https://github.com/franciscop) for donating its historical
`happy` package name. These are historical attribution, not installed commands.

### Upgrading existing installations

The installed command is `happyherd`; the MCP helper is `happyherd-mcp`.
Set `HAPPYHERD_HOME_DIR`, `HAPPYHERD_SERVER_URL`, and `HAPPYHERD_WEBAPP_URL` for
new configuration.
<!-- rename:preserve -->
Older `HAPPY_*` environment inputs remain readable with the
canonical spelling taking precedence. Existing `~/.happyherd` is preferred;
if only `~/.happy` exists, it is used in place. Neither home is copied or merged.
<!-- /rename:preserve -->
Your original machine identity, keys, session IDs, provider homes and history
stay intact. See the [rename and migration SOP](../../../../docs/cli-renaming.md)
and [upstream-sync SOP](../../../../docs/cli-upstream-sync.md).

## Shared operations knowledge

Ordinary installation seeds missing files in the configured HappyHerd home:
`AGENTS.md`, `agentcontext/README.md`, and `agentcontext/happyherd-cli.md`.
The global entry links to the portable shared guide. Supported Claude/Codex
Commander startup and resume receipts direct agents there without replacing
private Commander memory. Gemini Commander launch is disabled; generic ACP
routes do not consume that context bundle.
Existing files and private Commander definitions/state are preserved.

For an existing installation, run `happyherd commander guide --json` to seed
missing guides and inspect the returned paths/statuses. Customized or obsolete
files are never overwritten: manually correct obsolete references after review,
retaining all user-authored instructions. Use the effective home from the receipt
instead of assuming `~/.happyherd`. The standalone guide command does not restart
the daemon. A live conversation must resume through the supported route to obtain
fresh context. A native installer upgrade stops its managed daemon; normal
installation can start services afterward. `--no-start` prevents startup, not
the upgrade stop.

## Usage

### Claude Code (default)

```bash
happyherd
# or
happyherd claude
```

This will:
1. Start a Claude Code session
2. Display a QR code to connect from your mobile device or browser
3. Allow real-time session control — all communication is end-to-end encrypted
4. Start new sessions directly from your phone or web while your computer is online

### More agents

```
happyherd codex
happyherd agy        # Antigravity CLI (Gemini's successor)
happyherd gemini     # deprecated — use `happyherd agy`
happyherd grok       # GrokBuild through its official ACP stdio interface

# or any ACP-compatible CLI
happyherd acp opencode
happyherd acp -- custom-agent --flag
```

`happyherd grok` uses the installed official GrokBuild CLI. Authenticate that CLI
with `grok login` before starting, or use a named local account with
`happyherd connect grok --acct <nickname>`. Model and reasoning-effort choices come from GrokBuild's live ACP
catalog. Launch permission choices come from the installed `grok --help`, and
New Session offers them in that native order. If help does not advertise its
choices, HappyHerd exposes only the provider default.

Use `grok --permission-mode MODE` with GrokBuild directly, or
`happyherd grok --permission-mode MODE` through HappyHerd. The default is `default`.
HappyHerd forwards the selection verbatim and starts
`grok --no-auto-update --permission-mode MODE agent stdio`.

| Mode | GrokBuild launch behavior |
|------|----------------------------|
| `default` | Run read-only and pre-approved tools; ask before other actions. |
| `acceptEdits` | Approve file edits; ask before other actions. |
| `auto` | Run calls allowed by GrokBuild's safety check; block or escalate other calls. |
| `dontAsk` | Run only pre-approved and built-in read-only tools; deny other calls without prompting. |
| `bypassPermissions` | Generally approve tool calls; deny rules, hooks, and shell ask rules still apply. |
| `plan` | Compatibility permission value forwarded as-is; GrokBuild's live plan operating mode is separate. |

When an active GrokBuild permission mode changes, HappyHerd validates it against the
original machine's current catalog, restarts the tracked Grok process, and
resumes the same ACP conversation. The visible mode changes only after the
relaunch is confirmed. ACP plan/build operating mode and HappyHerd's optional OS
sandbox remain separate controls. Resume restores the saved launch policy on
the original online machine after exact-machine validation. The current
GrokBuild integration does not expose image or audio attachments or session
fork.

> **Note on agy permissions:** the agy backend runs `agy --print`, which is
> one-shot and supports only two modes. `default` passes `--sandbox`, while
> `bypassPermissions` passes `--dangerously-skip-permissions`. There is no
> HappyHerd per-tool permission callback channel, so neither mode creates Human
> approval prompts. Changing the mode applies to the next child process, and
> aborting cancels the current child while preserving the selected mode.

## Daemon

The daemon is a background service that stays running on your machine. It lets you spawn and manage coding sessions remotely — from your phone or the web app — without needing an open terminal.

```bash
happyherd daemon start
happyherd daemon stop
happyherd daemon status
happyherd daemon list
```

The daemon starts automatically when you run `happyherd`, so you usually don't need to manage it manually.

### Account machines and remote sessions

Link account-wide machine control once from the HappyHerd app. This key is stored
as `agent.key` in the configured HappyHerd home and remains separate from the
normal `access.key` used by native sessions. `access.key` never grants machine
control of other machines, including for legacy native-session credentials.
Creating a side chat is different: run that command on the parent session's
owning machine and it reuses the already-authenticated local daemon, with no
account-control link or QR approval:

```bash
happyherd machine auth login
happyherd machine auth status
happyherd machine auth logout
```

Create and manage a side chat through that local daemon:

```bash
happyherd session side-chat create <parent-session-id> \
  --outcome '<target result>' \
  --scope '<bounded work>' \
  --dependencies '<inputs or none>' \
  --write-ownership '<owned files or resources>' \
  --verification '<required proof>' \
  --handoff '<result and evidence to return>' \
  --model '<provider model>' \
  --effort '<provider effort>'
happyherd session side-chat list <parent-session-id>
happyherd session side-chat status <child-session-id>
happyherd session side-chat inspect <child-session-id>
happyherd session side-chat stop <child-session-id>
happyherd session side-chat pause <child-session-id>
happyherd session side-chat close <child-session-id>
happyherd session side-chat close <parent-session-id> --all
happyherd session side-chat reopen <child-session-id>
happyherd session side-chat resume <child-session-id>
```

The six-field delegation brief is required. The parent-ID shorthand remains
supported when it carries the same six options. The daemon persists the
rendered brief as the child's first encrypted queued user message. Parents may
run Claude, Codex, Gemini, Grok, DSH, or Agy. Claude and Codex retain their
provider-native forks. Gemini, Grok, DSH, and Agy launch a fresh same-provider
child on the exact machine and path, seeded through that encrypted brief with
the latest four visible parent messages capped at 6,000 characters. Tools,
thinking, attachments, malformed records, and previous continuation handoffs
are excluded. Add
`--json` to any action for a stable receipt. Create receipts use
`schemaVersion: 2`, preserving every existing lifecycle field while adding a
`resource` object sampled once by the owning daemon at creation. The snapshot
captures CPU busy percentage over a 250 ms window, 1/5/15-minute load averages,
memory used/total/available bytes, swap used bytes, and a `sampledAt` ISO
timestamp. An unavailable metric is `null`, and the overall resource status is
`ok`, `partial`, or `failed`; resource collection never changes an otherwise
successful create. No background monitor, poller, telemetry service, or extra
daemon process is added. Other lifecycle receipts remain `schemaVersion: 1`.
The optional `--model` and `--effort` values are validated by the owning daemon
against the parent provider's current capability catalog before the child is
forked. Invalid or unavailable combinations fail without spawning. Valid
selections use the existing machine-session settings contract, which verifies
that the child persisted the exact effective settings before create reports
success. Omitting both options preserves the existing defaults. Human one-click
creation continues to send only the parent session ID.
A failed receipt sets a nonzero exit code and names the exact failed phase; a
post-spawn `deliver-brief` failure retains the created child ID. `stop` waits
for the daemon-owned
provider process to exit and for server deactivation; `close` then writes
encrypted archived lifecycle metadata and reads the authoritative server state
back. `inspect`, `pause`, and `resume` map to `status`, `stop`, and `reopen`,
while receipts retain canonical action names. `reopen` preserves the same HappyHerd
session and parent lineage. Claude, Codex, and Grok use provider-native resume;
Gemini, DSH, and Agy start a fresh same-provider process seeded from bounded
visible child context. This dedicated path does not re-enable ordinary Gemini
new-session UI. Stopped and archived children remain discoverable
after daemon restarts through the daemon's durable encrypted reconnect store.

The Human starts a side chat in the app with one click and no fields. The app
sends only `parentSessionId` through the dedicated
`happyherd-side-chat-create` RPC, then opens an empty child with its normal
composer. The Main Agent CLI still requires the six fields above and delivers
the brief as the child's first encrypted queued message. Both paths share the
dedicated daemon lifecycle; generic `spawn-happy-session` rejects `isSideChat`
before provider launch.

Then discover the online and offline machines registered to the linked
account:

```bash
happyherd machine list
happyherd machine list --json
```

Create a tracked HappyHerd session on an explicitly selected machine and absolute
path:

```bash
happyherd session create \
  --machine workstation \
  --path /srv/project \
  --provider codex \
  --model gpt-5.6 \
  --effort high \
  --permission plan \
  --commander athena \
  --json
```

`--machine` accepts an exact machine ID or an unambiguous exact hostname from
`machine list`. Machine-list receipts label each entry's `kind`,
`machineSessionProtocolVersion`, `sessionCreateSupported` status, available
providers, and any advertised mode catalogs. `sessionCreateSupported` is true
only when a native HappyHerd CLI daemon
advertises the target-confirmed machine-session protocol used by this command;
upgrade and restart an older target before creating a session. Rig machines use
a separate creation contract and are reported but rejected here. The command
refreshes the exact machine and verifies this marker before any spawn RPC,
rejects an offline target, and validates every explicit mode against that
machine's advertised provider catalog. A provider without a catalog may still
launch with its defaults, but explicit overrides fail closed. It never
substitutes another provider. The path must be absolute for the target operating
system; add `--create-dir` only when you explicitly approve creating a missing
directory on that machine. JSON success returns the tracked HappyHerd session ID,
machine identity, path, and the effective settings validated by the target
daemon and persisted on the new session. A null setting means that dimension
remains owned by the provider runtime because its catalog advertised no
concrete default.

Bind a session during creation using `--commander ID`, validated on the target
daemon. Reassign the association with `set-commander` (which resolves the ID on
the owning machine's canonical registry) or use `none` to detach the Commander.
Changes take effect on the next session resume without altering the live
conversation context.

### After reboot

Run `happyherd daemon status` to inspect the service and `happyherd daemon start`
when starting it is intended. Run it as the same OS account with the same
configured HappyHerd home and provider environment. Use the supported CLI
instead of reading or editing daemon registry files or copying provider tokens.

## Authentication

```bash
happyherd auth login
happyherd auth logout
```

HappyHerd uses cryptographic key pairs for authentication — your private key stays on your machine. All session data is end-to-end encrypted before leaving your device.

To register provider OAuth tokens with the configured HappyHerd server
(requires ordinary HappyHerd sign-in; provider login can also update local
credentials):

```bash
happyherd connect gemini
happyherd connect claude
happyherd connect codex
happyherd connect status
```

### Named provider accounts

HappyHerd supports multiple named local accounts for Claude, Codex, and
GrokBuild. You can configure multiple accounts per provider to manage workflows
when encountering rate limits or quota restrictions. If no named account pool
is configured, HappyHerd retains standard single-account behavior. Account
selection is reactive and lazy, with no background quota polling.
Credential-pool rotation occurs automatically, so there is no toggle in the
interface to enable or disable it. To allow cross-account failover, you must
configure at least two named accounts for the same provider.

```bash
happyherd connect <claude|codex|grok> --acct <nickname>
happyherd accounts list [claude|codex|grok] [--json]
happyherd accounts use <nickname>
happyherd accounts use <provider> <nickname>
happyherd accounts remove <nickname>
happyherd accounts remove <provider> <nickname>
```

When an active account encounters a rate limit or hard quota, HappyHerd marks
the account limited until its provider reset time, stops the running provider
process, and resumes the exact same session using the next available account
with transcript history and runtime context preserved. If all configured
accounts for a provider are limited, execution pauses until the earliest
account becomes eligible again.

### Saved credentials

Saved credentials are the encrypted secrets stored in your HappyHerd account
under Settings > Credentials & Accounts. The `happyherd credentials` commands
use your existing sign-in from `happyherd auth login` without starting the
daemon or launching a login flow.

```bash
happyherd credentials list
happyherd credentials list --json
happyherd credentials run --env EXAMPLE_API_KEY=example-api-key -- ./scripts/deploy.sh
```

The `list` command displays secret-free credential summaries, including name,
type, usage labels, service, username, and ID, and never shows secret values.
The `--json` flag outputs the same secret-free details in JSON format.

The `run` command injects secret values strictly as environment variables into
the specified command. HappyHerd prints no values, never writes them to logs or
command-line arguments, and exits with the command's exit code. It halts before
revealing any value if a reference is unknown or ambiguous, a variable name is
invalid or repeated, the command is missing, or the CLI is not signed in.

### Local task delivery and resume

Use the existing local machine login for local tasks; creation alone sends no
prompt. Keep the returned HappyHerd session ID and send an actual instructions
file, reusing the message ID after an uncertain result:

```text
happyherd session create --local --path ABSOLUTE_PATH --provider PROVIDER --commander ID --json
happyherd session send SESSION_ID --text-file ABSOLUTE_FILE --message-id ID --json
happyherd session inspect SESSION_ID --limit 20 --json
happyherd resume SESSION_ID
```

Send and inspect use the owning local daemon. Resume restores the saved path and
provider state when supported. Preserve original machine/provider state and
session identity; record age alone never invalidates a reconnect record. Omit
`--super-session` for ordinary tasks.

Use category help for safe discovery, including `session --help`,
`session side-chat --help`, `resume --help`, `commander --help`,
`automation --help`, and `server --help`. Do not use provider launch routes such
as `acp --help`, `agy --help`, or `gemini --help` as harmless probes; they can
launch real sessions. Top-level `--help` may invoke `claude --help`.

Automations are machine-local and daemon-owned; even list/history can start the
daemon. See `automation --help` for schedules, execution rails, and distinct
pause/stop-run/abandon-run actions. `server --help` describes local self-hosting:
`--no-persist` avoids default URL settings changes; `--reset` wipes server data.

## Commands

| Command | Description |
|---------|-------------|
| `happyherd` | Start Claude Code session (default) |
| `happyherd codex` | Start Codex mode |
| `happyherd agy` | Start agy (Antigravity CLI) session |
| `happyherd gemini` | Start Gemini CLI session (**deprecated** — use `happyherd agy`) |
| `happyherd grok` | Start GrokBuild through its official ACP interface |
| `happyherd dsh` | Start dsh through ACP |
| `happyherd acp` | Start any ACP-compatible agent |
| `happyherd resume <id>` | Resume a previous session |
| `happyherd session side-chat <action> <id> [brief options] [--all] [--json]` | Create and manage exact-parent side chats for Claude, Codex, Gemini, Grok, DSH, and Agy on their local owning daemon |
| `happyherd credentials list [--json]` | List saved credentials without secret values |
| `happyherd credentials run --env VAR=<name\|id> -- <command>` | Run commands with credentials injected as environment variables |
| `happyherd notify` | Send push notification to your devices |
| `happyherd doctor` | Diagnostics & troubleshooting |
| `happyherd commander guide --json` | Seed missing global/shared guides without overwriting existing content |
| `happyherd automation --help` | Discover machine-local schedule and run operations |
| `happyherd server --help` | Discover local server options |
| `happyherd auth` | Manage ordinary HappyHerd sign-in |
| `happyherd connect` | Register provider tokens or connect named local accounts |
| `happyherd accounts` | List, select, or remove named local provider accounts |
| `happyherd daemon` | Manage the local background service |
| `happyherd sandbox` | Configure OS-level sandboxing |
| `happyherd session inspect SESSION_ID` | Inspect recent private context through the owning local daemon |
| `happyherd session send SESSION_ID --text-file ABSOLUTE_FILE --message-id ID` | Deliver instructions with a stable retry ID |
| `happyherd session ensure-assistant --json` | Reuse the persistent Assistant via local machine login |
| `happyherd commander list` | List Commanders available on this machine |
| `happyherd commander create --manifest <file>` | Atomically install agent-authored Commander content |
| `happyherd machine auth <login\|status\|logout>` | Manage the app-approved account-machine control link |
| `happyherd machine list [--json]` | Discover machines on the current account |
| `happyherd session create ... [--commander ID] [--json]` | Create a tracked session on a selected HappyHerd CLI daemon machine |
| `happyherd session set-commander <session-id> <commander-id\|none> [--json]` | Change the Commander used on the session's next resume |

---

## Commander onboarding

Use **Create Commander** from the HappyHerd Command Palette. It opens a normal,
resumable session where the selected agent interviews you, presents a summary,
and waits for explicit confirmation. The agent authors the identity, memory, and
learning content, then invokes the host-local scaffold command.

The scaffold is intentionally narrow: it validates the manifest and publishes
the canonical `commanders/<id>` tree under the configured HappyHerd home atomically. It does not invent
Commander content, maintain a second registry, restart the daemon, or write
through the HappyHerd server. See [`docs/commander-onboarding.md`](../../docs/commander-onboarding.md)
for the manifest contract and failure guarantees.

---

## Advanced

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HAPPYHERD_SERVER_URL` | Custom server URL (default: `https://api.cluster-fluster.com`) |
| `HAPPYHERD_WEBAPP_URL` | Custom web app URL (default: `https://app.happy.engineering`) |
| `HAPPYHERD_HOME_DIR` | Custom home directory for HappyHerd data (default: `~/.happyherd`) |
| `HAPPYHERD_DISABLE_CAFFEINATE` | Disable macOS sleep prevention |
| `HAPPYHERD_EXPERIMENTAL` | Enable experimental features |

### Sandbox (experimental)

HappyHerd can run agents inside an OS-level sandbox to restrict file system and network access.

```bash
happyherd sandbox configure
happyherd sandbox status
happyherd sandbox disable
```

### Building from source

```bash
git clone https://github.com/NickGuAI/HappyHerd
cd HappyHerd/server
pnpm install --frozen-lockfile
pnpm --filter @happyherd/cli build
```

## Requirements

- Node.js >= 20.0.0
- For Claude: `claude` CLI installed & logged in
- For Codex: `codex` CLI installed & logged in
- For agy: install the Antigravity CLI (`agy`) and log in
- For Gemini (**deprecated** — use agy): `npm install -g @google/gemini-cli` + `happyherd connect gemini`
- For GrokBuild: install the official `grok` CLI and authenticate it with `grok login`

## License

MIT
