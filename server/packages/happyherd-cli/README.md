# HappyHerd launcher

`happyherd` is the organization-neutral local entry point for HappyHerd. It
ships with the maintained Happy runtime and adds four end-user workflows:

```text
happyherd doctor
happyherd connect https://issuer.example --no-open --json
happyherd install-skills --issuer https://issuer.example
happyherd run-tool --issuer https://issuer.example --skill generic-guide --script scripts/check.py -- --read
happyherd upgrade --manifest https://downloads.example/releases/release-manifest.json
```

`connect --json` is an NDJSON stream. It emits an `approval` record with
`verificationUri` and `userCode` before polling, optional `pending` and
`connected` progress, then one secret-free `receipt`. This is the stable mode
for an onboarding Skill or another local automation.

Issuer credentials are written only to the operating system secret store.
There is no plaintext fallback. The launcher never puts a credential in a URL,
command-line argument, log, or agent prompt.

`happyherd launch claude` and `happyherd launch codex` start the bundled Happy
runtime after installation and connection are complete. Verified Skills are
copied atomically into both providers' local discovery roots with HappyHerd
ownership receipts; unrelated Skills are never overwritten. `run-tool`
re-verifies the managed registry and script before placing
`HAPPYHERD_ACCESS_TOKEN` in that child process only.

`happyherd launch claude --help` and `happyherd launch codex --help` verify both
registered launch paths without making a model-provider request. Disconnect
with `happyherd disconnect <issuer-origin>` or `happyherd disconnect --all`.

See `docs/issuer-protocol.md` and `docs/public-launcher-release.md` in the
repository root for protocol and release contracts.
