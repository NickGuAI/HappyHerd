---
name: happyherd-session-archive
description: >-
  Export this machine's AI coding sessions (Claude Code, Codex, DSH, OpenCode)
  into a private unified Markdown archive and search it, lexically first and
  semantically second, citing verbatim excerpts. Used by every HappyHerd
  session for "we already did/decided/discussed this" questions and by the
  session-archive-sync automation for the daily incremental export.
---

# HappyHerd Session Archive

One private Markdown archive of every AI coding session on this machine, so
any agent can retrieve prior work, decisions, corrections, and the user's
stated preferences without depending on one vendor's history surface.

Adapted from grapeot's ai_session_export and AI Session Search & Archive
workflow. Upstream repos (already cloned, upstream-synced):
the exporter and semantic-search clones named in the private overlay.

## Machine parameters

Host-specific values — the archive root, state file, semantic cache directory,
exporter clone locations, per-source coverage, and provider retention notes —
live in a PRIVATE overlay outside this public repository:

`$HAPPY_HOME_DIR/agentcontext/rules/skills/session-archive.local.md`

Read the overlay first; every `<archive root>`, `<exporter dir>`, and
`<semantic-search dir>` placeholder below resolves from it. Do not add
host paths, hostnames, or coverage details to this public file.


## Export (incremental)

Run per source; `--source all` aborts on the absent second-mind file. Never
pass `--full`; never edit provider stores or archive files by hand. A live
session rewrites one stable file as it grows; a resumed session may add a
`_N`-suffixed near-duplicate (known upstream limitation — dedupe by session
when counting).

```bash
cd "<exporter dir>"
PY="$(uv python find 3.12)"
for src in opencode dsh claude-code codex; do
  nice -n 10 ionice -c3 "$PY" export_sessions.py --source "$src" \
    --base-dir "<archive root>" \
    --state-file "<archive root>/.export_state.json"
done
```

Each file: YAML frontmatter (`source`, `session_id`, `title`, `date`,
`message_count`, `project_directory`, `models_used`, per-turn `turn_models`),
then alternating `## User [HH:MM]` / `## Assistant [HH:MM]`. Tool output,
sub-agent chatter, and system reminders are already filtered out.

## Retrieval

Search the archive whenever a request refers to prior work, decisions,
corrections, or conversations ("we already did", "last time", "as I told
you"), asks about Nick's preferences or judgment, or needs the exact wording
of earlier feedback.

### 1. Lexical first — named things

Names, projects, dates, session ids, distinctive phrases. Expand remembered
wording into variants; a truncated result is not proof of absence.

```bash
rg -i -n --glob '*.md' 'phrase|variant one|variant two' \
  "<archive root>"/{claude_code,codex,dsh,opencode}/
```

When the user names a source, search only that directory; otherwise all four.

### 2. Semantic second — approximate memories

Generate the file list fresh at query time (it is also the result allowlist —
a stale list silently hides files). Read-only lookups pass `--no-refresh`;
index refresh is the automation's job.

```bash
FILELIST="$(mktemp)"; trap 'rm -f "$FILELIST"' EXIT
rg --files "<archive root>"/{claude_code,codex,dsh,opencode}/ -g '*.md' > "$FILELIST"
"<semantic-search dir>"/.venv/bin/semantic-search query \
  --file-list "$FILELIST" \
  --cache-dir "<archive root>/.semantic-cache" \
  --query 'the remembered concept' --top-k 10 --no-refresh
```

Setup (once) and full contract: the semantic-search clone's `skills/skill_semantic_search.md`.
`OPENAI_API_KEY` comes from the credentials file named in the private overlay;
never write it to disk or output.

### Result contract

- Group hits by source and session id so one session appears once.
- Show title, date, source, project directory when available, and a verbatim
  excerpt the user can verify. Never replace evidence with an AI summary; do
  not display embedding scores.
- The archive is private. Never copy transcripts into shared context, memory
  files, or external outputs; keep archive paths out of anything outbound.

### Freshness

The archive lags live sessions by up to one day. If the target session is
newer than the last `session-archive-sync` run (automation history is the
authority), read the provider's native store directly instead of forcing an
export.

## Automation

`session-archive-sync` (codex rail, daily 00:05 America/New_York, workspace =
archive root): one incremental export pass as above, then refresh the semantic
index (`rg --files` fresh list → `semantic-search query --top-k 1` with
refresh enabled, or `rebuild` after large imports). Report per-source
scanned/exported counts, failures, refreshed-chunk count, and elapsed time —
never transcript text, session titles, or archive paths.

## Acceptance

A retrieval is complete when the correct source scope was searched, lexical
variants preceded semantic fallback, the semantic file list was generated
fresh, duplicates were consolidated by session, and every cited hit carries
source + date + file path + verbatim excerpt.
