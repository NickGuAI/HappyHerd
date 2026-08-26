# Happy

Code on the go — control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

```bash
npm install -g happy
```

> Migrated from the `happy-coder` package. Thanks to [@franciscop](https://github.com/franciscop) for donating the `happy` package name!

## Usage

### Claude Code (default)

```bash
happy
# or
happy claude
```

This will:
1. Start a Claude Code session
2. Display a QR code to connect from your mobile device or browser
3. Allow real-time session control — all communication is end-to-end encrypted
4. Start new sessions directly from your phone or web while your computer is online

### More agents

```
happy codex
happy agy        # Antigravity CLI (Gemini's successor)
happy gemini     # deprecated — use `happy agy`
happy grok       # GrokBuild through its official ACP stdio interface
happy openclaw

# or any ACP-compatible CLI
happy acp opencode
happy acp -- custom-agent --flag
```

`happy grok` uses the installed official GrokBuild CLI. Authenticate that CLI
with `grok login` before starting; Happy does not add another login or credential
store. Model and reasoning-effort choices come from GrokBuild's live ACP
catalog. Launch permission choices come from the installed `grok --help`, and
New Session offers them in that native order. If help does not advertise its
choices, Happy exposes only the provider default.

Use `grok --permission-mode MODE` with GrokBuild directly, or
`happy grok --permission-mode MODE` through Happy. The default is `default`.
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

This is a launch-only choice: an active GrokBuild session cannot change it from
Happy. ACP per-tool permission responses, GrokBuild's plan/build operating mode,
and Happy's optional OS sandbox are separate controls. Resume loads the same ACP
conversation on its original online machine. The current GrokBuild integration
does not expose image or audio attachments or session fork.

> **Note on agy permissions:** the agy backend runs `agy --print`, which is
> one-shot and has no interactive approval surface — tool calls proceed
> automatically without ever prompting you. The permission mode you pick in
> Happy only chooses which flag is passed to agy: the default modes use
> `--sandbox`, and the bypass/yolo-style modes (including `acceptEdits`) use
> `--dangerously-skip-permissions`. Neither adds a per-tool approval gate
> inside Happy, so selecting "default" for an agy session does **not** give
> you an approval prompt the way it does for Claude Code.

## Daemon

The daemon is a background service that stays running on your machine. It lets you spawn and manage coding sessions remotely — from your phone or the web app — without needing an open terminal.

```bash
happy daemon start
happy daemon stop
happy daemon status
happy daemon list
```

The daemon starts automatically when you run `happy`, so you usually don't need to manage it manually.

### Keeping the daemon running across reboots

If you want the daemon to come back automatically after a reboot — without opening a `happy` session first — start it from your shell profile so it inherits your normal user session context (PATH, keychain access, OAuth credentials):

```bash
# ~/.zshrc or ~/.bashrc
if [[ -o interactive ]] && [[ -z "$HAPPY_DAEMON_CHECKED" ]]; then
    export HAPPY_DAEMON_CHECKED=1
    () {
        local state=$HOME/.happy/daemon.state.json
        local pid=$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$state" 2>/dev/null | grep -oE '[0-9]+')
        if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
            happy daemon start >/dev/null 2>&1
        fi
    } &!
fi
```

The first interactive shell after a reboot triggers the start; subsequent shells short-circuit because the daemon is already running.

> **macOS users:** prefer this shell-init approach over a `launchd` LaunchAgent. A LaunchAgent runs in an agent domain that is **detached from your GUI/Aqua login session**, which means the bundled `claude-agent-sdk` cannot reach the macOS keychain and silently fails authentication ("Failed to authenticate. API Error: 401 terminated", `duration_api_ms: 0`). If you must use launchd, your wrapper has to read the OAuth access token from `~/.claude/.credentials.json` and export it as `CLAUDE_CODE_OAUTH_TOKEN` before exec'ing the daemon — and you'll need to handle token rotation yourself.

## Authentication

```bash
happy auth login
happy auth logout
```

Happy uses cryptographic key pairs for authentication — your private key stays on your machine. All session data is end-to-end encrypted before leaving your device.

To connect third-party agent APIs:

```bash
happy connect gemini
happy connect claude
happy connect codex
happy connect status
```

## Commands

| Command | Description |
|---------|-------------|
| `happy` | Start Claude Code session (default) |
| `happy codex` | Start Codex mode |
| `happy agy` | Start agy (Antigravity CLI) session |
| `happy gemini` | Start Gemini CLI session (**deprecated** — use `happy agy`) |
| `happy grok` | Start GrokBuild through its official ACP interface |
| `happy openclaw` | Start OpenClaw session |
| `happy acp` | Start any ACP-compatible agent |
| `happy resume <id>` | Resume a previous session |
| `happy notify` | Send push notification to your devices |
| `happy doctor` | Diagnostics & troubleshooting |
| `happy commander list` | List Commanders available on this machine |
| `happy commander create --manifest <file>` | Atomically install agent-authored Commander content |

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
| `HAPPY_HOME_DIR` | Custom home directory for Happy data (default: `~/.happy`) |
| `HAPPY_DISABLE_CAFFEINATE` | Disable macOS sleep prevention |
| `HAPPY_EXPERIMENTAL` | Enable experimental features |

### Sandbox (experimental)

Happy can run agents inside an OS-level sandbox to restrict file system and network access.

```bash
happy sandbox configure
happy sandbox status
happy sandbox disable
```

### Building from source

```bash
git clone https://github.com/slopus/happy
cd happy-cli
yarn install
yarn workspace happy cli --help
```

## Requirements

- Node.js >= 20.0.0
- For Claude: `claude` CLI installed & logged in
- For Codex: `codex` CLI installed & logged in
- For agy: install the Antigravity CLI (`agy`) and log in
- For Gemini (**deprecated** — use agy): `npm install -g @google/gemini-cli` + `happy connect gemini`
- For GrokBuild: install the official `grok` CLI and authenticate it with `grok login`

## License

MIT
