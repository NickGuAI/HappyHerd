# HappyHerd deployment guardrail audit

This inventory covers every HappyHerd-owned gate, refusal, source/version lock,
rollback controller, process owner, or isolation layer on the ordinary
self-host server and host-daemon deployment paths. The dispositions below are
the human decisions recorded in TickTick task `6a8908bf8f087c81d06ccf69` on
2026-08-22. Upstream Happy behavior is the baseline.

The tagged public launcher and the optional governed-agent product are listed
because they are adjacent, but they are independent lanes explicitly retained
by the task. Their integrity and authorization contracts do not govern an
ordinary server or host-daemon restart.

| Candidate and former source | Trigger | Action blocked or controlled | Claimed failure prevented | User capability / operating cost | Upstream equivalent | Human disposition |
| --- | --- | --- | --- | --- | --- | --- |
| Combined artifact builder — `scripts/build-release-artifacts.sh` (deleted) | Any release | Forced Web, iOS, server, CLI/daemon, and agent into one build | Component drift | Prevented independent deploys; large slow build | None | **DELETE** |
| Exact source gate — `scripts/assert-origin-main.sh` (deleted) | Build/install from a checkout | Refused dirty, topical, or non-`origin/main` source | Untraceable release | Blocked normal test/deploy work | None | **DELETE** |
| Whole-product reproducibility proof — `scripts/verify-reproducible-build.sh` (deleted) | Release build | Required byte-identical archives and checksums | Nondeterministic artifacts | Rebuilt unrelated components | None | **DELETE** |
| Combined manifest verifier — `scripts/verify-release-manifest.mjs` (deleted) | Install/activate | Required one source receipt and all component identities | Mismatched components | Created lockstep compatibility refusal | None | **DELETE** |
| Universal release tree — `scripts/install-host-release.sh`, `scripts/activate-release.sh` (deleted) | Host install | Required `/opt/happyherd/releases/<sha>` and `current` symlink | Partial activation | Replaced native package lifecycle and complicated restart | None | **DELETE** |
| Digest-only server activation — former `scripts/lib/runtime-config.sh` and release scripts | Server deploy | Rejected normal image tags | Mutable image selection | Prevented normal GHCR tag deployment | None | **DELETE** |
| Automatic rollback controller — `scripts/rollback-release.sh` and release tests (deleted) | Failed post-start check | Chose and activated a previous digest automatically | Bad server image | Harness, not operator, changed production state | None | **DELETE** |
| Cross-host source identity — former release receipt and daemon checks | Daemon/server startup | Required server, EC2, Mac, CLI, and agent SHA equality | Protocol incompatibility | Refused independently compatible versions | None; Happy relies on its protocol | **DELETE** |
| CLI release identity suffix — former `server/packages/happy-cli/src/releaseIdentity.ts` | CLI start/version | Injected release SHA and compared it during readiness | Wrong CLI package | Coupled native daemon to self-host release | None | **DELETE** |
| HappyHerd-owned daemon/process supervisor — former release units and activation scripts | Server or daemon release | Stopped/reparented daemon and provider processes during release | Orphaned processes | Interrupted active Claude/Codex work | Happy detached daemon lifecycle | **DELETE** |
| Immutable base-image pin and branding checksum — former `server/Dockerfile` / `scripts/build-server-image.sh` | Server image build | Pinned build inputs and embedded a custom checksum | Silent build-input change | Added provenance machinery without product value | Happy uses ordinary image/tool versions | **DELETE** |
| Server container sandbox flags — former `scripts/run-container.sh` | Every server start | Forced read-only root, `noexec` tmpfs, no-new-privileges, and no capabilities | Container privilege abuse | Added an unapproved refusal surface to the normal server | Not required by self-host Happy | **DELETE** |
| Runtime configuration allowlist — former `scripts/lib/runtime-config.sh` | Every server start | Rejected unknown env keys and extra operator settings | Config typo / injection | Made normal upstream configuration additions fail closed | Happy consumes ordinary operator env | **DELETE** |
| Central server systemd unit — `deploy/happyherd.service:1` | Boot/crash/operator restart | Owns only the self-host Web/API container | Server unavailable after reboot/crash | Small, visible host dependency | Ordinary process supervision | **APPROVED TO KEEP** |
| Required config, master-secret presence, and `/health` observation — `scripts/run-container.sh`, `scripts/deploy-server.sh` | Server start/deploy | Stops when the server cannot start; reports failed health | Starting an unusable server | Does not select another version or block unrelated components | Upstream runtime requirements and health endpoint | **APPROVED TO KEEP** |
| Normal GHCR tags and manual rollback — `.github/workflows/server-image.yml`, `scripts/deploy-server.sh` | Server publish/deploy | Publishes/selects one server+Web tag; operator chooses any older tag | None; this is the primary path | Restores one-command component deployment | Native container workflow | **APPROVED TO KEEP** |
| Minimal Linux boot adapter — `deploy/happyherd-daemon.cron`, `scripts/start-host-daemon.sh` | Host reboot | Invokes installed `happy daemon start` and exits | Daemon absent after reboot | Does not own daemon/provider processes | Happy detached daemon lifecycle | **APPROVED TO KEEP** |
| Public launcher integrity lane — `.github/workflows/public-launcher-release.yml`, `installers/`, `docs/public-launcher-release.md` | Tagged public native release only | Validates the downloaded end-user installer and owned installation | Tampered native installer/credential host | No effect on self-host server/daemon deployment | Independent public distribution channel | **APPROVED TO KEEP** |
| Optional governed-agent authorization/isolation — `server/packages/happyherd-agent/`, `deploy/happyherd-agent.service` | Explicit governed-agent installation only | Bounds organization credentials and declared tools | Agent obtains undeclared organization access | Isolated from ordinary server/host-daemon operations | HappyHerd product feature, not upstream release logic | **APPROVED TO KEEP** |
| Owned-patch and upstream-sync review — `docs/patch-discipline.md`, `scripts/rehearse-upstream-sync.sh` | Contributor PR/upstream import only | Requires reviewable HappyHerd patches and merge provenance | Losing fork ownership during upstream sync | No runtime or deployment refusal | Maintainer workflow | **APPROVED TO KEEP** |

## Resulting rule

The ordinary deployment path has only functional prerequisites: an existing
server image tag, readable operator configuration, the server's required
secret, systemd for the central server, and observable `/health`. It has no
global release identity, source receipt, cross-host version check, automatic
rollback, or HappyHerd-owned daemon/provider supervisor.

Any future HappyHerd-only guardrail requires a new human decision recorded in
its issue and pull request before implementation.
