# Local voice experiments

Local voice is an account-level opt-in in **Settings → Features → Experiments**.
Choose a voice machine, then enable speech recognition, speech playback, or both.
The selected machine can differ from the machine running the conversation.
Installation and readiness belong to that machine's daemon; choosing a machine
does not copy models to other machines.

```text
╔══════════════════╗    encrypted short RPCs    ╔══════════════════╗
║ Desktop / Mobile ║ ←────── server relay ────→ ║ Voice machine    ║
║ mic / play / stop║                           ║ Qwen ASR, Kokoro ║
╚════════╤═════════╝                           ╚══════════════════╝
         │ ordinary conversation messages
         ↓
╔══════════════════╗
║ Session machine  ║
║ Agent replies    ║
╚══════════════════╝
```

Both switches default to off. Dictation then retains the existing configured
cloud transcription service. Local recognition uses Qwen3-ASR-0.6B through the
measured MLX runtime on Apple Silicon. Playback uses Kokoro: `af_heart` for
English and `zm_014` for Chinese. Installation downloads runtime dependencies
and models on demand. The feature does not enable the retired realtime voice
assistant or open a new network listener.

Dictation always inserts editable draft text; it never sends the message.
A ready, enabled local recognizer takes precedence over a configured cloud
service. If the voice machine goes offline, the existing cloud route is usable
only when its transcription key is configured. Other local inference failures
remain visible and preserve the captured recording for retry.

Replies are silent until the user presses a summary or full-reply playback
control. Selecting another reply stops the previous playback. Full-reply
speech omits code, tables, tool output, and presentation protocol blocks.
Historical replies without a spoken summary still support full-reply playback.
There is no hosted text-to-speech fallback.

When local playback is enabled, reply composition is:

```text
<voice_overview>Short text written for the ear.</voice_overview>
[safeguard reminder, when required]
Reply body
<options>...</options> [when needed; last]
```

The leading overview is removed before safeguard and Markdown rendering,
including incomplete prefixes during streaming. A literal example in a code
block remains an example. The summary and body are spoken separately, without
duplicating the overview in full-reply playback.

Installation and inference return operation IDs immediately. Recordings upload
in bounded chunks; playback reads ordered WAV chunks by cursor. Repeating a
read preserves its position. Cancellation, release, and idle expiry remove
temporary operation data. Model files remain installed when a feature is
switched off. Existing encrypted machine RPC carries all requests and responses.

Verification belongs to the wire schemas, daemon voice service, app provider
selection, reply parsing, and rendered settings/chat journeys. Desktop and
mobile browser proof, real model inference, relay/device proof, and deployed
artifact proof must be recorded separately; one does not substitute for another.
