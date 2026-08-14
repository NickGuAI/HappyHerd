#!/usr/bin/env python3
"""Run one bounded HappyHerd L1 Observer pass through Codex."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


WORKSPACE = "/home/ec2-user"
HAPPY_HOME = "/home/ec2-user/.happyherd"
NEW_YORK = ZoneInfo("America/New_York")
MAX_WINDOW_DAYS = 14


@dataclass(frozen=True)
class EvidenceWindow:
    since: date
    until: date

    @property
    def days(self) -> int:
        return (self.until - self.since).days + 1

    @property
    def utc_start(self) -> datetime:
        return datetime.combine(self.since, time.min, NEW_YORK).astimezone(timezone.utc)

    @property
    def utc_end_exclusive(self) -> datetime:
        next_day = self.until + timedelta(days=1)
        return datetime.combine(next_day, time.min, NEW_YORK).astimezone(timezone.utc)

    @property
    def label(self) -> str:
        if self.since == self.until:
            return self.since.isoformat()
        return f"{self.since.isoformat()} through {self.until.isoformat()}"


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"invalid ISO date: {value}") from error


def previous_complete_day(now: datetime | None = None) -> date:
    current = now or datetime.now(NEW_YORK)
    if current.tzinfo is None:
        current = current.replace(tzinfo=NEW_YORK)
    return current.astimezone(NEW_YORK).date() - timedelta(days=1)


def resolve_window(
    target_date: date | None,
    since: date | None,
    until: date | None,
    *,
    now: datetime | None = None,
) -> EvidenceWindow:
    if target_date is not None and (since is not None or until is not None):
        raise ValueError("the positional date cannot be combined with --since or --until")
    if (since is None) != (until is None):
        raise ValueError("--since and --until must be provided together")

    if target_date is not None:
        window = EvidenceWindow(target_date, target_date)
    elif since is not None and until is not None:
        window = EvidenceWindow(since, until)
    else:
        default_date = previous_complete_day(now)
        window = EvidenceWindow(default_date, default_date)

    if window.until < window.since:
        raise ValueError("--until must be on or after --since")
    if window.days > MAX_WINDOW_DAYS:
        raise ValueError(
            f"window is {window.days} days; the maximum is {MAX_WINDOW_DAYS} days"
        )
    return window


def build_prompt(window: EvidenceWindow) -> str:
    utc_start = window.utc_start.isoformat().replace("+00:00", "Z")
    utc_end = window.utc_end_exclusive.isoformat().replace("+00:00", "Z")
    prefix_day = window.utc_start.date()
    final_prefix_day = (window.utc_end_exclusive - timedelta(microseconds=1)).date()
    prefix_days: list[str] = []
    while prefix_day <= final_prefix_day:
        prefix_days.append(prefix_day.isoformat())
        prefix_day += timedelta(days=1)
    timestamp_field_regex = (
        r'"timestamp"[[:space:]]*:[[:space:]]*"('
        + "|".join(prefix_days)
        + r')T'
    )
    return f"""# HappyHerd L1 historical Observer

Run one bounded, fully agentic Observer pass for local calendar dates
`{window.label}` in `America/New_York`. The exact timestamp interval is
`[{utc_start}, {utc_end})`.

## Outcome

Scan both native conversation stores, semantically extract the material daily
observation trail at all three tiers, and append it directly to the owning
HappyHerd Commander's L1:

`/home/ec2-user/.happyherd/commanders/<commander-id>/agentcontext/memory/0-observations.jsonl`

This is Observer mode. Write L1 only. L1 is the daily evidence layer, not
distilled memory: it intentionally includes material short-lived work at `low`
as well as project state at `medium` and durable decisions at `high`. Do not
perform L2/L3 distillation, reflection, rule promotion, compaction, or garbage
collection.

## Required context and discovery

1. Read `/home/ec2-user/.happyherd/AGENTS.md`,
   `/home/ec2-user/.happyherd/agentcontext/USER.md`, the workspace router, and
   the installed `commander-memory-cleanup` skill.
2. Discover the live roster from
   `/home/ec2-user/.happyherd/commanders/*/COMMANDER.md`. Do not use a hard-coded
   Commander list, name list, topic dictionary, or keyword classifier.
3. Process one provider and one Commander at a time. Keep working context
   bounded; never load an entire history or all raw messages into model context.
4. Do not spawn subagents.

## Mandatory low-memory scan order

Use a metadata-first, two-stage read. This is an execution constraint, not a
request for a separate scanner or candidate pipeline.

1. Use `rg -l` with this exact timestamp-field regex to identify files that may
   contain in-window records:

   `{timestamp_field_regex}`

   Do not search for bare date strings: prompts and replayed context can mention
   historical dates while their own records are outside the window. After the
   file prefilter, still enforce the exact record interval shown below. Do not
   walk or parse every JSONL file in either store.
2. Claude: inspect only enough metadata to classify each matching file. Exclude
   `agent-*.jsonl` and any session whose in-window records are sidechain records
   (`isSidechain: true`). Never read or summarize excluded sidechain content.
3. Codex: classify a physical rollout from its physical first line only:
   `sed -n '1p' "$file"`. That line is the rollout's own `session_meta`. Exclude
   the file when `.payload.parent_thread_id` is non-empty or
   `.payload.source.subagent` is non-null. Do not run `jq` over the full file to
   find `session_meta`, because replayed child files contain parent metadata
   later. Never read or summarize excluded child-thread content; it replays
   parent history and would multiply evidence.
4. Only after that prefilter, inspect primary sessions. Extract only the count,
   timestamp, and at most the first 240 characters of each user-authored
   message. If every user message is an automation instruction, readiness/test
   probe, status poll, or predecessor-system work, discard the session without
   reading assistant messages. Otherwise inspect each material task: extract
   only the complete user turns and final assistant outcomes needed to record
   what was requested, decided, delivered, fixed, learned, or left open. A task
   does not become noise merely because it completed successfully or produced a
   file. Skip tool calls, tool outputs, reasoning, world state, compacted
   context, system/developer text, attachments, and repeated bootstrap text.
5. Do not print raw-message previews, per-file inventories, session dumps, or
   large diffs. Bound every shell result; a content-extraction command must not
   emit more than 12 KiB. Inspect one primary session at a time when full text is
   required. Keep the completion report aggregated and concise.
6. Form at most one observation at a time. Use narrow `rg` queries against the
   owning Commander's L1 only to enforce the exact rerun guard below. Do not use
   L2, L3, private rules, shared learnings, or project guides as semantic
   suppression lists: those are distilled layers, while L1 records today's
   evidence. Do not recursively search whole repositories or dump complete
   memory files.
7. HappyHerd is the current system. Do not persist predecessor-system product
   state, implementation history, task status, names, or architecture into
   HappyHerd memory. A historical session about a predecessor is a zero-write
   result unless it establishes a system-independent method that still applies;
   phrase such a method without implying that the predecessor is current. This
   exception is narrow: the final observation must be fully de-branded and must
   not retain a predecessor product name, legacy domain or route, issue number,
   naming or migration decision, launch or release status, or product-specific
   artifact. If removing those details removes the substance, write nothing.
8. Partition primary evidence by provider session/thread and New York calendar
   date. Before reading full assistant outcomes for a partition, derive its
   exact idempotency pair:

   - `source = session-observer:<provider>:<YYYY-MM-DD>`
   - `ref = <provider>:<session-or-thread-id>`

   If an L1 record that existed before this run already has both that exact
   source and ref, the partition is already consumed: skip it completely. On
   first consumption, capture every qualifying high, medium, and low observation
   from the partition, normally one compact record per material task or outcome.
   Multiple L1 records may share this partition pair; determine and append the
   full batch before treating the pair as consumed. Do not collapse independent
   tasks into one vague summary, and do not create a cursor or receipt.

   Treat the pair as present only when the combined query actually returns a
   matching line. Do not use the exit status of a pipeline ending in `head`,
   `sed`, or another command that succeeds on empty input. A safe narrow check
   is `rg -F "\"source\":\"$source\"" "$l1" | rg -Fq "\"$ref\""`.

## Evidence window

Inspect records by each record's own timestamp, not only file mtime, in both:

- `/home/ec2-user/.claude/projects/**/*.jsonl`
- `/home/ec2-user/.codex/sessions/**/*.jsonl`

Use the mandatory metadata-first scan order to inspect all primary sessions
with records inside `[{utc_start}, {utc_end})`. Deduplicate replayed or forked
copies by provider session/thread identity and evidence reference without
reading their content. Review
user-authored decisions, corrections, constraints, preferences, and meaningful
assistant outcomes needed to understand them. Never copy a transcript or raw
message wholesale.

Assign evidence to a Commander only when explicit Commander metadata identifies
it, or when cwd/workspace ownership and subject scope make the owner
unambiguous. Skip and report unresolved ownership instead of guessing or mixing
Commander memory.

## Observation filter

Append a compact daily observation whenever a material task or interaction
establishes evidence in one of these tiers:

- `high`: a durable user decision, constraint, correction, reusable method,
  major architecture decision, or operational warning;
- `medium`: active project state, a milestone, a material project decision,
  technical tradeoff, handoff, blocker, or local architecture change; or
- `low`: material daily task flow, a completed deliverable, a specific debug or
  repair outcome, or temporary context worth retaining until weekly GC.

Capture what the user asked and what actually happened, including a concise
result, decision, artifact path, or unresolved next step when it helps future
retrieval. A completed task or generated artifact is valid L1 evidence; summarize
the outcome rather than copying its contents. A specific one-off debug result is
valid `low` evidence even when it is not a reusable methodology.

A partial task is material only when it produced concrete project state, an
artifact, a test result, or a specific debug finding. A request with no assistant
outcome, or an investigation with no finding, deliverable, decision, or concrete
state change, is noise and must not become an observation.

Reject heartbeat, idle/status polling, scheduler ticks, automation bootstrap,
non-material micro-steps, raw tool output, token/cost chatter, repeated status
updates, secrets, credentials, and unnecessary personal data. Suppress exact
rerun duplicates and repeated turns inside the same partition, but do not
suppress an observation because its meaning already appears in L2, L3, a rule,
or a guide. Retention, semantic merging, and promotion belong to the Reflector.
A predecessor-system implementation fact is not a HappyHerd observation merely
because it was important when recorded.
A true no-activity/no-material-task window may be zero-write, but a substantive
completed session should normally yield at least one `low`, `medium`, or `high`
observation.

Before the completion report, audit only the records appended by this run. The
run's final diff must contain no predecessor identifier or predecessor-specific
product fact. Correct the run's own diff if necessary; do not inspect or rewrite
pre-existing observations as part of this Observer pass.

## Write contract

Before processing each partition, search the owning Commander's current L1 for
the exact source and ref pair. Do not search L2/L3 or guides to decide whether
today's evidence deserves an L1 record. Observer is append-only: do not delete,
merge, reorder, or rewrite existing L1 records.

The exact `source` + `ref` pair is also the rerun guard. A second run over the
same provider session/thread and evidence date must be byte-identical at L1.

Append exactly one JSON object per line with exactly these fields:

```json
{{"ts":"<evidence timestamp ISO-8601>","tier":"low|medium|high","text":"<concise fact and why it matters>","source":"session-observer:<claude|codex>:<evidence-date>","refs":["<provider>:<session-or-thread-id>"]}}
```

Use `high` for durable constraints, methods, or major decisions; `medium` for
important current state and tradeoffs; and `low` for material daily task flow,
completed deliverables, specific debug outcomes, and short-lived context that
the weekly Reflector may later expire. Every ref must resolve to real source
evidence inspected in this run.

Do not create candidate JSONL, extracted-message files, stats files, cursors,
receipts, queues, databases, schemas, logs, or other intermediate artifacts. Do
not modify L2, L3, rules, guides, USER.md, COMMANDER.md, tasks, quests,
automations, runtime state, or source transcripts.

## Completion report

Return a concise table covering both providers and every Commander: sessions
inspected, observations appended by tier, duplicates skipped, noise discarded,
ambiguous sessions, and exact L1 files changed. State zero-write results
explicitly. Do not include raw messages or secrets in the report.
"""


def codex_command(codex_binary: str = "codex") -> list[str]:
    return [
        codex_binary,
        "exec",
        "--ephemeral",
        "-C",
        WORKSPACE,
        "--sandbox",
        "workspace-write",
        "-c",
        'approval_policy="never"',
        "-c",
        'model_reasoning_effort="medium"',
        "--skip-git-repo-check",
        "-",
    ]


def run_codex(window: EvidenceWindow, codex_binary: str = "codex") -> None:
    if shutil.which(codex_binary) is None:
        raise FileNotFoundError(f"Codex executable not found: {codex_binary}")

    environment = os.environ.copy()
    environment["HAPPY_HOME_DIR"] = HAPPY_HOME
    print(
        f"Starting HappyHerd Observer for {window.label} "
        f"({window.days} day{'s' if window.days != 1 else ''})",
        flush=True,
    )
    subprocess.run(
        codex_command(codex_binary),
        input=build_prompt(window),
        text=True,
        check=True,
        env=environment,
    )
    print(f"Completed HappyHerd Observer for {window.label}", flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run one date-bounded HappyHerd L1 Observer through Codex."
    )
    parser.add_argument(
        "target_date",
        nargs="?",
        type=parse_date,
        help="single target date in YYYY-MM-DD form",
    )
    parser.add_argument("--since", type=parse_date, help="inclusive start date")
    parser.add_argument("--until", type=parse_date, help="inclusive end date")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        window = resolve_window(args.target_date, args.since, args.until)
        run_codex(window)
    except ValueError as error:
        parser.error(str(error))
    except FileNotFoundError as error:
        print(str(error), file=sys.stderr)
        return 127
    except subprocess.CalledProcessError as error:
        print(
            f"Codex Observer failed for {window.label} with exit code {error.returncode}",
            file=sys.stderr,
        )
        return error.returncode or 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
