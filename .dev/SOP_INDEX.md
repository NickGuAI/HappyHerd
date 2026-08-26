# Standard operating procedure index

This index points to canonical sources. Read the document before invoking its
executable owner. The retained public-launcher release and upstream-sync
rehearsal may reject feature branches or dirty trees by design; ordinary
component deployment does not impose that source-state gate.

| Topic | Primary source | Executable owner |
|---|---|---|
| Development and PR conventions | `AGENTS.md`, `server/docs/CONTRIBUTING.md`, `server/docs/dev-environments.md` | `server/package.json` |
| HappyHerd branch-to-cleanup lifecycle | `.dev/playbooks/development-lifecycle.md` | `git`, `gh`, root required workflows |
| Verification | `.dev/VERIFY.md`, `.github/workflows/quality-gates.yml`, `.github/workflows/contract-suite.yml` | `scripts/contract-suite.sh` |
| Owned patch discipline | `docs/patch-discipline.md`, `docs/owned-patches.tsv` | `scripts/verify-patch-discipline.sh`, `scripts/list-owned-patches.sh`, `scripts/test-owned-merge-provenance.sh` |
| Upstream lineage | `docs/lineage.md` | `scripts/verify-lineage.sh` |
| Upstream sync | `docs/upstream-sync-rehearsal.md` | `scripts/rehearse-upstream-sync.sh`, `scripts/test-upstream-sync-provenance.sh` |
| End-user install and public release | `README.md`, `docs/public-launcher-release.md` | `.github/workflows/public-launcher-release.yml`, `scripts/test-public-launcher-release-contract.sh` |
| CLI command reference | `server/packages/happyherd-cli/README.md`, `server/packages/happy-cli/README.md` | `happyherd --help`, `happy --help` |
| Troubleshooting and diagnostics | CLI README files, `docs/runtime-isolation.md` | `happyherd doctor`, `happy doctor`, `scripts/health-happyherd-agent.sh` |
| Component-native deployment | `docs/deployment.md`, `docs/runtime-isolation.md` | `scripts/build-server-image.sh`, `scripts/deploy-server.sh`, `scripts/install-host-cli.sh`, `scripts/install-linux-daemon-bootstrap.sh`, `scripts/install-agent-runtime.sh` |
| Combined post-update server/daemon restart and read-back | `.dev/playbooks/post-update-restart.md`, `docs/deployment.md`, `docs/runtime-isolation.md` | `.github/workflows/server-image.yml`, `scripts/deploy-server.sh`, `scripts/install-host-cli.sh`, `scripts/start-host-daemon.sh`, native `happy daemon` commands |
| `/automations` production profiling | `docs/automations-profiling.md` | Browser Performance API, private container metrics, retained server and daemon logs |
| Issuer, device flow, Skills, and credential boundary | `docs/issuer-protocol.md` | HappyHerd CLI tests and public-launcher contract |
| AgentContext ownership | `docs/agentcontext-authority.md` | CLI Commander/context tests |
| Upstream server deployment reference | `server/docs/deployment.md` | package scripts under `server/packages/happy-server` |

`server/docs/CONTRIBUTING.md` describes upstream development mechanics. Root
HappyHerd guidance owns this distribution's lineage, branch, patch,
component-deployment, public-release, and verification policy.
