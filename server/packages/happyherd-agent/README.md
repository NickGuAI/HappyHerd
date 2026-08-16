# HappyHerd Agent

`@happyherd/happyherd-agent` is a generic, governed Discord-to-HappyHerd
runtime. One organization-owned Discord bot can serve many linked users while
the organization API remains the authority for identity, scope, resources,
delegation, and write confirmation.

```text
Discord → agent bridge → encrypted HappyHerd session → Codex
              │                                  │
              └─ service authorization           └─ manifest-only MCP tools
                         │                                  │
                         └──────── capability broker ───────┘
```

The runtime contains no organization-specific tool names or API routes. A
validated JSON manifest supplies tool names, families, descriptions, operation
paths, scopes, and read/write policy. See
`examples/pmai-happyherd-agent/` for one concrete integration.

## Security boundary

- Human Discord user tokens and self-bots are unsupported.
- Every message is deduplicated before authorization; privileged turns are
  reauthorized and delegated for at most fifteen minutes.
- DMs bind one service subject to one capability and one HappyHerd session.
  Guild surfaces are shared and read-only.
- Codex starts in a dedicated OS sandbox, exposes only manifest-declared MCP
  tools, and denies shell, filesystem mutation, subagents, web search, and
  undeclared tools.
- Provider credentials and the Discord token remain in the trusted bridge.
  The Codex child receives only an opaque local capability.
- Writes require a one-use confirmation bound to the actor, capability, exact
  action hash, and a later Discord turn.
- State stores routing identifiers and delivery receipts, never message text.

## Integration contract

The configured authorization endpoint receives signed Discord source metadata
and returns either a denial or a short-lived grant:

```json
{
  "decision": "allow",
  "actor": { "subjectId": "member-123", "discordUserId": "456" },
  "mode": "personal",
  "scopes": ["contacts.read"],
  "resources": {},
  "delegation": { "token": "opaque", "expiresAt": 1893456000000 }
}
```

The organization service may call `POST /internal/discord/execute` with the
separate transport bearer for bounded channel/message/reaction operations. It
never receives the Discord bot token.

Configuration uses `HAPPYHERD_AGENT_*` variables. Secrets are distinct
mode-0600 files; the tool manifest is a non-secret read-only JSON file. The
generic deployment profile is `deploy/happyherd-agent.env.example`.

## Verification

```bash
pnpm --filter @happyherd/happyherd-agent typecheck
pnpm --filter @happyherd/happyherd-agent test
pnpm --filter happy-agent test
pnpm --filter happy test
```
