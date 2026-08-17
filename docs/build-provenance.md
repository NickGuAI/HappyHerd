# Build provenance

Roadmap gate A2 requires the Web, iOS update, server, and host daemon artifacts
to be reconstructable from a clean clone. HappyHerd treats the Git commit and
the public server URL as release inputs; the artifact builder records those
inputs together with the initial upstream base SHA and the pinned tool versions.

## Build

```bash
pnpm --dir server install --frozen-lockfile
scripts/build-release-artifacts.sh
```

The command emits four deterministic archives, `SHA256SUMS`, and
`build-manifest.json` under `.artifacts/<commit>/` by default. The iOS archive
is the Expo/Hermes update payload produced on Linux; signed App Store binaries
remain an EAS/macOS release concern and are not misrepresented as locally
reproducible artifacts.

Both the artifact and image builders resolve the live `origin/main` ref and
refuse to build unless it is the checkout's exact 40-character `HEAD`. The
artifact manifest records that verified commit as both `happyHerdSha` and
`originMainSha`; installation and daemon startup reject a missing or mismatched
receipt.

## Clean-clone proof

Push the intended commit to `origin/main`, then run:

```bash
scripts/verify-reproducible-build.sh /tmp/happyherd-repro-evidence
```

The verifier builds once from the current clean checkout, clones the exact
`origin/main` commit into a new directory, performs a frozen install, rebuilds,
and requires byte-identical checksums and manifests. It exits non-zero for a
dirty tree, an unpushed commit, package-selector drift, or any artifact delta.

## Pinned build tools

- pnpm `10.11.0` (from the upstream workspace)
- Bun `1.3.11` (server bundling and Docker builder)
- Node `>=20` (the immutable deployment image uses Node 20)

The package path selector for the server deliberately includes
`--fail-if-no-match`. The upstream package is named `happy-server-self-host`,
so name-based `--filter happy-server` commands silently skipped the server
build and could not be used as provenance evidence.

The root postinstall also patches Expo's Hermes exporter to derive its temporary
input path from the bundle content. Upstream otherwise embeds a random path in
the iOS bytecode, making identical clean-clone exports byte-different. The patch
fails loudly if Expo changes the target layout so an upgrade cannot silently
drop this reproducibility contract.

End-user launcher releases use a separate five-platform contract. See
[public-launcher-release.md](public-launcher-release.md) for the
`happyherd-v*` tag namespace, native credential-store payloads, release manifest,
and installer verification.
