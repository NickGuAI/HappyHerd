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
- Codex starts in a dedicated OS sandbox, exposes manifest-declared MCP tools
  plus built-in collaboration tools, and denies shell, filesystem mutation,
  web search, undeclared tools, and custom subagent roles. Every child inherits
  the same governed boundary and cannot expand its authority.
- Provider credentials and the Discord token remain in the trusted bridge.
  The Codex child receives only an opaque local capability.
- Writes require a one-use confirmation bound to the actor, capability, exact
  action hash, and a later Discord turn.
- State stores routing identifiers and delivery receipts, never message text.
- An exact `link <opaque-code>` command is accepted only in DM, sent to the
  signed organization endpoint, and settled without creating an agent session
  or retaining the command/code in bridge state.

## Integration contract

The configured authorization endpoint receives signed Discord source metadata
and returns either a denial or a short-lived grant:

The request body is SHA-256 hashed. The lowercase-hex HMAC-SHA256 signature
covers `agentId + "\\n" + timestamp + "\\n" + nonce + "\\n" + bodyHash`, so
the deployment identity, freshness, replay nonce, and exact JSON body are one
authorization statement.

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

For account linking the same endpoint receives
`requestedCapability: "discord-agent.link"`, the bounded one-time code, and the
same signed source metadata. It returns either `decision: "linked"` with a
bounded safe message or the standard denial shape. Organization-specific code
formats and identity policy stay in the organization service.

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
