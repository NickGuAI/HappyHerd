#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
native_root="$repo_root/native"
mode="${1:-full}"
case "$mode" in
  source|full) ;;
  *) echo 'usage: test-native-context-runtime.sh [source|full]' >&2; exit 1 ;;
esac

# Source conformance also runs in the Node 20 repository contract suite.
# It checks that the owned runtime resolves its native packages locally; the
# separate Node 24 quality job owns actual compilation and execution.
# rename:preserve
node - "$native_root" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const manifest = read('package.json');
assert.equal(manifest.private, true, 'native workspace must remain private');
assert.equal(manifest.packageManager, 'pnpm@10.28.1');
for (const script of ['build', 'build:supervisor', 'check', 'test']) {
  assert.ok(manifest.scripts?.[script], `native ${script} command is missing`);
}
for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  assert.ok(fs.statSync(path.join(root, file)).isFile(), `missing native ${file}`);
}
const packages = ['happy-agent', 'happy-agent-base', 'happy-agent-client',
  'happy-agent-compute', 'happy-agent-modules', 'happy-providers', 'happy-agent-supervisor'];
const manifests = packages.map((name) => read(`packages/${name}/package.json`));
const names = new Set(manifests.map((pkg) => pkg.name));
for (const pkg of manifests) {
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(pkg[group] ?? {})) {
      assert.ok(!name.startsWith('@slopus/happy-agent-supervisor-'),
        `${pkg.name} must build the owned supervisor rather than download a platform binary`);
      if (names.has(name)) {
        assert.ok(version.startsWith('workspace:'), `${pkg.name} ${name} must use owned workspace source`);
      }
    }
  }
}
const daemon = manifests.find((pkg) => pkg.name === '@slopus/happy-agent');
assert.ok(daemon.dependencies['@slopus/happy-agent-modules'].startsWith('workspace:'));
console.log('native-context-runtime source: ok (source conformance only)');
NODE
# /rename:preserve

[[ "$mode" == full ]] || exit 0
cd "$native_root"
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { throw new Error("native verification requires Node.js 24 or newer"); }'
[[ "$(pnpm --version)" == 10.28.1 ]] || {
  echo 'native verification requires pnpm 10.28.1' >&2
  exit 1
}
export NODE_ENV=test
pnpm install --frozen-lockfile
pnpm build
pnpm build:supervisor
if [[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "$(uname -s)" == Linux ]]; then
  "$repo_root/scripts/prepare-native-context-ci.sh"
fi
pnpm check
pnpm lint
pnpm test
echo 'native-context-runtime full: ok'
