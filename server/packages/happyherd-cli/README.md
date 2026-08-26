# HappyHerd launcher

`happyherd` is the organization-neutral local entry point for HappyHerd. It
ships with the maintained Happy runtime and adds governed workflows:

```text
happyherd doctor
happyherd connect https://issuer.example --no-open --json
happyherd install-skills --issuer https://issuer.example
happyherd run-tool --issuer https://issuer.example --skill generic-guide --script scripts/check.py -- --read
happyherd upgrade --manifest https://downloads.example/releases/release-manifest.json
```

Those governed command names keep their HappyHerd behavior. Every other
invocation is forwarded once and unchanged to the bundled native Happy CLI, so
native commands such as `happy automation list --json` are also available as
`happyherd automation list --json`. Native arguments and exit or signal status
are preserved without maintaining a second command list in HappyHerd.

The maintained native machine-session commands are available through the same
passthrough:

```text
happyherd machine auth login
happyherd machine auth status
happyherd machine auth logout
happyherd machine list --json
happyherd session create --machine workstation --path /srv/project --provider codex --model gpt-5.6 --effort high --permission plan --create-dir --json
```

The one-time account link is approved in the Happy app and stored only as
`agent.key` in the configured HappyHerd home; native-session `access.key` and
governed launcher credentials never grant machine control. The machine selector is an exact account machine ID or
an unambiguous exact hostname. Session creation supports native Happy CLI daemon
machines only; machine-list receipts label Rig and other unsupported entries
without trying to adapt their different RPC contracts. Older native daemons
remain visible but report `sessionCreateSupported: false` until they are
upgraded and restarted to advertise the supported
`machineSessionProtocolVersion`. The command checks that marker before sending
a spawn RPC. Session paths are absolute on the selected machine. Omit
`--create-dir` unless that machine may create the directory.
Successful JSON creation receipts contain the settings validated by the target
daemon and persisted on the tracked session, rather than echoing caller input.

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
