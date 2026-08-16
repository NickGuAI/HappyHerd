# PMAI HappyHerd Agent example

This directory shows how an organization can configure the generic
`@happyherd/happyherd-agent` runtime without adding organization-specific
logic to HappyHerd core. PMAI is an example deployment, not a built-in mode.

The example exposes exactly five named capabilities: guide, CRM, Discord,
Luma, and a Canva connector handoff. Gmail and LinkedIn are intentionally
absent. Team members authenticate their own Canva accounts in their personal
agent connector; the Discord runtime receives neither that OAuth grant nor a
shared Canva credential. PMAI's service remains authoritative for team
eligibility, 180-day credential expiry, scopes, resource ownership, and write
confirmation.

Before the first agent turn, the member creates a one-time code in the PMAI
portal and sends the exact `link CODE` command in a bot DM. The generic runtime
forwards only that bounded code and signed Discord source metadata to PMAI's
authorization endpoint; it creates no HappyHerd session for the link command
and persists neither the command nor its code.

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
