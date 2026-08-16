# PMAI HappyHerd Agent example

This directory shows how an organization can configure the generic
`@happyherd/happyherd-agent` runtime without adding organization-specific
logic to HappyHerd core. PMAI is an example deployment, not a built-in mode.

The example exposes exactly five governed capabilities: guide, CRM, Discord,
Luma, and Canva. Gmail and LinkedIn are intentionally absent. Team members
authenticate their own Canva accounts through the PMAI service; the agent never
receives a shared Canva credential. PMAI's service remains authoritative for
team membership, 180-day credential expiry, scopes, resource ownership, and
write confirmation.

```text
Discord member
      │ message
      ▼
PMAI HappyHerd Agent example
      │ actor-bound capability + declared tool
      ▼
generic happyherd-agent broker
      │ short-lived delegation
      ▼
PMAI Access API ──→ guide / CRM / Discord / Luma / member-owned Canva
```

To adapt this example, copy `agent.env.example`, `agent-manifest.json`, and the
`happy-home/` and `workspace/` context into an operator-owned deployment
profile. Replace every placeholder, install secrets as separate mode-0600
files, and keep all organization-specific material outside the generic
`packages/`, `scripts/`, and `deploy/` contracts.
