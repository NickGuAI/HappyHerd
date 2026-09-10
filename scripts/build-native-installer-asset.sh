#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

detect_target() {
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64) printf 'darwin-arm64\n' ;;
    Darwin:x86_64) printf 'darwin-x64\n' ;;
    Linux:aarch64|Linux:arm64) printf 'linux-arm64\n' ;;
    Linux:x86_64) printf 'linux-x64\n' ;;
    *) return 1 ;;
  esac
}

usage() {
  cat <<'EOF'
Build a native HappyHerd installer asset on its target platform.

Usage:
  build-native-installer-asset.sh --target TARGET --output-dir DIRECTORY
  build-native-installer-asset.sh --print-target
EOF
}

target=''
output_dir=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --target)
      [[ "$#" -ge 2 ]] || { usage >&2; exit 1; }
      target="$2"
      shift 2
      ;;
    --output-dir)
      [[ "$#" -ge 2 ]] || { usage >&2; exit 1; }
      output_dir="$2"
      shift 2
      ;;
    --print-target)
      detect_target || { echo 'unsupported build platform' >&2; exit 1; }
      exit 0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

[[ -n "$target" && -n "$output_dir" ]] || { usage >&2; exit 1; }
case "$target" in
  darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;;
  *) echo "error: unsupported target: $target" >&2; exit 1 ;;
esac
host_target="$(detect_target)" || { echo 'error: unsupported build platform' >&2; exit 1; }
[[ "$target" == "$host_target" ]] || {
  echo "error: $target must be built on $target, not $host_target" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || { echo 'error: Node.js is required to build an asset' >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo 'error: pnpm is required to build an asset' >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo 'error: tar is required to build an asset' >&2; exit 1; }
[[ "$(pnpm --version)" == 10.11.0 ]] || { echo 'error: pnpm 10.11.0 is required' >&2; exit 1; }
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" -ge 24 ]] || { echo 'error: Node.js 24 or newer is required' >&2; exit 1; }
[[ -d "$repo_root/server/node_modules" ]] || {
  echo 'error: install the frozen server workspace dependencies first' >&2
  exit 1
}

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"
work_parent="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
mkdir -p "$work_parent"
work_parent="$(cd "$work_parent" && pwd -P)"
work_root="$(mktemp -d "$work_parent/happyherd-native-asset.XXXXXX")"
cleanup() {
  rm -rf "$work_root"
}
trap cleanup EXIT HUP INT TERM

runtime_stage="$work_root/runtime"
server_stage="$work_root/server"
asset_root="$work_root/happyherd"
deployment_helper="$repo_root/scripts/prepare-native-installer-deployment.mjs"

deploy_locked() {
  package_name="$1"
  destination="$2"
  deploy_log="$work_root/$(printf '%s' "$package_name" | tr '/@' '__').log"

  set +e
  (
    cd "$repo_root/server"
    pnpm --frozen-lockfile --offline --ignore-scripts \
      --filter "$package_name" --fail-if-no-match deploy --prod "$destination"
  ) > "$deploy_log" 2>&1
  deploy_status=$?
  set -e
  if [[ "$deploy_status" -ne 0 ]] && ! grep -Fq 'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH' "$deploy_log"; then
    cat "$deploy_log" >&2
    return "$deploy_status"
  fi
  [[ -f "$destination/package.json" && -f "$destination/pnpm-lock.yaml" ]] || {
    cat "$deploy_log" >&2
    echo "error: pnpm did not prepare the $package_name deployment" >&2
    return 1
  }

  node "$deployment_helper" \
    --phase configure \
    --payload "$destination" \
    --server-root "$repo_root/server" \
    --package-name "$package_name"
  rm -rf "$destination/node_modules"
  (
    cd "$destination"
    pnpm fetch --prod --frozen-lockfile --ignore-scripts
    pnpm install --prod --frozen-lockfile --offline --ignore-scripts
  )
}

(
  cd "$repo_root/server"
  pnpm --filter @slopus/happy-wire --fail-if-no-match build
  pnpm --filter happy-agent --fail-if-no-match build
  pnpm --filter @happyherd/cli --fail-if-no-match build
  pnpm --filter happy-server-self-host --fail-if-no-match build
  pnpm --filter happy-server-self-host --fail-if-no-match bundle:webapp
)
deploy_locked @happyherd/cli "$runtime_stage"
deploy_locked happy-server-self-host "$server_stage"
node "$repo_root/server/patches/fix-pglite-prisma-bytes.cjs" "$server_stage"

[[ -f "$runtime_stage/bin/happy.mjs" ]] || { echo 'error: CLI deployment is incomplete' >&2; exit 1; }
[[ -f "$server_stage/package.json" ]] || { echo 'error: server deployment is incomplete' >&2; exit 1; }

node "$runtime_stage/scripts/unpack-tools.cjs"
server_package="$server_stage"
(
  cd "$server_package"
  PATH="$server_package/node_modules/.bin:$PATH" node scripts/postinstall.cjs
)
[[ -x "$runtime_stage/tools/unpacked/rg" ]] || { echo 'error: platform tools were not prepared' >&2; exit 1; }
[[ -f "$server_package/webapp/index.html" ]] || { echo 'error: Web app bundle was not prepared' >&2; exit 1; }

# The installed runtime already contains the unpacked tools. Release assets do
# not need the archives for every other platform. Linux builds use the glibc
# Node runtime supplied by the matching Ubuntu runner, so musl-only optional
# packages cannot be selected by that runtime either.
rm -rf "$runtime_stage/tools/archives"
if [[ "$target" == linux-* ]]; then
  while IFS= read -r musl_package; do
    rm -rf "$musl_package"
  done < <(
    find "$runtime_stage/node_modules" "$server_stage/node_modules" -type d \
      -path '*/node_modules/*' -name '*musl*' -prune -print
  )
fi

node "$deployment_helper" \
  --phase finalize \
  --payload "$runtime_stage" \
  --server-root "$repo_root/server" \
  --package-name @happyherd/cli
node "$deployment_helper" \
  --phase finalize \
  --payload "$server_stage" \
  --server-root "$repo_root/server" \
  --package-name happy-server-self-host

mkdir -p "$runtime_stage/node_modules"
mv "$server_stage" "$runtime_stage/node_modules/happy-server-self-host"

mkdir -p "$asset_root/node/bin"
mv "$runtime_stage" "$asset_root/runtime"
node_executable="$(node -p 'process.execPath')"
node_root="$(cd "$(dirname "$node_executable")/.." && pwd)"
[[ -f "$node_root/LICENSE" ]] || { echo 'error: Node.js LICENSE is missing from the build runtime' >&2; exit 1; }
cp "$node_executable" "$asset_root/node/bin/node"
cp "$node_root/LICENSE" "$asset_root/node/LICENSE"
chmod 755 "$asset_root/node/bin/node"
cp "$repo_root/installers/uninstall.sh" "$asset_root/uninstall.sh"
cp "$repo_root/installers/cleanup-legacy.sh" "$asset_root/cleanup-legacy.sh"
chmod 755 "$asset_root/uninstall.sh" "$asset_root/cleanup-legacy.sh"

"$asset_root/node/bin/node" "$asset_root/runtime/bin/happy.mjs" --version >/dev/null

asset_path="$output_dir/happyherd-$target.tar.gz"
tar -czf "$asset_path" -C "$work_root" happyherd
printf '%s\n' "$asset_path"
