---
name: commander-memory-cleanup
description: >
  Maintain or migrate one HappyHerd Commander's L2 working memory and L3
  long-term memory from evidence that requires semantic judgment. Use for a
  periodic Commander cleanup, a weekly Reflector run, or a bounded full-corpus
  Claude auto-memory import. Not for deterministic text transformation or
  cross-Commander orchestration inside one agent.
user-invocable: true
argument-hint: '<commander-id|commander-dir> [--mode observer|reflector|claude-import] [--inventory PATH] [--report PATH] [--since YYYY-MM-DD|--days N]'
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Glob
---

# Commander Memory Cleanup

## Goal

Keep one HappyHerd Commander's memory current and durable by having a semantic
agent judge the evidence, while deterministic code is limited to discovery,
invocation, inventory, and verification.

## Inputs

`$ARGUMENTS` must resolve exactly one Commander:

- `commander-id` or `commander-dir` identifies
  `$HAPPY_HOME_DIR/commanders/<id>/`. `HAPPY_HOME_DIR` defaults to
  `$HOME/.happyherd`.
- `--mode observer` produces a read-only classification report.
- `--mode reflector` may rewrite that Commander's L2 and L3 and apply only the
  bounded L1 retention actions defined below. This is the default for periodic
  and weekly cleanup.
- `--mode claude-import` performs one Commander's pass over a bounded Claude
  memory corpus. It requires `--inventory PATH` and `--report PATH`.
- `--since YYYY-MM-DD` or `--days N` optionally bounds volatile evidence for
  observer or reflector mode. It never narrows a Claude import inventory.

An import inventory is caller-produced, read-only input. It must identify each
source root and relative path and record the byte length and SHA-256 digest of
every source file, plus aggregate file and byte counts. Deterministic inventory
code also gives every top-level `MEMORY.md` item an opaque ID and distinguishes:

- `indexed` items containing local Markdown links;
- `inline_only` items whose evidence exists only in `MEMORY.md`; and
- `unindexed` files not reached from any indexed item.

These categories describe source shape, not meaning or Commander ownership.
Treat a malformed or changed inventory as a blocker; do not silently process a
subset.

## Resources And Boundaries

The only memory targets this skill may edit are:

```text
$HAPPY_HOME_DIR/commanders/<id>/agentcontext/memory/0-observations.jsonl  # reflector only
$HAPPY_HOME_DIR/commanders/<id>/agentcontext/memory/1-working-memory.md
$HAPPY_HOME_DIR/commanders/<id>/agentcontext/memory/2-long-term-memory.md
```

Use these sources as needed:

```text
$HAPPY_HOME_DIR/AGENTS.md
$HAPPY_HOME_DIR/agentcontext/USER.md
$HAPPY_HOME_DIR/agentcontext/rules/WORKSPACE.md
$HAPPY_HOME_DIR/agentcontext/rules/learnings/COMMANDER_GUIDE.md
$HAPPY_HOME_DIR/commanders/<id>/COMMANDER.md
$HAPPY_HOME_DIR/commanders/<id>/agentcontext/memory/0-observations.jsonl
```

Read only the shared methodologies, shared learnings, Commander-private rules,
project guides, task artifacts, and authoritative live state needed to judge
the evidence. The HappyHerd operations guide owns current command syntax:
`happy` owns Commanders, sessions, the host daemon, and machine-local
automations; `happyherd` owns governed diagnostics, connections, skill
operations, provider launch, and upgrades. Use those supported interfaces for
machine-owned state instead of reading runtime databases, scheduler state,
logs, credentials, or raw transcripts as files.

The following boundaries are non-negotiable:

- `COMMANDER.md` is immutable in every mode. L1
  `0-observations.jsonl` is byte-immutable in observer and `claude-import`
  modes. A reflector may change staged L1 only to merge same-topic medium
  observations, remove observations already represented in an existing owning
  rule, and remove expired low observations. Every other high/medium record is
  retained; L2/L3 presence alone is never deletion authority. Runtime noise in
  L1 is reported as an Observer contract breach rather than deleted.
  L1 action IDs are SHA-256 digests of the exact JSON record bytes excluding
  the LF or CRLF terminator. Apart from declared record removals/additions, the
  original physical byte layout (including line endings and blank lines) must
  remain exact. A rule-promoted removal must cite a regular owning-rule file
  reached without symlinks beneath the real Commander-private or shared rule
  root; a redirected root, intermediate directory, or final file is invalid.
- Claude import source files and their inventory are immutable.
- Only the selected Commander's mode-authorized staged memory files, the
  caller-designated report, and the precreated `claude-import` coverage sidecar
  may be written. Do not edit another Commander or any shared/project file.
- Shared or project knowledge is report-only. Do not write proposals, promote
  rules, or directly edit `USER.md`, shared learnings, a project guide, or task
  state.
- Do not copy credentials, secret values, raw transcripts, runtime chatter, or
  unnecessary personal detail into memory or reports. Stop and report a
  suspected secret rather than reproducing it.
- A zero-change result is valid when current L2/L3 already express all relevant
  knowledge at the right tier.

## Semantic Judgment Contract

The agent, not a parser or transformation script, decides what each piece of
evidence means and where it belongs:

- `L2` — current operational state that should affect the next relevant task:
  live constraints, active handoffs, owner boundaries, current paths, and
  warnings.
- `L3` — durable Commander-private constraints, decisions with reasons,
  reusable methods, and stable domain knowledge, grouped by topic.
- `REPORT-SHARED` — a reusable cross-Commander candidate, reported with
  evidence and an intended shared target but not written there.
- `REPORT-PROJECT` — a project-specific candidate, reported with evidence and
  its nearest project guide but not written there.
- `DROP` — stale, superseded, duplicated, secret-bearing, irrelevant, or
  low-value material that should not enter L2/L3.

Preserve a current entry when evidence is inconclusive. Remove or rewrite it
only when the evidence supports the judgment. Prefer concise synthesized facts
over copied prose or chronological logs, and retain source dates or paths only
when they materially help later verification.

In `claude-import` mode, examine every source file named by the immutable
inventory and every opaque source item, including the linked files behind
indexed items and every unindexed file. Fill exactly one launcher-enumerated
coverage row per source item ID even when none of its content belongs to this
Commander. The launcher may precreate opaque IDs with empty disposition lists,
but it must never prefill or infer a disposition; every semantic label remains
the agent's judgment. The fact that a file name, directory, or keyword
resembles a Commander is not a semantic routing decision.

## Multi-Commander Execution Boundary

This skill always handles one Commander. A fleet-wide cleanup or migration
must use a deterministic host-side launcher that:

1. discovers the current Commander registry through the supported `happy`
   interface, rejects symlinks anywhere below each canonical Commander root,
   and freezes the exact identity/path roster;
2. builds and freezes the source inventory when an import is requested;
3. starts one fresh, independent agent invocation per Commander with this
   skill, the same inventory, a fresh run nonce, and distinct staged output;
4. precreates only the exact opaque coverage rows with empty dispositions; and
5. mechanically validates process status, the compact report, the completed
   bounded coverage sidecar, byte counts, hashes, allowed write paths, L1
   retention declarations, and immutable-file digests before publishing.

Before and after every audit, before every correction, and at finalization, the
launcher re-discovers the supported roster and compares every live
`COMMANDER.md`/L1/L2/L3 digest with the last successfully published digest.
An added, removed, renamed, redirected, or concurrently changed Commander is a
hard failure; a failed correction never advances the expected digest.

The launcher is a loop that invokes `codex exec`; it must not summarize source
text, prefill coverage dispositions, assign facts to Commanders, generate
memory prose, decide L1 retention, or decide candidate routing. Those are
semantic tasks for the per-Commander agents. Cross-report gap, conflict,
duplication, stale/sensitive exclusion, and singular-ownership review are also
semantic work and require a separate agent; deterministic code may only
inventory, enumerate opaque IDs, stage, invoke, validate declared actions, and
publish validated output.

The installed launcher implements that boundary:

```bash
python3 /home/ec2-user/.claude/skills/commander-memory-cleanup/scripts/memory-reflector.py weekly
python3 /home/ec2-user/.claude/skills/commander-memory-cleanup/scripts/memory-reflector.py migration \
  --inventory /absolute/path/to/source-inventory.json \
  --expected-count 9 \
  --max-concurrency 3 \
  --no-timeout
```

Migration may instead receive every source root with repeated `--source-root`
arguments; the launcher freezes and re-verifies the resulting full inventory.
`--expected-count` is an optional migration guard and is intentionally invalid
for weekly runs. `--max-concurrency` accepts only 1, 2, or 3 (default 1). The
launcher runs initial and correction Commanders in isolated batches no wider
than that bound, continues after an individual worker failure, reconciles
validated publications in the frozen roster order, and never starts a fourth
live child process group. It starts the separate aggregate semantic audit only
after every Commander worker in the current batch has completed. The audit
uses read-only evidence copies of the immutable corpus and every Commander's
before/after L1/L2/L3; the auditor's only writable path is its precreated
coverage sidecar. A
failing valid audit must return the exact Commander IDs to correct; the
launcher starts fresh correction agents only for those IDs and re-audits up to
the finite `--max-correction-rounds` limit. The launcher never interprets audit
prose to choose an agent. Each correction receives an ephemeral, read-only
control context containing the original run's exact L1/L2/L3 bytes, the current
staged/live paths, and a copied prior audit; it never relies on expired paths
from the previous audit workspace.

The aggregate auditor must mark every pre-enumerated opaque source item and
every Commander × L1/L2/L3 × before/after snapshot as examined without changing
their IDs, digests, or order. The launcher validates and hashes that bounded
sidecar; the auditor's final response carries only its nonce/digest/count
attestation. It must also return explicit booleans for item coverage, singular
ownership, unjustified duplication, stale and sensitive exclusion, report-only
candidates, protected files, the allowed change set, and treatment of every
Commander. A pass is valid only when every boolean is true and there are no
blocking findings; every false check maps to a blocking finding and the exact
correction Commander IDs. The full validated audit remains internal for
correction agents. Final stdout exposes only structural audit status, counts,
kinds, and IDs—not finding prose, evidence, or coverage rows.

Each child receives a minimal allowlisted runtime/Codex-auth-location
environment: unrelated provider, Google Workspace, HappyHerd, thread, goal,
and session secrets are absent. Ambient Codex user rules and MCP configuration
are disabled, reasoning is maximum, and the model is explicit
(`gpt-5.6-sol` by default, configurable with `--model`). Writable agents use
only their staged workspace; fixed sandbox flags keep both `/tmp` and
`$TMPDIR` read-only to model tools. Audit evidence remains outside the dedicated
writable output workspace. Codex JSONL is drained under a hard byte cap and the
last message is stat/read capped before parsing; neither is printed.

Without `--no-timeout`, one fleet deadline bounds agents, corrections, and
audits. The installed default is 18,000 seconds (300 minutes); the weekly
HappyHerd automation uses a 21,600-second (360-minute) outer timeout so
termination and reporting retain a 60-minute margin. Explicit `--no-timeout`
disables every per-Commander, correction, audit, and fleet deadline; each child
runs until it completes or the parent receives SIGTERM/SIGINT. A locked active
child registry covers every concurrent process group. Signal and exit cleanup
terminate all registered groups, including TERM-ignoring descendants after a
leader exits, prevent queued workers from launching, and remove ephemeral roots
after workers unwind. Multi-file publication checks the shutdown state and
rolls every replaced file back on any exception or signal, reporting rollback
failure explicitly. Stdout contains only the bounded structured run summary,
and the launcher creates no receipt store.
Each bounded per-Commander summary includes only a structural phase, completed
coverage-row count, and elapsed seconds so a canary can distinguish unfinished
coverage from sealed coverage awaiting a compact final response.

## Output Contract

Observer and reflector runs return a concise report. Claude imports must also
write the caller-designated structured report. Coverage sidecars are ephemeral
internal artifacts, never published into Commander memory or included in
public stdout. A caller-supplied stricter schema may add fields, but every
report must make these facts decidable:

- mode and Commander ID/name;
- files examined and the mode-authorized L1/L2/L3 files changed, if any;
- counts of material kept in or added to L2, added to L3, reported for shared
  or project review, and dropped;
- source evidence for each reported shared/project candidate;
- unresolved uncertainty and blockers, without secret values;
- L1 and `COMMANDER.md` before/after SHA-256 digests;
- L2/L3 before/after SHA-256 digests and whether each changed; and
- verification performed and its result.

The agent chooses and writes every shared/project candidate. The launcher then
mechanically derives the `shared_reported` and `project_reported` counts from
those final candidate-array lengths; the model does not emit a redundant count
that could disagree with its semantic output. Summaries are non-empty bounded
single lines. Evidence references are absolute paths, lowercase SHA-256 IDs,
or typed `kind:value` references without whitespace in the value. The terminal
schema engine's end-anchor admits one final LF; before validation or retention,
the launcher removes only that schema-permitted terminator from these bounded
summary/reference fields. Embedded or repeated line endings, CR/CRLF endings,
oversized strings, and otherwise invalid values remain unchanged and fail
closed. Secret scanning remains mandatory after canonicalization.

An import's bounded sidecar contains exactly one sorted row per opaque source
item ID with one or more agent-chosen disposition labels. Its compact final
report records the inventory digest, expected and examined file/byte/item
counts, indexed/inline-only/unindexed item counts, fresh run nonce, exact
sidecar digest, and final staged L1/L2/L3 digests. It must not claim success if
coverage, binding fields, or source digests differ.

## Acceptance Criteria

- Exactly one Commander's mode-authorized memory files are in scope, and every
  changed statement is a semantic synthesis supported by examined evidence.
- L2 contains only current high-signal operational state; L3 contains concise,
  topic-grouped durable Commander-private knowledge.
- Migration L1, `COMMANDER.md`, import sources, and the inventory are
  byte-identical to their pre-run versions. Reflector L1 changes exactly match
  declared and mechanically validated retention actions.
- No file outside the mode-authorized staged memory and ephemeral coverage
  sidecar paths changed.
- Shared/project candidates appear only in the report; no proposal, rule,
  guide, task, or other Commander's memory was written.
- Import item coverage, category counts, file/byte counts, and digests exactly
  match the immutable inventory.
- The independent aggregate auditor examines every immutable source item and
  every Commander's before/after memory, completes the exact bounded coverage
  sidecar and compact attestation plus semantic check set, and the final audit
  passes after no more than the configured correction rounds.
- Initial and correction agents use at most the explicit 1..3 concurrency
  bound; aggregate audit begins only after the batch is complete, and public
  Commander/correction output remains in frozen roster order.
- With `--no-timeout`, no Commander, correction, aggregate-audit, or fleet
  deadline is applied; parent signals still terminate every active child group
  and prevent publication after shutdown begins.
- Secret-pattern scanning and a final diff/readback complete without exposing
  secret values.
- Terminal output that satisfies its generated schema cannot later fail only
  because the launcher applies an undocumented count or privacy grammar; the
  one provider-permitted terminal-LF representation is normalized explicitly.
- The report satisfies the Output Contract. Zero L2/L3 changes still satisfy
  the run when the evidence supports that result.

Verification is deterministic and fail-closed: compare file lists, byte
counts, allowed paths, hashes, report structure, and scan exit status. It may
reject an invalid run, but it must never repair prose or make a semantic
classification on the agent's behalf.
