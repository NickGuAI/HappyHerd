# Context window fixtures

These are native-format, sanitized fixtures. All message text, identities,
paths, opaque data, and timestamps are invented; no private transcript was
copied here. Shape checks inspected only keys and value types in locally
recorded Claude and Codex JSONL, and the following native sources:

- Installed `@anthropic-ai/claude-agent-sdk` 0.3.260 `sdk.d.ts`
  (`SDKCompactBoundaryMessage`) and `sdk.mjs` native transcript reconstruction:
  disk `compactMetadata.preservedMessages` takes precedence over
  `preservedSegment`, with kept messages inserted after `anchorUuid`.
- [Codex 0.154.0 rollout reconstruction](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session/rollout_reconstruction.rs)
  selects the current `compacted.replacement_history`, then later response
  items and inter-agent input. Native world-state/turn-context records remain
  labeled trace metadata, without fabricated model messages.
- [Codex 0.154.0 rollout policy](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/rollout/src/policy.rs)
  does not persist all dynamic model-input/tool-definition records. The
  reader therefore marks trace limitations rather than claiming to recover
  an exact model request.

The fixtures cover actual compaction markers, retained input, hidden
attachments/injections, structured reasoning and tools, base instructions,
and later non-compacting summary/bookkeeping records. Tests generate large
content and incomplete/missing trace cases without storing runtime homes.
