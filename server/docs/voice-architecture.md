# Voice Architecture

HappyHerd has two distinct voice paths: OpenAI speech-to-text dictation for
editable composer drafts, and the retained ElevenLabs realtime assistant. The
active-chat composer microphone owns dictation only; it does not start a
realtime voice conversation.

## Components

```text
SessionView.tsx            UI — active-chat dictation and realtime status host
useVoiceDictation.ts       Dictation recording, transcription, cancel, error, retry
apiVoice.ts                POST /v1/voice/transcriptions transport
AgentInput.tsx             Composer dictation controls and feedback
RealtimeSession.ts         Lifecycle — start/stop, token fetch, session routing state
RealtimeVoiceSession.tsx   Native ElevenLabs bridge (useConversation hook)
RealtimeVoiceSession.web.tsx  Web ElevenLabs bridge (same interface)
voiceHooks.ts              Context delivery — formats and routes app events to voice agent
contextFormatters.ts       Text formatters for session context, messages, permissions
realtimeClientTools.ts     Tool implementations the voice agent can invoke
voiceConfig.ts             Feature flags and constants
storage.ts                 Global state (realtimeStatus, realtimeMode)
types.ts                   Shared type definitions
```

## Composer Dictation

When `useVoiceInputAvailability.available` is true, the active-session composer
passes its microphone control to `useVoiceDictation`. Recorded audio goes to
`POST /v1/voice/transcriptions`; the returned text is appended to any existing
`MultiTextInput` draft, remains editable and unsent, and continues through the
existing `useDraft` persistence path. `AgentInput` keeps finish, cancel,
transcribing, error, and retry states reachable throughout the recording
lifecycle.

```text
composer mic → useVoiceDictation → POST /v1/voice/transcriptions
                                      │
                                      ▼
existing draft + transcript → editable, unsent composer
```

This flow does not call `startRealtimeSession` or
`POST /v1/voice/conversations`. The realtime modules and status pill remain a
separate subsystem; the pill can still end an already active realtime session.

## Session Routing

The module-level `currentSessionId` in `RealtimeSession.ts` tracks the session
whose context is currently presented to the voice agent. `voiceHooks.onSessionFocus()`
compares it to avoid sending the same focus update twice. Navigating to a
different session updates the context; tool routing uses explicit identifiers.

```text
Realtime caller starts Session A
  │
  └──→ currentSessionId = "A"

User navigates to Session B
  │
  └──→ voiceHooks.onSessionFocus("B") → context focus = "B"

Voice agent calls sendMessageToSession({ sessionId: "A", message })
  └──→ sync.sendMessage("A", message, { source: 'voice' })

Voice agent calls processPermissionRequest({ requestId, decision })
  └──→ find the session owning requestId → allow or deny that request
```

## Voice Start

When the voice session starts, `onVoiceStarted(sessionId)` builds an initial prompt containing:

1. **Session directory** — one-liner per active session (id + summary), so the agent knows all available targets.
2. **Current session context** — full dump via `injectSessionContext(sessionId)`: session metadata, path, summary, and message history.

```text
onVoiceStarted("A")
  │
  ├──> formatSessionDirectory()
  │      → "Available sessions:\n- abc: "Refactor auth"\n- def: "Fix dark mode""
  │
  └──> injectSessionContext("A")
         → "# Session ID: abc\n# Project path: ...\n## History\n..."
```

## Context Delivery

App events are delivered to the voice agent through two channels with different semantics:

### sendContext() — silent background injection

Calls `voice.sendContextualUpdate()`. The agent receives the information but does **not** respond. Always sent immediately, never queued.

Used for: new messages, session focus changes, session online/offline, full session dumps.

### sendPrompt() — triggers agent response

Calls `voice.sendTextMessage()`. Acts as a user turn — the agent will respond. **Queued while anyone is speaking**, flushed as a single batch when mode transitions to `idle`.

Used for: permission requests, ready events (agent finished working).

### Batching

When the user or agent is speaking, prompts queue up in `pendingPrompts[]`. A zustand subscription on `realtimeMode` triggers `flushPendingPrompts()` when mode returns to `idle`, joining all queued prompts into a single `sendTextMessage` call.

```text
realtimeMode = 'agent-speaking'
  │
  ├── onReady("abc")        → sendPrompt() → queued
  ├── onPermission("abc")   → sendPrompt() → queued
  ├── onMessages("abc")     → sendContext() → sent immediately
  │
  v
realtimeMode → 'idle'
  │
  v
flushPendingPrompts()
  └──> voice.sendTextMessage(joined prompts)
```

### Session Context Injection

`injectSessionContext(sessionId)` is the shared code path for injecting full session context. It is used by both `onVoiceStarted` (to build the initial prompt string) and `onSessionFocus` (to send a contextual update). It tracks which sessions have already been shown via `shownSessions` to avoid redundant dumps.

## Realtime Mode

`realtimeMode` in storage tracks who is currently speaking:

| Mode | Meaning | Source |
|------|---------|--------|
| `idle` | Nobody is talking | Default / after speech ends |
| `agent-speaking` | ElevenLabs agent is producing audio | `onModeChange({ mode: 'speaking' })` |
| `user-speaking` | User mic VAD is above threshold | `onVadScore({ vadScore })` |

Priority: `agent-speaking` > `user-speaking` > `idle`. If both fire simultaneously, agent wins (user speech during agent output is likely crosstalk).

### VAD Detection

ElevenLabs provides `onVadScore({ vadScore: number })` — a continuous 0-1 signal for user microphone activity. We derive a binary state with debounce:

- `vadScore > VAD_THRESHOLD` (0.5) → `user-speaking`, reset silence timer
- `vadScore <= VAD_THRESHOLD` → start silence timer (`VAD_SILENCE_MS` = 300ms), transition to `idle` on timeout

Agent mode changes (`onModeChange`) take priority over VAD. When `onModeChange` reports `'speaking'`, we set `agent-speaking` regardless of VAD. When it reports `'listening'`, we defer to VAD state.

```text
ElevenLabs SDK
  │
  ├── onModeChange({ mode: 'speaking' })
  │     └──> realtimeMode = 'agent-speaking'
  │
  ├── onModeChange({ mode: 'listening' })
  │     └──> realtimeMode = (VAD active ? 'user-speaking' : 'idle')
  │
  └── onVadScore({ vadScore })
        └──> if agent not speaking:
               vadScore > 0.5 → 'user-speaking'
               vadScore ≤ 0.5 → debounce → 'idle'
```

## Voice Agent Tools

The voice agent can invoke these client tools (defined in `realtimeClientTools.ts`):

- **sendMessageToSession(sessionId, message)** — sends a text message to the specified session via `sync.sendMessage(sessionId, message, { source: 'voice' })`.
- **processPermissionRequest(requestId, decision)** — allows or denies the pending request by finding its owning session.

The message tool uses the explicit `sessionId`; the permission tool finds the session that owns `requestId`. Navigation focus does not choose either tool's target.

## Lifecycle

```text
App mounts RealtimeVoiceSession component
  └──> useConversation() hook initializes
  └──> registerVoiceSession(impl) — makes the instance available globally

Realtime caller invokes the separate voice lifecycle
  └──> voiceHooks.onVoiceStarted(sessionId) — builds initial prompt
  └──> startRealtimeSession(sessionId, prompt)
         ├──> fetchVoiceToken() — server-side gating (see plans/elevenlabs-voice-usage-gating.md)
         ├──> currentSessionId = sessionId
         └──> voiceSession.startSession({ token, initialContext, ... })

Realtime status pill is pressed
  └──> stopRealtimeSession()
         ├──> voiceSession.endSession()
         ├──> currentSessionId = null
         └──> voiceHooks.onVoiceStopped() — clears state
```

## Related

- `docs/plans/elevenlabs-voice-usage-gating.md` — usage gating and paywall flow for voice sessions.
