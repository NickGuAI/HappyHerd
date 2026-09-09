#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installer="$root/install.sh"
uninstaller="$root/installers/uninstall.sh"
legacy_cleanup="$root/installers/cleanup-legacy.sh"
asset_builder="$root/scripts/build-native-installer-asset.sh"
deployment_helper="$root/scripts/prepare-native-installer-deployment.mjs"
release_workflow="$root/.github/workflows/native-installer-release.yml"

fail() {
  echo "native-installer-contract: $*" >&2
  exit 1
}

for executable in "$installer" "$uninstaller" "$legacy_cleanup" "$asset_builder"; do
  [[ -x "$executable" ]] || fail "required executable is missing: $executable"
done
[[ -f "$release_workflow" ]] || fail 'native installer release workflow is missing'
[[ -f "$deployment_helper" ]] || fail 'locked deployment helper is missing'

# The retired #98 security distribution stack stays deleted. The new release
# carries only the ordinary Happy CLI, self-host server, and their runtime.
deleted_paths=(
  .github/workflows/public-launcher-release.yml
  installers/install.sh.template
  installers/install.ps1.template
  installers/uninstall.ps1
  docs/issuer-protocol.md
  scripts/build-public-release-metadata.mjs
  scripts/prepare-agent-cli-fixtures.sh
  scripts/prepare-agent-cli-fixtures.ps1
  scripts/prepare-native-release-fixture.mjs
  scripts/prepare-public-launcher-asset.mjs
  scripts/prepare-public-launcher-payload.mjs
  scripts/test-installed-happyherd-e2e.sh
  scripts/test-installed-happyherd-e2e.ps1
  scripts/test-macos-uninstall-recovery.mjs
  scripts/verify-public-launcher-release.mjs
  scripts/write-public-asset-fragment.mjs
  server/packages/happyherd-cli
)
for path in "${deleted_paths[@]}"; do
  [[ ! -e "$root/$path" ]] || fail "obsolete HappyHerd-only path remains: $path"
done
if find "$root/installers/service" -type f -print -quit 2>/dev/null | grep -q .; then
  fail 'obsolete broker, vault, or helper source remains under installers/service'
fi
node "$root/scripts/verify-cli-public-command.mjs"

grep -Fq 'REPOSITORY="https://github.com/NickGuAI/HappyHerd"' "$installer"
grep -Fq 'DEFAULT_SERVER="http://127.0.0.1:3005"' "$installer"
# shellcheck disable=SC2016
grep -Fq 'asset_name="happyherd-$target.tar.gz"' "$installer"
grep -Fq 'releases/latest/download' "$installer"
grep -Fq -- '--asset FILE_OR_URL' "$installer"
grep -Fq -- '--version VERSION' "$installer"
grep -Fq 'settings.serverUrl = serverUrl;' "$installer"
grep -Fq 'settings.webappUrl = serverUrl;' "$installer"
# shellcheck disable=SC2016
grep -Fq 'server_default=${saved_server_url:-$DEFAULT_SERVER}' "$installer"
grep -Fq 'prepared release has no Web app' "$installer"
grep -Fq 'server --host 127.0.0.1 --port 3005 --no-persist' "$installer"
grep -Fq 'daemon start' "$installer"
grep -Fq 'auth login < /dev/tty > /dev/tty' "$installer"
# shellcheck disable=SC2016
grep -Fq 'PATH="$node_root/bin:$PATH"' "$installer"
grep -Fq 'stop_managed_server' "$installer"
grep -Fq 'refusing to replace unmanaged command' "$installer"
grep -Fq 'run this installer as your normal user, not with sudo' "$installer"

if grep -Eq 'pnpm|npm install|bun@|archive/refs/heads|--source' "$installer"; then
  fail 'customer installer still contains a source-build or package-manager path'
fi
if grep -Fq 'TMPDIR' "$installer"; then
  fail 'customer installer still depends on a TMPDIR override'
fi
if grep -Eq 'release-manifest|SHA256SUMS|sha256|sourceSha|broker-service|install-skills|run-tool|HAPPYHERD_ACCESS_TOKEN|HAPPYHERD_ISSUER|keyring|setfacl|setuid|seccomp' \
  "$installer" "$uninstaller" "$asset_builder" "$release_workflow"; then
  fail 'active native installer retained deleted security machinery'
fi
if grep -Eq '^HAPPY_(SERVER|WEBAPP)_URL=' "$root/deploy/happyherd-daemon.env.example"; then
  fail 'ordinary daemon template still requires server URL environment exports'
fi

for target in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  grep -Fq "target: $target" "$release_workflow" || fail "release workflow omits $target"
done
grep -Fq 'scripts/build-native-installer-asset.sh' "$release_workflow"
grep -Fq 'scripts/test-native-installer-asset.sh' "$release_workflow"
grep -Fq 'gh release create' "$release_workflow"
grep -Fq 'release_flags+=(--prerelease)' "$release_workflow"
grep -Fq 'node-version: 24' "$release_workflow"
grep -Fq -- '--filter @happyherd/cli --fail-if-no-match build' "$asset_builder"
grep -Fq -- '--filter happy-server-self-host --fail-if-no-match build' "$asset_builder"
grep -Fq -- '--filter happy-server-self-host --fail-if-no-match bundle:webapp' "$asset_builder"
grep -Fq 'node/bin/node' "$asset_builder"
grep -Fq 'pwd -P' "$asset_builder"
grep -Fq -- "-name '*musl*'" "$asset_builder"
if grep -Fq -- '--legacy' "$asset_builder"; then
  fail 'release builder still uses pnpm legacy deploy'
fi
grep -Fq 'nodeLinker: hoisted' "$deployment_helper"
grep -Fq 'pnpm install --prod --frozen-lockfile --offline --ignore-scripts' "$asset_builder"
[[ "$($asset_builder --print-target)" == linux-x64 ]]

grep -Fq 'Preserved normal Happy state' "$uninstaller"
# shellcheck disable=SC2016
if grep -Fq 'rm -rf -- "$HOME/.happyherd"' "$uninstaller"; then
  fail 'user uninstaller must not remove normal ~/.happyherd state'
fi
grep -Fq 'Preserved ~/.happyherd' "$legacy_cleanup"

# Create the exact archive shape produced by the builder, using the current
# Node executable and a tiny deterministic CLI fixture. The install itself is
# then exercised without Node, npm, pnpm, Bun, or a compiler on PATH.
fixture="$(mktemp -d)"
managed_test_pid=''
cleanup_fixture() {
  if [[ "$managed_test_pid" =~ ^[0-9]+$ ]]; then
    kill "$managed_test_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$fixture"
}
trap cleanup_fixture EXIT

asset_root="$fixture/asset-root/happyherd"
mkdir -p "$asset_root/node/bin" "$asset_root/runtime/bin" \
  "$asset_root/runtime/tools/unpacked" \
  "$asset_root/runtime/node_modules/happy-server-self-host/webapp"
cp "$(command -v node)" "$asset_root/node/bin/node"
chmod 755 "$asset_root/node/bin/node"
printf 'Node runtime license fixture\n' > "$asset_root/node/LICENSE"
printf '#!/bin/sh\n' > "$asset_root/runtime/tools/unpacked/rg"
chmod 755 "$asset_root/runtime/tools/unpacked/rg"
printf '{"name":"happy-server-self-host"}\n' \
  > "$asset_root/runtime/node_modules/happy-server-self-host/package.json"
printf '<!doctype html><title>HappyHerd</title>\n' \
  > "$asset_root/runtime/node_modules/happy-server-self-host/webapp/index.html"
cat > "$asset_root/runtime/bin/happy.mjs" <<'JS'
#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (process.env.HAPPYHERD_TEST_LOG) fs.appendFileSync(process.env.HAPPYHERD_TEST_LOG, `${args.join(' ')}\n`);
if (args[0] === 'server') setInterval(() => {}, 1000);
JS
chmod 755 "$asset_root/runtime/bin/happy.mjs"
cp "$uninstaller" "$asset_root/uninstall.sh"
cp "$legacy_cleanup" "$asset_root/cleanup-legacy.sh"
chmod 755 "$asset_root/uninstall.sh" "$asset_root/cleanup-legacy.sh"
asset="$fixture/happyherd-linux-x64.tar.gz"
tar -czf "$asset" -C "$fixture/asset-root" happyherd

home="$fixture/home"
fake_bin="$fixture/bin"
mkdir -p "$home/.happyherd" "$home/.claude/skills/user-skill" "$home/.codex" \
  "$home/.local/bin" "$fake_bin"
printf '{"machineId":"keep-me","theme":"dark"}\n' > "$home/.happyherd/settings.json"
printf 'access-key\n' > "$home/.happyherd/access.key"
printf 'sessions\n' > "$home/.happyherd/sessions.json"
printf 'provider\n' > "$home/.codex/config.toml"
printf 'user skill\n' > "$home/.claude/skills/user-skill/SKILL.md"

cat > "$home/.local/bin/happy" <<'EXISTING_HAPPY'
#!/bin/sh
echo existing-user-happy
EXISTING_HAPPY
chmod 700 "$home/.local/bin/happy"
existing_happy="$(cat "$home/.local/bin/happy")"
ln -s "/opt/happyherd/$(id -u)/bin/happyherd" "$home/.local/bin/happyherd"
printf 'bash profile\n' > "$home/.bashrc"
chmod 600 "$home/.bashrc"

cat > "$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [[ -n "$output" ]]; then
  cp "$HAPPYHERD_FIXTURE_ASSET" "$output"
  printf '%s\n' "$url" >> "$HAPPYHERD_CURL_LOG"
else
  printf '{"status":"ok"}\n'
fi
FAKE_CURL
chmod 755 "$fake_bin/curl"
for command_name in node npm pnpm bun cc gcc clang; do
  cat > "$fake_bin/$command_name" <<'FORBIDDEN_TOOL'
#!/bin/sh
echo "unexpected customer-side build tool: $0" >&2
exit 91
FORBIDDEN_TOOL
  chmod 755 "$fake_bin/$command_name"
done

settings_before_access="$(cat "$home/.happyherd/access.key")"
settings_before_sessions="$(cat "$home/.happyherd/sessions.json")"
provider_before="$(cat "$home/.codex/config.toml")"
skill_before="$(cat "$home/.claude/skills/user-skill/SKILL.md")"
test_log="$fixture/happy.log"
curl_log="$fixture/curl.log"

# Default download selects the stable release asset for this platform.
HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" \
  HAPPYHERD_FIXTURE_ASSET="$asset" HAPPYHERD_CURL_LOG="$curl_log" \
  PATH="$fake_bin:/usr/bin:/bin" \
  "$installer" --server https://remote.example --no-start >/dev/null
grep -Fxq 'https://github.com/NickGuAI/HappyHerd/releases/latest/download/happyherd-linux-x64.tar.gz' "$curl_log"

[[ -x "$home/.local/bin/happyherd" ]] || fail 'installer did not expose happyherd'
[[ "$(cat "$home/.local/bin/happy")" == "$existing_happy" ]] || fail 'installer replaced an existing Happy command'
[[ -x "$home/.local/share/happyherd/node/bin/node" ]]
[[ -f "$home/.local/share/happyherd/runtime/node_modules/happy-server-self-host/package.json" ]]
[[ ! -e "$home/.local/share/happyherd/source" && ! -e "$home/.local/share/happyherd/tooling" ]]
"$home/.local/share/happyherd/node/bin/node" -e '
  const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (s.serverUrl !== "https://remote.example" || s.webappUrl !== "https://remote.example") process.exit(1);
  if (s.machineId !== "keep-me" || s.theme !== "dark") process.exit(2);
' "$home/.happyherd/settings.json"

HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" \
  HAPPYHERD_FIXTURE_ASSET="$asset" HAPPYHERD_CURL_LOG="$curl_log" \
  PATH="$fake_bin:/usr/bin:/bin" \
  "$installer" --version 1.2.3 --no-start </dev/null >/dev/null
grep -Fxq 'https://github.com/NickGuAI/HappyHerd/releases/download/happyherd-v1.2.3/happyherd-linux-x64.tar.gz' "$curl_log"

HAPPYHERD_TEST_LOG="$test_log" \
  "$home/.local/share/happyherd/node/bin/node" \
  "$home/.local/share/happyherd/runtime/bin/happy.mjs" \
  server --host 127.0.0.1 --port 3005 --no-persist &
managed_test_pid=$!
printf '%s\n' "$managed_test_pid" > "$home/.happyherd/server.pid"
sleep 0.1
kill -0 "$managed_test_pid"

# A rerun is an upgrade and keeps the existing server and user state.
HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" PATH="$fake_bin:/usr/bin:/bin" \
  "$installer" --asset "$asset" --no-start </dev/null >/dev/null
if kill -0 "$managed_test_pid" 2>/dev/null; then
  fail 'upgrade left the recorded installer-managed server running'
fi
managed_test_pid=''
[[ ! -e "$home/.happyherd/server.pid" ]]
"$home/.local/share/happyherd/node/bin/node" -e '
  const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (s.serverUrl !== "https://remote.example" || s.webappUrl !== "https://remote.example") process.exit(1);
  if (s.machineId !== "keep-me" || s.theme !== "dark") process.exit(2);
' "$home/.happyherd/settings.json"
[[ "$(cat "$home/.happyherd/access.key")" == "$settings_before_access" ]]
[[ "$(cat "$home/.happyherd/sessions.json")" == "$settings_before_sessions" ]]
[[ "$(cat "$home/.codex/config.toml")" == "$provider_before" ]]
[[ "$(cat "$home/.claude/skills/user-skill/SKILL.md")" == "$skill_before" ]]

HOME="$home" HAPPYHERD_TEST_LOG="$test_log" "$home/.local/bin/happyherd" daemon status
grep -Fxq 'daemon status' "$test_log"

# Explicit localhost selection reaches the ordinary daemon path without any
# environment-variable setup. The fake health endpoint represents an already
# running local server.
HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" PATH="$fake_bin:/usr/bin:/bin" \
  "$installer" --asset "$asset" --server http://127.0.0.1:3005 >/dev/null
grep -Fxq 'daemon start' "$test_log"

HOME="$home" "$home/.local/share/happyherd/uninstall.sh" >/dev/null
[[ ! -e "$home/.local/share/happyherd" && ! -e "$home/.local/bin/happyherd" ]]
[[ "$(cat "$home/.local/bin/happy")" == "$existing_happy" ]]
grep -Fxq 'daemon stop' "$test_log"
[[ "$(cat "$home/.happyherd/access.key")" == "$settings_before_access" ]]
[[ "$(cat "$home/.happyherd/sessions.json")" == "$settings_before_sessions" ]]
[[ "$(cat "$home/.codex/config.toml")" == "$provider_before" ]]
[[ "$(cat "$home/.claude/skills/user-skill/SKILL.md")" == "$skill_before" ]]

# A wrapper written by the previous source-building installer is a managed
# upgrade target even when its old runtime is no longer available.
legacy_source_entry="$home/.local/share/happyherd/runtime/bin/happy.mjs"
cat > "$home/.local/bin/happyherd" <<EOF
#!/bin/sh
# HappyHerd managed command
exec "/usr/bin/node" "$legacy_source_entry" "\$@"
EOF
chmod 755 "$home/.local/bin/happyherd"
HOME="$home" SHELL=/bin/bash PATH="$fake_bin:/usr/bin:/bin" \
  "$installer" --asset "$asset" --no-start >/dev/null
grep -Fq '# HappyHerd managed command' "$home/.local/bin/happyherd"
grep -Fq "$home/.local/share/happyherd/node/bin/node" "$home/.local/bin/happyherd"
HOME="$home" "$home/.local/share/happyherd/uninstall.sh" >/dev/null

cat > "$home/.local/bin/happyherd" <<'UNMANAGED_HAPPYHERD'
#!/bin/sh
echo unrelated-happyherd
UNMANAGED_HAPPYHERD
chmod 755 "$home/.local/bin/happyherd"
if HOME="$home" SHELL=/bin/bash PATH="$fake_bin:/usr/bin:/bin" \
  "$installer" --asset "$asset" --no-start >"$fixture/conflict.out" 2>&1; then
  fail 'installer replaced an unmanaged happyherd command'
fi
grep -Fq 'refusing to replace unmanaged command' "$fixture/conflict.out"
grep -Fq 'unrelated-happyherd' "$home/.local/bin/happyherd"

echo 'native-installer-contract: ok'
