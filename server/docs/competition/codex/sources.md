# Codex Sources

Reviewed on 2026-03-20.

- repo: `https://github.com/openai/codex`
- checkout: `../happyherd-adjacent/research/codex`
- commit: `ec32866c379405a28b58c0064c857fb60ed3c735`

## Primary files inspected

- `../happyherd-adjacent/research/codex/codex-rs/app-server/README.md`
- `../happyherd-adjacent/research/codex/codex-rs/app-server-protocol/src/protocol/v2.rs`
- `../happyherd-adjacent/research/codex/codex-rs/app-server/src/lib.rs`
- `../happyherd-adjacent/research/codex/codex-rs/app-server/src/transport.rs`
- `../happyherd-adjacent/research/codex/codex-rs/app-server/src/thread_state.rs`
- `../happyherd-adjacent/research/codex/codex-rs/app-server/src/codex_message_processor.rs`
- `../happyherd-adjacent/research/codex/codex-rs/app-server/tests/suite/v2/thread_resume.rs`
- `../happyherd-adjacent/research/codex/codex-rs/app-server/tests/suite/v2/thread_fork.rs`

## Notes

- This is the best typed approval and sandbox protocol surface in the current comparison set.
- The app-server README is unusually useful and should be revisited as HappyHerd's own protocol evolves.
