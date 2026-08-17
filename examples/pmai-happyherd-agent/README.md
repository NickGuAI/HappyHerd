# PMAI HappyHerd Agent example

This directory shows how an organization can configure the generic
`@happyherd/happyherd-agent` runtime without adding organization-specific
logic to HappyHerd core. PMAI is an example deployment, not a built-in mode.

## Separate local launcher example

The employee's local issuer connection is separate from this Discord bridge:

```text
happyherd doctor
happyherd connect https://www.pioneeringminds.ai
happyherd install-skills --issuer https://www.pioneeringminds.ai
happyherd launch codex
```

The uploaded team Skill describes the workflow, but a web-only Claude sandbox
cannot execute the employee's local scripts or provider registry. The local
HappyHerd install is therefore the execution surface. A Skill invokes its
verified tool through the generic bridge, for example:

```text
happyherd run-tool --issuer https://www.pioneeringminds.ai \
  --skill pmai-crm --script scripts/pmai_crm.py -- readiness
```

No PMAI token is placed in the agent environment or command line. HappyHerd
reads the connected credential from the OS secret store and provides only
`HAPPYHERD_ACCESS_TOKEN` to the verified child process.

The launcher discovers the public protocol at
`https://www.pioneeringminds.ai/.well-known/happyherd.json`. The employee does
not paste a PMAI credential into the terminal command, Discord, or an agent
conversation. `issuer.example.json` records only the public discovery entry;
authorization endpoints and permissions remain server-discovered.

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
