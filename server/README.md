# HappyHerd source workspace

<!-- rename:preserve -->
HappyHerd lets you follow coding-agent work from a browser and organize work
across connected machines. This workspace preserves the full history of
[Happy](https://github.com/slopus/happy), the upstream project that provides the
mobile/Web client and encrypted synchronization foundation. HappyHerd's owned
changes are maintained in this distribution; see the [source lineage](../docs/lineage.md).
<!-- /rename:preserve -->

## Start using HappyHerd

Start with the [HappyHerd quickstart](../README.md#get-started),
[product guide](../docs/product-guide.md), and
[HappyHerd downloads](https://github.com/NickGuAI/HappyHerd/releases).

The public 1.2.4 release provides CLI/server/Web archives for macOS and Linux
(arm64 and x64). It does not publish native graphical macOS, iOS or Android
apps, a Windows installer, or an npm package. Current source can contain newer
features than that release. See [native build instructions](../docs/native-app-builds.md)
for the separate source-build and distribution requirements.

## Components in this distribution

- [HappyHerd App](packages/happyherd-app) — Expo/React Native client and Tauri desktop source.
- [HappyHerd CLI](packages/happyherd-cli) — provider launch, machine connection, and session operations.
- [HappyHerd Server](packages/happyherd-server) — synchronization and self-host Web serving.
- [HappyHerd control agent](packages/happyherd-control-agent) — inherited remote-control component; ordinary HappyHerd operations use the maintained CLI.

Read [Contributing](docs/CONTRIBUTING.md) for the source workspace and verification
entry points. Report HappyHerd problems in
[HappyHerd issues](https://github.com/NickGuAI/HappyHerd/issues).

## Upstream credit and resources

<!-- rename:preserve -->
[Happy's repository](https://github.com/slopus/happy) and
[Happy's documentation](https://happy.engineering/docs/) describe the upstream
project. Its hosted service, app-store listings, desktop downloads, demos,
community, and team story belong to Happy, not to HappyHerd. They are not
installation instructions or distribution evidence for this fork.
<!-- /rename:preserve -->

<!-- rename:preserve -->
Upstream historically migrated from `happy-coder` to `happy`; thanks to
[@franciscop](https://github.com/franciscop) for donating the upstream `happy`
package name. Historical package names and protocol identifiers remain valid
provenance, not HappyHerd package-publication claims.
<!-- /rename:preserve -->

## License

[MIT](LICENSE), with upstream notices retained.
