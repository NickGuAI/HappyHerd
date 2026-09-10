#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
asset="${1:-}"
target="${2:-}"
[[ ( -f "$asset" || "$asset" == --published ) && -n "$target" ]] || {
  echo 'usage: test-native-installer-asset.sh ASSET|--published TARGET' >&2
  exit 1
}
[[ "$asset" == --published || "$(basename "$asset")" == "happyherd-$target.tar.gz" ]] || {
  echo 'error: asset name does not match target' >&2
  exit 1
}

fixture="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/happyherd-native-install.XXXXXX")"
archive_listing="$fixture/archive.txt"
test_home="$fixture/home"
remote_home="$fixture/remote-home"
server_pid=''
assert_server_stopped() {
  [[ -n "$server_pid" ]] || return 0
  if kill -0 "$server_pid" 2>/dev/null; then
    echo "error: smoke server process $server_pid is still running" >&2
    return 1
  fi
  if curl --max-time 2 -fsS http://127.0.0.1:3005/health >/dev/null 2>&1; then
    echo 'error: smoke server health endpoint is still reachable after uninstall' >&2
    return 1
  fi
}
cleanup() {
  exit_status=$?
  if [[ -x "$remote_home/.local/share/happyherd/uninstall.sh" ]]; then
    HOME="$remote_home" HAPPY_HOME_DIR="$remote_home/.happyherd" \
      "$remote_home/.local/share/happyherd/uninstall.sh" >/dev/null 2>&1 || exit_status=1
  fi
  if [[ -z "$server_pid" && -f "$test_home/.happyherd/server.pid" ]]; then
    IFS= read -r server_pid < "$test_home/.happyherd/server.pid" || true
  fi
  if [[ -x "$test_home/.local/share/happyherd/uninstall.sh" ]]; then
    HOME="$test_home" "$test_home/.local/share/happyherd/uninstall.sh" >/dev/null 2>&1 || exit_status=1
  fi
  if ! assert_server_stopped; then
    echo "Preserved smoke fixture for inspection: $fixture" >&2
    exit 1
  fi
  rm -rf "$fixture"
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$asset" == --published ]]; then
  asset="$fixture/happyherd-$target.tar.gz"
  curl -fL "https://github.com/NickGuAI/HappyHerd/releases/latest/download/happyherd-$target.tar.gz" -o "$asset"
  installer=(bash -o pipefail -c \
    'curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh -s -- "$@"' \
    public-installer)
else
  installer=("$repo_root/install.sh" --asset "$asset")
fi

tar -tzf "$asset" > "$archive_listing"
if grep -Eq '^happyherd/runtime/tools/archives/|/node_modules/\.pnpm/|/pnpm-(lock|workspace)\.yaml$' \
  "$archive_listing"; then
  echo 'error: asset still contains build-time packaging files' >&2
  exit 1
fi
if [[ "$target" == linux-* ]] && grep -Ei '/[^/]*musl[^/]*/' "$archive_listing" >/dev/null; then
  echo 'error: glibc Linux asset still contains a musl-only package' >&2
  exit 1
fi

# A smoke run can be invoked from a live HappyHerd session. Every CLI child,
# including upgrade and cleanup, must use only this disposable test state.
while IFS='=' read -r environment_name _; do
  case "$environment_name" in
    HAPPY_*|HAPPYHERD_*|CODEX_THREAD_ID|CLAUDE_SESSION_ID)
      unset "$environment_name"
      ;;
  esac
done < <(env)
export HOME="$test_home"
export HAPPY_HOME_DIR="$test_home/.happyherd"
forbidden_bin="$fixture/forbidden-bin"
mkdir -p "$test_home/.happyherd" "$test_home/.local/bin" "$forbidden_bin"
printf '{"machineId":"preserve-machine","theme":"dark"}\n' > "$test_home/.happyherd/settings.json"
printf 'preserve-session-state\n' > "$test_home/.happyherd/sessions.json"
cp "$test_home/.happyherd/sessions.json" "$fixture/sessions.before"

for command_name in node npm pnpm bun cc c++ gcc g++ clang make cmake cargo rustc; do
  cat > "$forbidden_bin/$command_name" <<'FORBIDDEN_TOOL'
#!/bin/sh
echo "unexpected customer-side build or runtime tool: $0" >&2
exit 91
FORBIDDEN_TOOL
  chmod 755 "$forbidden_bin/$command_name"
done
customer_path="$forbidden_bin:$PATH"

HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" "${installer[@]}" \
  --server https://remote.example --no-start >/dev/null
"$test_home/.local/bin/happyherd" --version >/dev/null
"$test_home/.local/share/happyherd/node/bin/node" --test \
  "$repo_root/server/packages/happy-server-self-host/index.test.cjs"
"$test_home/.local/share/happyherd/node/bin/node" -e '
  const fs = require("node:fs");
  const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (settings.serverUrl !== "https://remote.example") process.exit(1);
  if (settings.machineId !== "preserve-machine" || settings.theme !== "dark") process.exit(2);
' "$test_home/.happyherd/settings.json"

HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" "${installer[@]}" \
  --no-start </dev/null >/dev/null
cmp "$fixture/sessions.before" "$test_home/.happyherd/sessions.json"
"$test_home/.local/share/happyherd/node/bin/node" -e '
  const fs = require("node:fs");
  const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (settings.serverUrl !== "https://remote.example") process.exit(1);
' "$test_home/.happyherd/settings.json"

if curl --max-time 2 -fsS http://127.0.0.1:3005/health >/dev/null 2>&1; then
  echo 'error: native installer smoke requires an unused localhost port 3005' >&2
  exit 1
fi
HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" "${installer[@]}" \
  --server http://127.0.0.1:3005 >/dev/null
IFS= read -r server_pid < "$test_home/.happyherd/server.pid"
[[ "$server_pid" =~ ^[0-9]+$ ]]
kill -0 "$server_pid"
process_command="$(ps -p "$server_pid" -o command=)"
[[ "$process_command" == *"--no-warnings --no-deprecation $test_home/.local/share/happyherd/runtime/bin/happy.mjs server "* ]]
curl -fsS http://127.0.0.1:3005/health >/dev/null
curl -fsS http://127.0.0.1:3005/ >/dev/null
[[ -f "$test_home/.happyherd/server.pid" ]]
cmp "$fixture/sessions.before" "$test_home/.happyherd/sessions.json"

# Exercise the real account pairing and daemon, keeping test keys in memory.
HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" \
  "$test_home/.local/share/happyherd/node/bin/node" "$repo_root/scripts/test-native-installer-auth.mjs" \
  "$test_home/.local/share/happyherd" "$test_home" http://127.0.0.1:3005 -- "${installer[@]}"
IFS= read -r server_pid < "$test_home/.happyherd/server.pid"

# A second host connects to the running server instead of owning a server.
HOME="$remote_home" HAPPY_HOME_DIR="$remote_home/.happyherd" SHELL=/bin/sh PATH="$customer_path" \
  "${installer[@]}" --server http://localhost:3005 --no-start >/dev/null
HOME="$remote_home" HAPPY_HOME_DIR="$remote_home/.happyherd" SHELL=/bin/sh PATH="$customer_path" \
  "$remote_home/.local/share/happyherd/node/bin/node" "$repo_root/scripts/test-native-installer-auth.mjs" \
  "$remote_home/.local/share/happyherd" "$remote_home" http://localhost:3005 -- "${installer[@]}"

HOME="$test_home" "$test_home/.local/share/happyherd/uninstall.sh" >/dev/null
assert_server_stopped
[[ ! -e "$test_home/.local/share/happyherd" ]]
[[ ! -e "$test_home/.local/bin/happyherd" ]]
cmp "$fixture/sessions.before" "$test_home/.happyherd/sessions.json"

echo "native-installer-asset: ok ($target)"
