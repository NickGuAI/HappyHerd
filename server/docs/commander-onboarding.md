# Commander onboarding

HappyHerd creates Commanders inside an ordinary agent session. The conversation
is the review and audit surface; the host-local CLI is only the publication
boundary.

## User flow

1. On Web, open the New Session Commander picker and choose **Create
   Commander**. Desktop Web users may alternatively use the Command Palette.
2. Select the target machine and provider as for any other new session.
3. The main agent interviews the user one question at a time for the name, role
   and mission, absolute machine workspace, operating boundaries, and useful
   seed context.
4. The agent presents a final summary and waits for explicit confirmation.
5. The agent authors the exact `COMMANDER.md`, memory, and learning contents in a
   temporary JSON manifest, runs `happy commander create --manifest <file>`,
   verifies the result with `happy commander list`, and removes the manifest.

The interaction remains resumable because it is a normal HappyHerd session. No
server-side workflow or hidden creation state exists.

The touch entry is currently Web-only. Native iOS parity is intentionally
tracked in [HappyHerd issue #85](https://github.com/NickGuAI/HappyHerd/issues/85)
so a future native implementation reuses this same intent and does not create a
second onboarding workflow.

## Manifest contract

```json
{
  "id": "athena",
  "name": "Athena",
  "workspace": "/absolute/workspace/path",
  "role": "Engineering commander",
  "commanderMarkdown": "---\nidentity_and_scope:\n  name: Athena\n  commander_id: athena\n  workspace: /absolute/workspace/path\n  role: Engineering commander\n---\n...",
  "observationsJsonl": "{\"observation\":\"...\"}\n",
  "workingMemoryMarkdown": "# Working memory\n...",
  "longTermMemoryMarkdown": "# Long-term memory\n...",
  "learnings": [
    { "path": "rules/learnings/WORKSPACE.md", "content": "# Workspace\n..." }
  ]
}
```

The semantic fields are agent-authored and visible in the session. The scaffold
does not generate placeholder identity or memory content.

## Publication guarantees

- The Commander id is bounded to a safe directory name.
- The workspace must be absolute.
- The `identity_and_scope` values in `COMMANDER.md` must match the manifest.
- Learning paths must stay inside the Commander's `agentcontext/` directory.
- Creation is serialized per Commander id and never overwrites an existing
  Commander.
- Files are written to a private staging directory and renamed into place only
  after validation and all writes succeed. A failed or interrupted command
  leaves no discoverable partial Commander.
- `HAPPY_HOME_DIR` selects the local machine store. Creation on one machine does
  not publish to any other machine or to the HappyHerd server.

The resulting tree is:

```text
~/.happyherd/commanders/<id>/
├── COMMANDER.md
└── agentcontext/
    ├── memory/
    │   ├── 0-observations.jsonl
    │   ├── 1-working-memory.md
    │   └── 2-long-term-memory.md
    └── rules/
        └── learnings/
            └── <agent-authored learning files>
```

The existing Commander picker reads this filesystem directly. No daemon restart
and no secondary registry are required.
