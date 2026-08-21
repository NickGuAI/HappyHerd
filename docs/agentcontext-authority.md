# HappyHerd AgentContext authority

HappyHerd has one editable instruction authority: the directory configured by
`HAPPY_HOME_DIR` (normally `~/.happyherd`). It does not fall back to another
state root, a singular `commander/` store, or a second home-level instruction
copy.

## Canonical layout

```text
~/.happyherd/
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── agentcontext/
│   ├── USER.md
│   ├── rules/
│   └── automations/happyherd/<automation-id>/manifest.json
└── commanders/<commander-id>/
    ├── COMMANDER.md
    └── agentcontext/{memory,rules}/
```

The generated prompt combines exactly one global guide, at most one selected
Commander, that Commander's L2 `1-working-memory.md` and L3
`2-long-term-memory.md` when present, and the nearest project `AGENTS.md` (or
`CLAUDE.md` when no `AGENTS.md` exists). Each memory file is capped at 64 KiB;
the bundle records its canonical source path, included/source byte counts, and
whether it was truncated. L1 `0-observations.jsonl` remains on demand and is
never copied into the automatic prompt.

A one-use bundle transports that prompt through the operating system's
temporary directory and is removed after the provider child reads it. It is
never persisted under `~/.happyherd` or treated as a second AgentContext tree.
Other shared and private AgentContext paths remain referenced for on-demand
loading.

Effective precedence is:

```text
provider safety/product policy
→ HappyHerd global AGENTS.md
→ selected COMMANDER.md
→ selected Commander L2/L3 memory (bounded contextual state)
→ closest project guidance
→ on-demand shared/private AgentContext, including L1 evidence
→ user turn
```

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
