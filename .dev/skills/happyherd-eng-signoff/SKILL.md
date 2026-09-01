---
name: happyherd-eng-signoff
description: "Verify one HappyHerd branch, commit, pull request, or merged change against its owning contract, classify the changed runtime lanes, and determine which build, installation, deployment, or restart is actually required. Use for final engineering sign-off; default to no activation and never restart an unchanged or unapplied lane."
---

# HappyHerd Engineering Sign-Off

## Goal

Prove one delivered revision against its owning contract and state exactly
which effects are complete, required, authorized, deferred, or unnecessary.

## Freeze the sign-off target

Establish before acting:

- the owning TickTick task or explicit owner contract;
- the exact branch, commit, or pull request and its comparison base;
- the complete changed-path set and affected supported callers;
- whether the revision is uncommitted, committed, pushed, merged, installed,
  deployed, or already active;
- explicit authority for any merge, installation, deployment, restart, task
  mutation, or target-host operation; and
- the exact selected artifact and host for every authorized activation.

Start at `.dev/AGENTS.md`. Use `.dev/VERIFY.md` to select checks and
`engineering-review` to review the exact final head against the task contract.
Use `app-verification` when changed-surface verification needs its execution or
evidence procedure. A TickTick write is out of scope unless explicitly
requested; when authorized, use the `ticktick` skill and read the write back.

## Keep proof planes separate

Record each applicable plane independently:

1. source and focused tests;
2. affected-package checks and production build artifacts;
3. exact-head review and pull-request checks;
4. merge and ancestry;
5. installation or deployment of one selected artifact;
6. process activation and owner-interface read-back; and
7. rendered or Human-visible behavior on each targeted surface.

A pass in one plane does not prove another. In particular, a merged commit,
published image, successful build, process presence, or online machine does not
prove that the intended revision is installed, active, healthy, or usable.

## Classify actual changed lanes

Classify from the exact diff and live ownership, not from the task title.

| Lane | Required evidence | Activation rule |
|---|---|---|
| `.dev`, skill, or documentation only | Link/frontmatter/skill validation and applicable repository checks | No runtime deployment or process restart. Perform a selective skill reinstall only when separately authorized. |
| Web/frontend | Happy app checks and production Web export | Never restart the daemon. Deploy/restart only the selected server/Web artifact when explicitly authorized. |
| Central server | Server checks and selected image/build evidence | Deploy and restart only the server lane, and only with explicit authority. |
| One-shot CLI | CLI checks plus installation read-back for the selected source or package | Install only when authorized; do not restart the daemon because no running process loads the change. |
| Daemon-resident CLI | CLI checks, install-path prerequisites, and pre-restart state | Use the maintained stop → upgrade → start sequence only when reload is needed and the exact host restart is authorized. |
| Combined server/Web and daemon-resident CLI | Evidence required by both lanes | When fully authorized, activate server first, then the daemon, through the combined playbook. |
| Combined server/Web and one-shot CLI | Evidence required by the server/Web and one-shot CLI lanes | Activate the authorized server/Web artifact and install the authorized CLI; do not restart the daemon. |
| Mobile, governed agent, installer, or another independent lane | Its owner and checks from routing/SOP guidance | Do not infer a server or daemon restart; activate only that explicitly authorized lane. |

One change may occupy more than one lane. Do not deploy, reinstall, or restart
an unchanged lane. Classify a CLI change as daemon-resident only when current
source proves the running daemon loads it. Frontend-only work requires its
production build/export but never a daemon restart. Documentation and skill
changes require no runtime restart.

## Apply the no-activation default

The default is no merge, installation, deployment, or restart. Verification
may conclude that an effect is required, but that conclusion does not grant
authority to perform it. Cite the current instruction that authorizes every
external action and stop before any action whose target, artifact, or authority
is ambiguous.

When only the server/Web lane changed and activation is authorized, deploy the
selected server/Web artifact through its maintained owner, restart that service
when deployment requires it, and retain image plus health read-back. Do not
touch the daemon.

When only a daemon-resident CLI lane changed and activation is authorized,
first verify the selected source, installer, toolchain, target account, and
environment while the existing daemon remains available. Then follow the
maintained stop → upgrade → start sequence. Restart only when the running
process must reload that change and the exact host restart is authorized. If
the preflight fails, leave the daemon running. Preserve the same host account,
Happy home, environment, machine identity, and provider sessions, then read
daemon and session state back through the supported interface.

## Combined authorized activation

For an explicitly authorized server/Web plus daemon-resident CLI activation,
follow `.dev/playbooks/post-update-restart.md` rather than reproducing its
commands. A server/Web plus one-shot CLI change does not enter this sequence:

1. select and deploy the server/Web artifact first;
2. retain service start time, image identity, and local/public health proof;
3. on each exact daemon host, preserve the owning account and environment,
   then stop, upgrade, and start the daemon;
4. compare exact pre/post session IDs and continue a retained historical
   session when session or recovery behavior changed; and
5. refresh the Web client and verify the existing machine identity, online
   state, paths, provider catalogs, and applicable Human journey.

If server activation fails, leave the daemon unchanged. Never replace a Happy
home, delete a machine, kill provider sessions, or edit runtime databases as a
restart shortcut.

## Sign-off decision

Do not merge unless current authority explicitly includes merge. Do not mark a
task complete unless completion is separately explicit and every owner-visible
acceptance condition is proved. Classify unobservable or unavailable live
evidence as `Unproved`, not as a pass.

Return:

1. **Contract and revision** — owner, exact SHA/PR/base, and changed paths.
2. **Lane decision table** — lane, required proof, result, required activation,
   and authority.
3. **Evidence** — exact commands or owner-interface read-backs, separated by
   proof plane.
4. **Actions performed** — each external action with its cited authority,
   selected artifact, and exact target.
5. **Deferred or unnecessary effects** — including merge, install, deployment,
   restart, task completion, and missing live proof.
6. **Status** — exactly one of `Signed off for review; activation not
   authorized`, `Signed off; no runtime activation required`, `Signed off and
   activated under cited authority`, or `Not signed off`, with the blocking
   evidence when applicable.
