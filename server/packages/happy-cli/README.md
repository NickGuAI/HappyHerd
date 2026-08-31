# HappyHerd CLI

The official command-line interface for HappyHerd, published as `@happyherd/cli`.
Control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

```bash
npm install -g @happyherd/cli@latest
```

HappyHerd preserves the full history of upstream Happy. The upstream project
previously migrated from `happy-coder`; thanks to
[@franciscop](https://github.com/franciscop) for donating its historical
`happy` package name.

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
with `grok login` before starting; Happy does not add another login or credential
store. Model and reasoning-effort choices come from GrokBuild's live ACP
catalog. Launch permission choices come from the installed `grok --help`, and
New Session offers them in that native order. If help does not advertise its
choices, Happy exposes only the provider default.

Use `grok --permission-mode MODE` with GrokBuild directly, or
`happyherd grok --permission-mode MODE` through Happy. The default is `default`.
Happy forwards the selection verbatim and starts
`grok --no-auto-update --permission-mode MODE agent stdio`.

| Mode | GrokBuild launch behavior |
|------|----------------------------|
| `default` | Run read-only and pre-approved tools; ask before other actions. |
| `acceptEdits` | Approve file edits; ask before other actions. |
| `auto` | Run calls allowed by GrokBuild's safety check; block or escalate other calls. |
| `dontAsk` | Run only pre-approved and built-in read-only tools; deny other calls without prompting. |
| `bypassPermissions` | Generally approve tool calls; deny rules, hooks, and shell ask rules still apply. |
| `plan` | Compatibility permission value forwarded as-is; GrokBuild's live plan operating mode is separate. |

When an active GrokBuild permission mode changes, Happy validates it against the
original machine's current catalog, restarts the tracked Grok process, and
resumes the same ACP conversation. The visible mode changes only after the
relaunch is confirmed. ACP plan/build operating mode and Happy's optional OS
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

Link account-wide machine control once from the Happy app. This key is stored
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
  --handoff '<result and evidence to return>'
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
rendered brief as the child's first encrypted queued user message. Add
`--json` to any action for a stable receipt. A failed receipt sets a nonzero
exit code and names the exact failed phase; a post-spawn `deliver-brief`
failure retains the created child ID. `stop` waits for the daemon-owned
provider process to exit and for server deactivation; `close` then writes
encrypted archived lifecycle metadata and reads the authoritative server state
back. `inspect`, `pause`, and `resume` map to `status`, `stop`, and `reopen`,
while receipts retain canonical action names. `reopen` resumes the same Happy
session and parent lineage. Stopped and archived children remain discoverable
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

Create a tracked Happy session on an explicitly selected machine and absolute
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
only when a native Happy CLI daemon
advertises the target-confirmed machine-session protocol used by this command;
upgrade and restart an older target before creating a session. Rig machines use
a separate creation contract and are reported but rejected here. The command
refreshes the exact machine and verifies this marker before any spawn RPC,
rejects an offline target, and validates every explicit mode against that
machine's advertised provider catalog. A provider without a catalog may still
launch with its defaults, but explicit overrides fail closed. It never
substitutes another provider. The path must be absolute for the target operating
system; add `--create-dir` only when you explicitly approve creating a missing
directory on that machine. JSON success returns the tracked Happy session ID,
machine identity, path, and the effective settings validated by the target
daemon and persisted on the new session. A null setting means that dimension
remains owned by the provider runtime because its catalog advertised no
concrete default.

Bind a session during creation using `--commander ID`, validated on the target
daemon. Reassign the association with `set-commander` (which resolves the ID on
the owning machine's canonical registry) or use `none` to detach the Commander.
Changes take effect on the next session resume without altering the live
conversation context.

### Keeping the daemon running across reboots

If you want the daemon to come back automatically after a reboot — without opening a `happyherd` session first — start it from your shell profile so it inherits your normal user session context (PATH, keychain access, OAuth credentials):

```bash
# ~/.zshrc or ~/.bashrc
if [[ -o interactive ]] && [[ -z "$HAPPY_DAEMON_CHECKED" ]]; then
    export HAPPY_DAEMON_CHECKED=1
    () {
        local state=$HOME/.happyherd/daemon.state.json
        local pid=$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$state" 2>/dev/null | grep -oE '[0-9]+')
        if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
            happyherd daemon start >/dev/null 2>&1
        fi
    } &!
fi
```

The first interactive shell after a reboot triggers the start; subsequent shells short-circuit because the daemon is already running.

> **macOS users:** prefer this shell-init approach over a `launchd` LaunchAgent. A LaunchAgent runs in an agent domain that is **detached from your GUI/Aqua login session**, which means the bundled `claude-agent-sdk` cannot reach the macOS keychain and silently fails authentication ("Failed to authenticate. API Error: 401 terminated", `duration_api_ms: 0`). If you must use launchd, your wrapper has to read the OAuth access token from `~/.claude/.credentials.json` and export it as `CLAUDE_CODE_OAUTH_TOKEN` before exec'ing the daemon — and you'll need to handle token rotation yourself.

## Authentication

```bash
happyherd auth login
happyherd auth logout
```

Happy uses cryptographic key pairs for authentication — your private key stays on your machine. All session data is end-to-end encrypted before leaving your device.

To connect third-party agent APIs:

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

## Commands

| Command | Description |
|---------|-------------|
| `happyherd` | Start Claude Code session (default) |
| `happyherd codex` | Start Codex mode |
| `happyherd agy` | Start agy (Antigravity CLI) session |
| `happyherd gemini` | Start Gemini CLI session (**deprecated** — use `happyherd agy`) |
| `happyherd grok` | Start GrokBuild through its official ACP interface |
| `happyherd acp` | Start any ACP-compatible agent |
| `happyherd resume <id>` | Resume a previous session |
| `happyherd session side-chat <action> <id> [brief options] [--all] [--json]` | Create a briefed Worker Agent conversation or list, status/inspect, stop/pause, close, and reopen/resume exact Claude/Codex child side chats on their local owning daemon |
| `happyherd notify` | Send push notification to your devices |
| `happyherd doctor` | Diagnostics & troubleshooting |
| `happyherd commander list` | List Commanders available on this machine |
| `happyherd commander create --manifest <file>` | Atomically install agent-authored Commander content |
| `happyherd machine auth <login\|status\|logout>` | Manage the app-approved account-machine control link |
| `happyherd machine list [--json]` | Discover machines on the current account |
| `happyherd session create ... [--commander ID] [--json]` | Create a tracked session on a selected Happy CLI daemon machine |
| `happyherd session set-commander <session-id> <commander-id\|none> [--json]` | Change the Commander used on the session's next resume |

---

## Commander onboarding

Use **Create Commander** from the HappyHerd Command Palette. It opens a normal,
resumable session where the selected agent interviews you, presents a summary,
and waits for explicit confirmation. The agent authors the identity, memory, and
learning content, then invokes the host-local scaffold command.

The scaffold is intentionally narrow: it validates the manifest and publishes
the canonical `~/.happyherd/commanders/<id>` tree atomically. It does not invent
Commander content, maintain a second registry, restart the daemon, or write
through the HappyHerd server. See [`docs/commander-onboarding.md`](../../docs/commander-onboarding.md)
for the manifest contract and failure guarantees.

---

## Advanced

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HAPPY_SERVER_URL` | Custom server URL (default: `https://api.cluster-fluster.com`) |
| `HAPPY_WEBAPP_URL` | Custom web app URL (default: `https://app.happy.engineering`) |
| `HAPPY_HOME_DIR` | Custom home directory for Happy data (default: `~/.happyherd`) |
| `HAPPY_DISABLE_CAFFEINATE` | Disable macOS sleep prevention |
| `HAPPY_EXPERIMENTAL` | Enable experimental features |

### Sandbox (experimental)

Happy can run agents inside an OS-level sandbox to restrict file system and network access.

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
