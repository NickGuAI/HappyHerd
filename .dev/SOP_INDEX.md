# Standard operating procedure index

This index points to canonical sources. Read the document before invoking its
executable owner. Upstream merge proposals run outside GitHub CI through a
machine-local HappyHerd automation; ordinary component deployment does not
impose that source-state gate.

| Topic | Primary source | Executable owner |
|---|---|---|
| Development and PR conventions | `AGENTS.md`, `server/docs/CONTRIBUTING.md`, `server/docs/dev-environments.md` | `server/package.json` |
| HappyHerd branch-to-cleanup lifecycle | `.dev/playbooks/development-lifecycle.md` | `git`, `gh`, root required workflows |
| Verification | `.dev/VERIFY.md`, `.github/workflows/quality-gates.yml`, `.github/workflows/contract-suite.yml` | `scripts/contract-suite.sh` |
| Provider onboarding and protocol changes | `.dev/playbooks/provider-onboarding.md`, `.dev/COUPLINGS.md`, `.dev/VERIFY.md` | Focused provider fixtures; `pnpm --filter @slopus/happy-wire test`; affected `@happyherd/cli` and `happy-app` package checks; live provider smoke when available |
| Named credential pools and reactive rotation | `server/packages/happy-cli/README.md`, `.dev/COUPLINGS.md`, `.dev/VERIFY.md` | Focused connect, quota, resume, rotation, event-persistence, reducer, rendering, and locale fixtures; affected `@happyherd/cli` and `happy-app` package checks |
| Owned patch discipline | `docs/patch-discipline.md`, `docs/owned-patches.tsv` | `scripts/verify-patch-discipline.sh`, `scripts/list-owned-patches.sh`, `scripts/test-owned-merge-provenance.sh` |
| Upstream lineage | `docs/lineage.md` | `scripts/verify-lineage.sh` |
| Upstream merge proposal | `docs/upstream-sync-rehearsal.md` | native `happyherd automation`, `scripts/rehearse-upstream-sync.sh`, `scripts/test-upstream-sync-provenance.sh` |
| End-user local install and cleanup | `README.md`, `docs/public-launcher-release.md` | `install.sh`, `installers/{uninstall,cleanup-legacy}.sh`, `scripts/test-public-launcher-release-contract.sh` |
| CLI command reference | `server/packages/happy-cli/README.md` | `happyherd --help` |
| Side-chat delegation, lifecycle, and recovery | `.dev/playbooks/side-chat-lifecycle.md`, `.dev/COUPLINGS.md`, `.dev/VERIFY.md` | `happyherd session side-chat` brief and lifecycle commands |
| File-workspace consolidation | `.dev/playbooks/file-workspaces.md`, `.dev/COUPLINGS.md`, `.dev/VERIFY.md` | `SessionView`, `DesktopFileWorkspace`, Machine Workspace route, and their rendered browser fixtures |
| Troubleshooting and diagnostics | CLI README, `docs/runtime-isolation.md` | native `happyherd doctor`, `scripts/health-happyherd-agent.sh` |
| Component-native deployment | `docs/deployment.md`, `docs/runtime-isolation.md` | `scripts/build-server-image.sh`, `scripts/deploy-server.sh`, `scripts/install-host-cli.sh`, `scripts/install-linux-daemon-bootstrap.sh`, `scripts/install-agent-runtime.sh` |
| Combined post-update server/daemon restart and read-back | `.dev/playbooks/post-update-restart.md`, `docs/deployment.md`, `docs/runtime-isolation.md` | `.github/workflows/server-image.yml`, `scripts/deploy-server.sh`, `scripts/install-host-cli.sh`, `scripts/start-host-daemon.sh`, native `happyherd daemon` commands |
| `/automations` production profiling | `docs/automations-profiling.md` | Browser Performance API, private container metrics, retained server and daemon logs |
| Unattended automation provider onboarding | `.dev/playbooks/automation-unattended-smoke.md` | CLI automation/permission lifecycle tests, then one authenticated harmless provider smoke |
| AgentContext ownership | `docs/agentcontext-authority.md` | CLI Commander/context tests |
| Upstream server deployment reference | `server/docs/deployment.md` | package scripts under `server/packages/happy-server` |

`server/docs/CONTRIBUTING.md` describes upstream development mechanics. Root
HappyHerd guidance owns this distribution's lineage, branch, patch,
component-deployment, public-release, and verification policy.
