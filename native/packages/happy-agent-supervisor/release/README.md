# Releasing

The package ships one npm name. The native binaries are published as versions
of that same name — `0.0.1-darwin-arm64` and its three siblings — and the root
version names them as optional dependencies, so there is exactly one package to
own and one trusted publisher to configure.

## Once, by hand

npm configures trusted publishing on a package that already exists, so the name
has to be claimed before the workflow can be trusted with it:

```sh
pnpm --filter @slopus/happy-agent-supervisor release:placeholder
```

That publishes version `0.0.0`, which contains a README and nothing else, under
the `placeholder` dist-tag so `latest` stays unset.

Then, on npmjs.com, open the package → Settings → Trusted publisher → GitHub
Actions, and enter repository `slopus/rig`, workflow `publish-sandbox.yml`,
environment `npm`. After that there is no npm token in this repository at all.

## Every release

Tag the commit on `main` and push the tag:

```sh
git tag happy-agent-supervisor-v0.0.1
git push origin happy-agent-supervisor-v0.0.1
```

`.github/workflows/publish-sandbox.yml` builds and tests all four targets on
their own real hardware, refuses a tag that is not on `main` or does not match
the version in `package.json`, then publishes the four platform versions
followed by the root one.

## Checking the registry

`npm-version-exists.sh` answers whether a version is already published:
exit `0` for yes, `1` for no, `2` for a registry error that is neither.
