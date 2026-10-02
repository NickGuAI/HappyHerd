#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-}"
case "$target" in
  darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;;
  *) echo 'usage: test-native-installer-stable.sh TARGET' >&2; exit 1 ;;
esac
fixture="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/happyherd-stable-install.XXXXXX")"
evidence="${HAPPYHERD_INSTALLER_EVIDENCE_DIR:-$fixture/evidence}"
mkdir -p "$evidence"
evidence="$(cd "$evidence" && pwd)"
exec > >(tee "$evidence/acceptance.log") 2>&1

# Never inherit the invoking session's account, daemon, or provider context.
while IFS='=' read -r environment_name _; do
  case "$environment_name" in
    HAPPY_*|HAPPYHERD_*|CODEX_THREAD_ID|CLAUDE_SESSION_ID) unset "$environment_name" ;;
  esac
done < <(env)
export HOME="$fixture/home"
export HAPPY_HOME_DIR="$HOME/.happyherd"
export SHELL=/bin/sh
mkdir -p "$HOME"
cleanup() {
  status=$?
  if [[ "$status" -eq 0 && "$evidence" != "$fixture/"* ]]; then
    rm -rf "$fixture"
  else
    echo "Preserved isolated acceptance fixture: $fixture"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

asset="$fixture/happyherd-$target.tar.gz"
printf 'Candidate source: %s\nTarget: %s\n' "$(git -C "$repo_root" rev-parse HEAD)" "$target"
download_url="$(curl -fL --dump-header "$fixture/download-headers.txt" --write-out '%{url_effective}' \
  "https://github.com/NickGuAI/HappyHerd/releases/latest/download/happyherd-$target.tar.gz" -o "$asset")"
# The final CDN URL includes a temporary signature; keep only its public path.
printf 'Downloaded asset CDN path: %s\n' "${download_url%%\?*}"
awk 'tolower($1) == "location:" && $2 ~ /^https:\/\/github.com\/.*\/releases\/download\// {
  sub(/\r$/, "", $2); print "Resolved release asset: " $2
}' "$fixture/download-headers.txt"
rm "$fixture/download-headers.txt"
shasum -a 256 "$asset" "$repo_root/install.sh" | tee "$evidence/sha256.txt"
tar -tzf "$asset" > "$evidence/archive.txt"

# Retain the original regression as primary-artifact proof while latest still
# contains the pre-rename layout. Future releases need only the candidate smoke.
if grep -qx 'happyherd/runtime/bin/happy.mjs' "$evidence/archive.txt" \
  && ! grep -qx 'happyherd/runtime/bin/happyherd.mjs' "$evidence/archive.txt"; then
  baseline=793b05b8394cf1495834a6d2d0e24cb812b7a5c6
  curl -fsSL "https://raw.githubusercontent.com/NickGuAI/HappyHerd/$baseline/install.sh" \
    -o "$fixture/baseline-install.sh"
  shasum -a 256 "$fixture/baseline-install.sh" | tee -a "$evidence/sha256.txt"
  mkdir -p "$fixture/baseline-home"
  if HOME="$fixture/baseline-home" HAPPY_HOME_DIR="$fixture/baseline-home/.happyherd" \
    sh "$fixture/baseline-install.sh" --asset "$asset" --server https://remote.example --no-start \
    > "$evidence/baseline.log" 2>&1; then
    echo 'error: original installer unexpectedly accepted the pre-rename asset' >&2
    exit 1
  fi
  cat "$evidence/baseline.log"
  grep -Fq 'error: prepared release has no HappyHerd command' "$evidence/baseline.log"
  [[ ! -e "$fixture/baseline-home/.local/bin/happyherd" ]]
fi

# Make accidental use of a host runtime/compiler fail. The prepared Node must
# own execution; these sentinels do not mock download, platform, or user identity.
forbidden_bin="$fixture/forbidden-bin"
mkdir -p "$forbidden_bin"
for command_name in node npm pnpm bun cc c++ gcc g++ clang make cmake cargo rustc; do
  cat > "$forbidden_bin/$command_name" <<'FORBIDDEN_TOOL'
#!/bin/sh
echo "unexpected customer-side build or runtime tool: $0" >&2
exit 91
FORBIDDEN_TOOL
  chmod 755 "$forbidden_bin/$command_name"
done
export PATH="$forbidden_bin:$PATH"

# The README pipe-to-sh invocation uses the exact reviewed installer. Its asset
# resolution is untouched: no --asset or --version bypasses the live latest URL.
cat "$repo_root/install.sh" | sh -s -- --server https://remote.example --no-start
command_path="$HOME/.local/bin/happyherd"
install_root="$HOME/.local/share/happyherd"
node_bin="$install_root/node/bin/node"
"$command_path" --version | tee "$evidence/version.txt"
[[ -s "$evidence/version.txt" ]]
[[ "$(ls -A "$HOME/.local/bin")" == happyherd ]]
[[ ! -e "$HOME/.happyherd/server.pid" ]]
"$node_bin" - "$HOME/.happyherd/settings.json" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
if (settings.serverUrl !== 'https://remote.example' || settings.webappUrl !== 'https://remote.example') {
  throw new Error('explicit server selection was not preserved');
}
settings.machineId = 'preserve-disposable-machine';
settings.theme = 'dark';
fs.writeFileSync(path, JSON.stringify(settings));
NODE
printf 'preserve-disposable-session-state\n' > "$HOME/.happyherd/sessions.json"
cp "$HOME/.happyherd/sessions.json" "$fixture/sessions.before"

# Upgrade from the same unmodified downloaded release, reusing persisted server
# choice. This also ties a successful invocation to the recorded archive hash.
cat "$repo_root/install.sh" | sh -s -- --asset "$asset" --no-start
"$command_path" --version
"$node_bin" - "$HOME/.happyherd/settings.json" <<'NODE'
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (settings.serverUrl !== 'https://remote.example' || settings.webappUrl !== 'https://remote.example'
    || settings.machineId !== 'preserve-disposable-machine' || settings.theme !== 'dark') {
  throw new Error('upgrade changed persisted settings');
}
NODE
cmp "$fixture/sessions.before" "$HOME/.happyherd/sessions.json"
cp "$HOME/.happyherd/settings.json" "$fixture/settings.before-uninstall"
[[ "$(ls -A "$HOME/.local/bin")" == happyherd ]]
"$install_root/uninstall.sh"
[[ ! -e "$install_root" && ! -e "$command_path" ]]
cmp "$fixture/settings.before-uninstall" "$HOME/.happyherd/settings.json"
cmp "$fixture/sessions.before" "$HOME/.happyherd/sessions.json"
echo "native-installer-stable: ok ($target)"
