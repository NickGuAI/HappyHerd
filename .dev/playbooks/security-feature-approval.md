# Security-feature approval gate

Use this gate before designing or implementing any HappyHerd-owned security
feature. Read-only investigation and proposal-level analysis may identify the
problem and anticipated mechanism.

Before selecting implementation details, branching, implementation, or
delegation:

1. Open or reuse a dedicated GitHub issue that names the security change.
2. Obtain explicit approval from a repository maintainer.
3. Record the approval's exact text, or a link to it, on that issue. Repeat
   the same evidence on the pull request when one exists.

A GitHub issue, label, or silence is not approval. Chat, TickTick, email, or a
private archive counts only after its exact text or linked evidence is copied
onto the public issue. If approval or classification is unclear, treat the
change as a security feature and stop.

Missing TickTick, Kaizen, session-archive overlays, or other private operator
tooling is not a blocker, not missing approval, and not a reason to refuse a
branch. Those tools are optional local conveniences. The collaboration record
is the GitHub issue and pull request.

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

The issue must state:

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
