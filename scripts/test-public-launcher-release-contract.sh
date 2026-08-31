#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installer="$root/install.sh"
uninstaller="$root/installers/uninstall.sh"
legacy_cleanup="$root/installers/cleanup-legacy.sh"

fail() {
  echo "local-installer-contract: $*" >&2
  exit 1
}

[[ -x "$installer" && -x "$uninstaller" && -x "$legacy_cleanup" ]] ||
  fail 'installer and cleanup scripts must be executable'

# The #98 security distribution stack must be deleted, not disabled.
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
grep -Fq "ARCHIVE_URL=\"\$REPOSITORY/archive/refs/heads/main.tar.gz\"" "$installer"
grep -Fq 'DEFAULT_SERVER="http://127.0.0.1:3005"' "$installer"
grep -Fq "install_root=\"\$HOME/.local/share/happyherd\"" "$installer"
# This is the literal installer expression, not a contract variable.
# shellcheck disable=SC2016
grep -Fq '"bun@$BUN_VERSION"' "$installer"
grep -Fq -- '--filter @happyherd/cli...' "$installer"
grep -Fq -- '--filter happy-server-self-host...' "$installer"
grep -Fq -- '--ignore-scripts' "$installer"
# shellcheck disable=SC2016
grep -Fq 'npm_config_cache="$work_root/npm-cache"' "$installer"
# shellcheck disable=SC2016
grep -Fq 'npm_config_store_dir="$work_root/pnpm-store"' "$installer"
# shellcheck disable=SC2016
grep -Fq 'source_root="$work_root/source"' "$installer"
grep -Fq 'happy-server --fail-if-no-match generate' "$installer"
grep -Fq 'scripts/unpack-tools.cjs' "$installer"
grep -Fq 'href=\"[^\"]*\/\(node-v' "$installer"
grep -Fq 'settings.serverUrl = serverUrl;' "$installer"
grep -Fq 'settings.webappUrl = serverUrl;' "$installer"
# shellcheck disable=SC2016
grep -Fq 'server_default=${saved_server_url:-$DEFAULT_SERVER}' "$installer"
grep -Fq 'server --host 127.0.0.1 --port 3005 --no-persist' "$installer"
grep -Fq 'daemon start' "$installer"
grep -Fq 'auth login < /dev/tty > /dev/tty' "$installer"
grep -Fq 'stop_managed_server' "$installer"
grep -Fq 'refusing to replace unmanaged command' "$installer"
grep -Fq 'nohup' "$installer"
grep -Fq 'run this installer as your normal user, not with sudo' "$installer"
if grep -Eq '^HAPPY_(SERVER|WEBAPP)_URL=' "$root/deploy/happyherd-daemon.env.example"; then
  fail 'ordinary daemon template still requires server URL environment exports'
fi

if grep -Eq 'release-manifest|SHA256SUMS|sha256|sourceSha|broker-service|install-skills|run-tool|HAPPYHERD_ACCESS_TOKEN|HAPPYHERD_ISSUER|keyring|setfacl|setuid|seccomp' \
  "$installer" "$uninstaller"; then
  fail 'active local installer retained deleted security machinery'
fi

grep -Fq 'Preserved normal Happy state' "$uninstaller"
if grep -Fq "rm -rf -- \"\$HOME/.happyherd\"" "$uninstaller"; then
  fail 'user uninstaller must not remove normal ~/.happyherd state'
fi
grep -Fq 'Preserved ~/.happyherd' "$legacy_cleanup"
# shellcheck disable=SC2016
grep -Fq 'setfacl -x "u:$service_user"' "$legacy_cleanup"
# shellcheck disable=SC2016
grep -Fq 'chmod -a "user:$service_user allow search"' "$legacy_cleanup"
grep -Fq '# >>> HappyHerd managed PATH >>>' "$legacy_cleanup"
grep -Fq 'legacy_link_target' "$legacy_cleanup"

# Exercise the user-owned install without network or a real build. The fake
# package manager materializes only the deployment shape the installer consumes.
fixture="$(mktemp -d)"
managed_test_pid=''
cleanup_fixture() {
  if [[ "$managed_test_pid" =~ ^[0-9]+$ ]]; then
    kill "$managed_test_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$fixture"
}
trap cleanup_fixture EXIT
home="$fixture/home"
fake_bin="$fixture/bin"
mkdir -p "$home/.happyherd" "$home/.claude/skills/user-skill" "$home/.codex" \
  "$home/.local/bin" "$fake_bin"
printf '{"machineId":"keep-me","theme":"dark"}\n' > "$home/.happyherd/settings.json"
printf 'access-key\n' > "$home/.happyherd/access.key"
printf 'sessions\n' > "$home/.happyherd/sessions.json"
printf 'provider\n' > "$home/.codex/config.toml"
printf 'user skill\n' > "$home/.claude/skills/user-skill/SKILL.md"
legacy_happy_entry="$home/.local/share/happyherd/runtime/node_modules/happy/bin/happy.mjs"
cat > "$home/.local/bin/happy" <<EXISTING_HAPPY
#!/bin/sh
# HappyHerd managed command
# diagnostic only: exec "/usr/bin/node" "$legacy_happy_entry" "\$@"
echo existing-user-happy
EXISTING_HAPPY
chmod 700 "$home/.local/bin/happy"
existing_happy=$(cat "$home/.local/bin/happy")
ln -s "/opt/happyherd/$(id -u)/bin/happyherd" "$home/.local/bin/happyherd"
printf 'bash profile\n' > "$home/.bashrc"
chmod 600 "$home/.bashrc"
# The fixture contains the literal profile expression written by the installer.
# shellcheck disable=SC2016
printf 'z profile\nexport PATH="$HOME/.local/bin:$PATH" # HappyHerd managed PATH\n' \
  > "$home/.zprofile-target"
chmod 600 "$home/.zprofile-target"
ln -s .zprofile-target "$home/.zprofile"

cat > "$fake_bin/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -euo pipefail
prefix=''
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == --prefix ]]; then prefix="$2"; shift 2; else shift; fi
done
[[ -n "$prefix" ]]
mkdir -p "$prefix/bin"
cat > "$prefix/bin/pnpm" <<'FAKE_PNPM'
#!/usr/bin/env bash
set -euo pipefail
deploy=0
last=''
server=0
for argument in "$@"; do
  [[ "$argument" == deploy ]] && deploy=1
  [[ "$argument" == happy-server-self-host ]] && server=1
  last="$argument"
done
if [[ "$deploy" -eq 1 ]]; then
  if [[ "$server" -eq 1 ]]; then
    mkdir -p "$last"
    printf '{"name":"happy-server-self-host"}\n' > "$last/package.json"
    exit 0
  fi
  mkdir -p "$last/bin" "$last/tools/unpacked" "$last/node_modules"
  printf '{"name":"@happyherd/cli","bin":{"happyherd":"./bin/happy.mjs"}}\n' > "$last/package.json"
  printf '#!/bin/sh\n' > "$last/tools/unpacked/rg"
  chmod 755 "$last/tools/unpacked/rg"
  cat > "$last/bin/happy.mjs" <<'JS'
#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (process.env.HAPPYHERD_TEST_LOG) fs.appendFileSync(process.env.HAPPYHERD_TEST_LOG, `${args.join(' ')}\n`);
if (args[0] === 'server') setInterval(() => {}, 1000);
JS
  chmod 755 "$last/bin/happy.mjs"
fi
FAKE_PNPM
chmod 755 "$prefix/bin/pnpm"
FAKE_NPM
chmod 755 "$fake_bin/npm"
cat > "$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
printf '{"status":"ok"}\n'
FAKE_CURL
chmod 755 "$fake_bin/curl"

# Prove the fallback path against the prefixed href shape served by nodejs.org.
fallback_home="$fixture/fallback-home"
fallback_bin="$fixture/fallback-bin"
mkdir -p "$fallback_home" "$fallback_bin"
cat > "$fallback_bin/node" <<'FAKE_OLD_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == -p ]]; then printf '0\n'; exit 0; fi
exit 1
FAKE_OLD_NODE
cat > "$fallback_bin/curl" <<'FAKE_NODE_CURL'
#!/usr/bin/env bash
set -euo pipefail
output=''
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == -o ]]; then output="$2"; shift 2; else shift; fi
done
if [[ -n "$output" ]]; then
  : > "$output"
else
  printf '<a href="/dist/latest-v22.x/node-v22.23.2-linux-x64.tar.gz">node</a>\n'
fi
FAKE_NODE_CURL
cat > "$fallback_bin/tar" <<'FAKE_NODE_TAR'
#!/usr/bin/env bash
set -euo pipefail
target=''
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == -C ]]; then target="$2"; shift 2; else shift; fi
done
[[ -n "$target" ]]
mkdir -p "$target/bin"
ln -s "$HAPPYHERD_REAL_NODE" "$target/bin/node"
cp "$HAPPYHERD_FAKE_NPM" "$target/bin/npm"
chmod 755 "$target/bin/npm"
FAKE_NODE_TAR
chmod 755 "$fallback_bin/node" "$fallback_bin/curl" "$fallback_bin/tar"
real_node=$(command -v node)
HOME="$fallback_home" SHELL=/bin/bash HAPPYHERD_REAL_NODE="$real_node" \
  HAPPYHERD_FAKE_NPM="$fake_bin/npm" \
  PATH="$fallback_bin:/usr/local/bin:/usr/bin:/bin" \
  "$installer" --source "$root" --server https://remote.example --no-start >/dev/null
[[ -x "$fallback_home/.local/share/happyherd/node/bin/node" ]]
[[ -x "$fallback_home/.local/bin/happyherd" ]]
HOME="$fallback_home" "$fallback_home/.local/share/happyherd/uninstall.sh" >/dev/null

settings_before_access=$(cat "$home/.happyherd/access.key")
settings_before_sessions=$(cat "$home/.happyherd/sessions.json")
provider_before=$(cat "$home/.codex/config.toml")
skill_before=$(cat "$home/.claude/skills/user-skill/SKILL.md")
test_log="$fixture/happy.log"

HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" PATH="$fake_bin:$PATH" \
  "$installer" --source "$root" --server https://remote.example --no-start >/dev/null

[[ -x "$home/.local/bin/happyherd" ]] ||
  fail 'installer did not expose the happyherd command'
[[ "$(cat "$home/.local/bin/happy")" == "$existing_happy" ]] ||
  fail 'installer replaced an existing unmanaged Happy command'
[[ ! -L "$home/.local/bin/happyherd" ]] ||
  fail 'installer left the exact legacy #98 launcher symlink in place'
[[ -f "$home/.local/share/happyherd/runtime/node_modules/happy-server-self-host/package.json" ]] ||
  fail 'installer omitted the existing self-host server package'
[[ ! -e "$home/.local/share/happyherd/source" && ! -e "$home/.local/share/happyherd/tooling" ]] ||
  fail 'installer retained temporary source or build tooling'
node -e '
  const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (s.serverUrl !== "https://remote.example" || s.webappUrl !== "https://remote.example") process.exit(1);
  if (s.machineId !== "keep-me" || s.theme !== "dark") process.exit(2);
' "$home/.happyherd/settings.json"

HAPPYHERD_TEST_LOG="$test_log" node \
  "$home/.local/share/happyherd/runtime/bin/happy.mjs" \
  server --host 127.0.0.1 --port 3005 --no-persist &
managed_test_pid=$!
printf '%s\n' "$managed_test_pid" > "$home/.happyherd/server.pid"
sleep 0.1
kill -0 "$managed_test_pid"

# A normal rerun is an upgrade, so it must retain an existing remote choice
# unless the user explicitly supplies or enters another endpoint.
HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" PATH="$fake_bin:$PATH" \
  "$installer" --source "$root" --no-start </dev/null >/dev/null
if kill -0 "$managed_test_pid" 2>/dev/null; then
  fail 'upgrade left the recorded installer-managed server running'
fi
managed_test_pid=''
[[ ! -e "$home/.happyherd/server.pid" ]]
node -e '
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

HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" PATH="$fake_bin:$PATH" \
  "$installer" --source "$root" --server http://127.0.0.1:3005 >/dev/null
grep -Fxq 'daemon start' "$test_log"

HOME="$home" "$home/.local/share/happyherd/uninstall.sh" >/dev/null
[[ ! -e "$home/.local/share/happyherd" && ! -e "$home/.local/bin/happyherd" ]]
[[ "$(cat "$home/.local/bin/happy")" == "$existing_happy" ]]
grep -Fxq 'daemon stop' "$test_log"
[[ -L "$home/.zprofile" ]]
[[ "$(stat -c '%a' "$home/.bashrc")" == 600 ]]
[[ "$(stat -c '%a' "$home/.zprofile-target")" == 600 ]]
if grep -Fq '# HappyHerd managed PATH' "$home/.bashrc"; then
  fail 'uninstaller left its PATH marker in .bashrc'
fi
if grep -Fq '# HappyHerd managed PATH' "$home/.zprofile"; then
  fail 'uninstaller left its PATH marker in a symlinked profile'
fi
[[ "$(cat "$home/.happyherd/access.key")" == "$settings_before_access" ]]
[[ "$(cat "$home/.happyherd/sessions.json")" == "$settings_before_sessions" ]]
[[ "$(cat "$home/.codex/config.toml")" == "$provider_before" ]]
[[ "$(cat "$home/.claude/skills/user-skill/SKILL.md")" == "$skill_before" ]]

# A wrapper from the previous HappyHerd installer is removed only when its
# marker and exact retired entry path both match.
rm -f -- "$home/.local/bin/happy"
cat > "$home/.local/bin/happy" <<EOF
#!/bin/sh
# HappyHerd managed command
exec "$real_node" "$legacy_happy_entry" "\$@"
EOF
chmod 755 "$home/.local/bin/happy"
HOME="$home" SHELL=/bin/bash HAPPYHERD_TEST_LOG="$test_log" PATH="$fake_bin:$PATH" \
  "$installer" --source "$root" --server https://remote.example --no-start >/dev/null
[[ ! -e "$home/.local/bin/happy" && ! -L "$home/.local/bin/happy" ]] ||
  fail 'installer retained the exact previously managed happy command'
[[ -x "$home/.local/bin/happyherd" ]]
HOME="$home" "$home/.local/share/happyherd/uninstall.sh" >/dev/null

cat > "$home/.local/bin/happyherd" <<'UNMANAGED_HAPPYHERD'
#!/bin/sh
echo unrelated-happyherd
UNMANAGED_HAPPYHERD
chmod 755 "$home/.local/bin/happyherd"
if HOME="$home" SHELL=/bin/bash PATH="$fake_bin:$PATH" \
  "$installer" --source "$root" --no-start >"$fixture/conflict.out" 2>&1; then
  fail 'installer replaced an unmanaged happyherd command'
fi
grep -Fq 'refusing to replace unmanaged command' "$fixture/conflict.out"
grep -Fq 'unrelated-happyherd' "$home/.local/bin/happyherd"

echo 'local-installer-contract: ok'
