# HappyHerd AgentContext authority

HappyHerd has one editable instruction authority: the directory configured by
`HAPPY_HOME_DIR` (normally `~/.happyherd`). It does not fall back to `.herd`, a
singular `commander/` store, or a second home-level `AGENTS.md`.

## Canonical layout

```text
~/.happyherd/
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── agentcontext/
│   ├── USER.md
│   ├── rules/
│   ├── automations/*.json
│   └── migration-manifest.json
└── commanders/<commander-id>/
    ├── COMMANDER.md
    └── agentcontext/{memory,rules}/
```

The generated prompt combines exactly one global guide, at most one selected
Commander, and the nearest project `AGENTS.md` (or `CLAUDE.md` when no
`AGENTS.md` exists). A one-use bundle transports that prompt through the
operating system's temporary directory and is removed after the provider child
reads it. It is never persisted under `~/.happyherd` or treated as a second
AgentContext tree. Shared and private AgentContext paths are referenced for
on-demand loading.

Effective precedence is:

```text
provider safety/product policy
→ HappyHerd global AGENTS.md
→ selected COMMANDER.md
→ closest project guidance
→ on-demand shared/private AgentContext
→ user turn
```

## Migration

Run a dry inventory first, then apply:

```bash
node scripts/migrate-agentcontext.mjs
node scripts/migrate-agentcontext.mjs --apply
node scripts/check-agentcontext-authority.mjs --verify-migration-snapshot
```

The migration copies only root guidance, shared knowledge, top-level
automation definitions, Commander definitions, memory tiers 0–2, and private
Markdown rules. It excludes credentials, runtime databases, sessions,
transcripts, proposals, run history, telemetry, logs, quests, profiles,
avatars, and ledgers. Automation definitions are copied without their embedded
`history`, `lastRun`, `totalRuns`, or `totalCostUsd` fields. The manifest records
that explicit exclusion, source/destination hashes, every root rewrite, and
normalized knowledge-content parity.

The snapshot flag is a cutover check: it confirms current destination bytes
still match the just-written manifest. Omit it for routine authority checks so
intentional post-cutover edits to canonical `.happyherd` knowledge do not make
the frozen migration record masquerade as a permanent dual-root synchronizer.

`.herd` remains an untouched rollback source after the copy. Once cut over,
edit only `.happyherd`; rerunning the migration is an explicit replacement,
not two-way synchronization.

## Provider acceptance matrix

| Runtime | Instruction layer | Competing project discovery | Fresh / clear | Native resume | Changed context |
|---|---|---|---|---|---|
| Codex | `developerInstructions` on `thread/start`, `thread/resume`, and forced-restart resume | `project_doc_max_bytes=0`; nearest guide is in the bundle | each new thread receives the current bundle | current bundle is supplied again | the same thread resumes with the current bundle; hashes remain provenance only |
| Claude remote | Claude Agent SDK appended system instruction | `settingSources: ['user', 'local']`; project is excluded | every query receives the current bundle | current bundle is supplied on resume | the same session resumes with the current bundle; hashes remain provenance only |
| Claude local/offline | `--append-system-prompt` | `--setting-sources user,local` | each process receives the current bundle | current bundle is supplied on resume | the same session resumes with the current bundle; hashes remain provenance only |
| Gemini | no verified system-layer route in the current adapter | not applicable | non-Commander sessions remain supported | not applicable | Commander sessions fail closed and direct the user to Claude or Codex |

Session metadata records the bundle hash plus a versioned instruction receipt:
provider, delivery layer, and SHA-256 of the actual provider instruction
content. Claude's receipt includes HappyHerd's product-managed system addition.
