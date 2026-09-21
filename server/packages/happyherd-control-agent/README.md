# HappyHerd Agent

CLI client for controlling HappyHerd Coder agents remotely.

Unlike `happyherd-cli` which both runs and controls agents, `happyherd-control-agent` only controls them — listing machines, spawning sessions on a machine, creating sessions, sending messages, reading history, monitoring state, and stopping sessions.

## Library control surface

Trusted services can use the side-effect-free `happyherd-control-agent/control` export
instead of shelling out to the CLI:

```ts
import { HappyHerdControlClient } from 'happyherd-control-agent/control';

const happyherd = HappyHerdControlClient.fromEnvironment();
const session = await happyherd.spawnCodexSession({
  machineId: process.env.HAPPYHERD_MACHINE_ID!,
  directory: '/srv/happyherd-agent/workspace',
  commanderId: 'team-agent',
  permissionMode: 'default',
  runtimeContext: {
    surfaceId: 'dm:123',
    capabilityId: 'opaque-local-capability-id',
    brokerUrl: 'http://127.0.0.1:3210/mcp',
    tools: [{
      name: 'guide',
      family: 'guide',
      description: 'Governed onboarding and access guidance',
    }],
  },
});

const result = await happyherd.sendTurn({
  sessionId: session.id,
  localId: 'discord:source-message-id',
  text: 'Summarize my onboarding status.',
});
```

Spawn and resume runtime context is mapped to four fixed environment values. Callers
cannot pass arbitrary environment variables through this API. `sendTurn()`
subscribes before sending, uses the caller's stable `localId` for server-side
deduplication, and returns only non-thinking text from the correlated root
agent turn. Tool output, ready events, stale turns, and child-agent text are
excluded.

`spawnCodexSession()` and `spawnSessionOnMachine()` retain compatibility with
older daemons whose successful spawn receipt contains only the session ID,
including when callers pass model, effort, or permission options. Callers that
have first verified the target's `machineSessionProtocolVersion` and require a
target-confirmed settings receipt use `spawnSessionOnMachineConfirmed()`.

## Installation

From the monorepo:

```bash
yarn workspace happyherd-control-agent build
```

Or link globally:

```bash
cd packages/happyherd-control-agent && npm link
```

## Authentication

HappyHerd Agent uses account authentication via QR code, the same flow as linking a device in the HappyHerd mobile app.

```bash
# Authenticate by scanning QR code with the HappyHerd mobile app
happyherd-control-agent auth login

# Check authentication status
happyherd-control-agent auth status

# Clear stored credentials
happyherd-control-agent auth logout
```

Credentials are stored at `~/.happyherd/agent.key`.

## Commands

### List sessions

```bash
# List all sessions
happyherd-control-agent list

# List only active sessions
happyherd-control-agent list --active

# Output as JSON
happyherd-control-agent list --json
```

### List machines

```bash
# List all machines
happyherd-control-agent machines

# List only active machines
happyherd-control-agent machines --active

# Output as JSON
happyherd-control-agent machines --json
```

### Spawn on a machine

```bash
# Spawn a session on a specific machine
happyherd-control-agent spawn --machine <machine-id> --path ~/project

# Let the daemon create the directory if needed
happyherd-control-agent spawn --machine <machine-id> --path ~/new-project --create-dir

# Choose a specific agent
happyherd-control-agent spawn --machine <machine-id> --path ~/project --agent codex

# Output as JSON
happyherd-control-agent spawn --machine <machine-id> --path ~/project --json
```

### Session status

```bash
# Get live session state (supports ID prefix matching)
happyherd-control-agent status <session-id>

# Output as JSON
happyherd-control-agent status <session-id> --json
```

### Create a session

```bash
# Create a new session with a tag
happyherd-control-agent create --tag my-project

# Specify a working directory
happyherd-control-agent create --tag my-project --path /home/user/project

# Output as JSON
happyherd-control-agent create --tag my-project --json
```

### Send a message

```bash
# Send a message to a session
happyherd-control-agent send <session-id> "Fix the login bug"

# Send with yolo permissions
happyherd-control-agent send <session-id> "Ship it" --yolo

# Send and wait for the agent to finish
happyherd-control-agent send <session-id> "Run the tests" --wait

# Output as JSON
happyherd-control-agent send <session-id> "Hello" --json
```

### Message history

```bash
# View message history
happyherd-control-agent history <session-id>

# Limit to last N messages
happyherd-control-agent history <session-id> --limit 10

# Output as JSON
happyherd-control-agent history <session-id> --json
```

### Stop a session

```bash
happyherd-control-agent stop <session-id>
```

### Wait for idle

```bash
# Wait for agent to become idle (default 300s timeout)
happyherd-control-agent wait <session-id>

# Custom timeout
happyherd-control-agent wait <session-id> --timeout 60
```

Exit code 0 when agent becomes idle, 1 on timeout.

## Environment Variables

- `HAPPYHERD_SERVER_URL` - API server URL (default: `https://api.cluster-fluster.com`)
- `HAPPYHERD_HOME_DIR` - Home directory for credential storage (default: `~/.happyherd`)

## Session ID Matching

All commands that accept a `<session-id>` support prefix matching. You can provide the first few characters of a session ID and the CLI will resolve the full ID.

Machine-aware commands such as `spawn --machine <machine-id>` also support ID prefix matching.

## Encryption

All machine and session data is end-to-end encrypted. New records use AES-256-GCM with per-record keys. Existing records created by other clients are decrypted using the appropriate key scheme (AES-256-GCM or legacy NaCl secretbox).

## Requirements

- Node.js >= 20.0.0
- A HappyHerd mobile app account for authentication

## Publishing to npm

Maintainers can publish a new version:

```bash
yarn release               # From repo root: choose library to release
# or directly:
yarn workspace happyherd-control-agent release
```

This flow:
- runs tests/build checks via `prepublishOnly`
- creates a release commit and `happyherd-control-agent-vX.Y.Z` tag
- creates a GitHub release with generated notes
- publishes `happyherd-control-agent` to npm

## License

MIT
