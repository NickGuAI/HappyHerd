#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
asset="${1:-}"
target="${2:-}"
[[ -f "$asset" && -n "$target" ]] || {
  echo 'usage: test-native-installer-asset.sh ASSET TARGET' >&2
  exit 1
}
[[ "$(basename "$asset")" == "happyherd-$target.tar.gz" ]] || {
  echo 'error: asset name does not match target' >&2
  exit 1
}

fixture="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/happyherd-native-install.XXXXXX")"
archive_listing="$fixture/archive.txt"
test_home="$fixture/home"
cleanup() {
  if [[ -x "$test_home/.local/share/happyherd/uninstall.sh" ]]; then
    HOME="$test_home" "$test_home/.local/share/happyherd/uninstall.sh" >/dev/null 2>&1 || true
  fi
  rm -rf "$fixture"
}
trap cleanup EXIT HUP INT TERM

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

HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" "$repo_root/install.sh" \
  --asset "$asset" --server https://remote.example --no-start >/dev/null
"$test_home/.local/bin/happyherd" --version >/dev/null
"$test_home/.local/share/happyherd/node/bin/node" -e '
  const fs = require("node:fs");
  const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (settings.serverUrl !== "https://remote.example") process.exit(1);
  if (settings.machineId !== "preserve-machine" || settings.theme !== "dark") process.exit(2);
' "$test_home/.happyherd/settings.json"

HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" "$repo_root/install.sh" \
  --asset "$asset" --no-start </dev/null >/dev/null
cmp "$fixture/sessions.before" "$test_home/.happyherd/sessions.json"
"$test_home/.local/share/happyherd/node/bin/node" -e '
  const fs = require("node:fs");
  const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (settings.serverUrl !== "https://remote.example") process.exit(1);
' "$test_home/.happyherd/settings.json"

HOME="$test_home" SHELL=/bin/sh PATH="$customer_path" "$repo_root/install.sh" \
  --asset "$asset" --server http://127.0.0.1:3005 >/dev/null
curl -fsS http://127.0.0.1:3005/health >/dev/null
curl -fsS http://127.0.0.1:3005/ >/dev/null
[[ -f "$test_home/.happyherd/server.pid" ]]
cmp "$fixture/sessions.before" "$test_home/.happyherd/sessions.json"

HOME="$test_home" "$test_home/.local/share/happyherd/uninstall.sh" >/dev/null
[[ ! -e "$test_home/.local/share/happyherd" ]]
[[ ! -e "$test_home/.local/bin/happyherd" ]]
cmp "$fixture/sessions.before" "$test_home/.happyherd/sessions.json"

echo "native-installer-asset: ok ($target)"
