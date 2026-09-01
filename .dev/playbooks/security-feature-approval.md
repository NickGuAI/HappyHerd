# Security-feature approval gate

Use this gate before designing or implementing any HappyHerd-owned security
feature. Read-only investigation and proposal-level analysis may identify the
problem and anticipated mechanism.

Before selecting implementation details, branching, implementation, or
delegation:

1. Create a dedicated TickTick task in the list named exactly `In review`.
2. Obtain Nick's explicit approval.
3. Record the approval's exact text or linked evidence in that task.

Task creation, list placement, or silence is not approval. Approval outside
TickTick counts only after its exact text or linked evidence is recorded in the
task. If approval or classification is unclear, treat the change as a security
feature and stop.

## What enters the gate

The gate applies to any HappyHerd-owned mechanism that introduces or expands:

- authentication or authorization;
- encryption or signing;
- integrity or provenance verification;
- credential storage;
- privileged brokering or helping;
- sandboxing or isolation;
- ACL, setuid, or seccomp enforcement;
- security refusal or rollback;
- supervision or other hardening.

The label used for the change does not alter this classification.

The task must state:

- the user problem;
- why unchanged upstream Happy behavior is insufficient;
- the anticipated process, privilege, state, and failure mode; and
- the simplest alternative that adds no new security mechanism.

## Exemptions

Unchanged upstream Happy behavior is exempt only when its source path and
upstream commit or range-diff prove it remains unchanged. Removing a
HappyHerd-only security mechanism is also exempt when the change introduces or
expands no replacement mechanism and preserves upstream Happy behavior.

The repository requirement to record explicit approval in the owning issue and
pull request still applies.
