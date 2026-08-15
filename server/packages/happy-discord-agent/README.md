# PMAI Discord Agent

Trusted Discord-to-HappyHerd client bridge for the PMAI team agent.

```text
Discord Gateway plaintext
        │
        ▼
PMAI Discord bridge
  ├─ signed PMAI actor authorization
  ├─ durable surface/inbound/reply claims
  ├─ actor-bound five-family MCP broker
  └─ happy-agent encrypted control
        │
        ▼
HappyHerd sync server (ciphertext only)
        │
        ▼
dedicated daemon → PMAI Commander → Codex
```

The bridge is a trusted HappyHerd client. Discord and final-agent plaintext are
never added to `happy-server`, its database, or its logs. The local state file
contains routing IDs, status, hashes, and reply receipts only; it does not copy
conversation text.

## Security boundaries

- One Discord bot serves the PMAI team. Human user tokens and self-bots are not
  supported.
- Every inbound event is deduplicated before authorization. PMAI authorization
  is rechecked before a privileged HappyHerd turn.
- Member DMs receive distinct surface, Happy session, native Codex thread,
  PMAI actor, and opaque broker capability bindings.
- Guild threads are shared read-only. Personal operations and every write must
  move to the linked member’s DM.
- Codex receives exactly five PMAI MCP family tools: `pmai_guide`, `pmai_crm`,
  `pmai_luma`, `pmai_discord`, and `pmai_canva`. The broker resolves actor and
  delegation server-side; tool arguments cannot select a different actor.
- PMAI sessions are locked to read-only mode and an OS sandbox. A mandatory
  pre-tool hook denies shell, file mutation, subagents, and every non-PMAI
  local tool; hosted web search and the apply-patch tool are disabled.
- Writes require a one-use, five-minute confirmation tied to the same local
  capability and exact SHA-256 action hash.
- Happy message `localId` plus Discord `nonce`/`enforce_nonce` make replayed
  inbound turns and reply chunks idempotent across reconnects.

## Required Part 1 contract

The bridge calls `POST /api/internal/discord/authorize` with HMAC-signed source
metadata. The service returns either:

```json
{"decision":"deny","code":"not_linked","safeMessage":"Link your PMAI account first."}
```

or an actor/source-bound grant no more than fifteen minutes long:

```json
{
  "decision": "allow",
  "actor": {"pmaiUserId":"...","discordUserId":"..."},
  "mode": "personal",
  "scopes": ["crm.contacts.read"],
  "resources": {},
  "delegation": {"token":"...","expiresAt":1786800000000}
}
```

The PMAI server may call `POST /internal/discord/execute` with the separate
bridge transport bearer for the narrow `channels.list`, `messages.list`,
`messages.send`, and `reactions.add` operations. It never receives the Discord
bot token.

## Configuration

Secrets must be distinct mode-0600 files. Do not put their values in the
environment or command line.

| Variable | Purpose |
|---|---|
| `PMAI_DISCORD_APPLICATION_ID` | Existing PMAI Discord application ID |
| `PMAI_DISCORD_TOKEN_FILE` | Rotated bot token file |
| `PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE` | Post-exposure receipt bound to the installed token hash |
| `PMAI_ACCESS_API_URL` | PMAI capability gateway base URL |
| `PMAI_SERVICE_SIGNING_SECRET_FILE` | HMAC secret for authorization requests |
| `PMAI_BRIDGE_TRANSPORT_SECRET_FILE` | Separate inbound transport service bearer |
| `HAPPY_HOME_DIR` | Dedicated bot HappyHerd home, never a personal home |
| `PMAI_HAPPY_MACHINE_ID` | Dedicated daemon machine ID |
| `PMAI_AGENT_WORKSPACE` | Empty/team-safe Codex workspace |
| `PMAI_BRIDGE_STATE_DIR` | Mode-0700 bridge routing state |
| `PMAI_ALLOWED_GUILD_IDS` | Explicit production guild allowlist |
| `PMAI_ALLOWED_CHANNEL_IDS` | Explicit production channel allowlist |
| `PMAI_BRIDGE_HOST` / `PMAI_BRIDGE_PORT` | Health, broker, and internal transport listener |
| `PMAI_BROKER_URL` | Sandboxed `pmai-broker.localhost` `/mcp` alias for the loopback broker |
| `PMAI_COMMANDER_ID` | Defaults to `pmai-team-agent` |

## Verification

```bash
pnpm --filter @happyherd/pmai-discord-agent typecheck
pnpm --filter @happyherd/pmai-discord-agent test
pnpm --filter happy-agent test
pnpm --filter happy test
```

Production enablement additionally requires a rotated Discord token, Part 1
authorization and provider routes, an isolated Happy account/daemon/Commander,
an isolated Codex home, and live DM plus guild canaries. Bridge credentials and
provider credentials must belong to different dedicated service users. Missing
dependencies fail closed.
