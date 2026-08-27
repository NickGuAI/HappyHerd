# HappyHerd launcher

`happyherd` is a thin alias for the bundled upstream Happy CLI. Every
invocation is forwarded once with the same arguments, environment, exit status,
and signal behavior.

```text
happyherd
happyherd server
happyherd daemon start
happyherd daemon status
happyherd codex
happyherd machine list --json
```

The package carries the ordinary Happy runtime. The user-owned installer places
the existing self-host server package beside it, so an installation can use
either a local server or an explicitly selected remote server through normal
Happy settings. It does not add an
issuer, broker, credential vault, verified Skill registry, tool runner, release
attestation, or separate daemon lifecycle.
