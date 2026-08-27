#!/bin/sh
set -eu

REPOSITORY="https://github.com/NickGuAI/HappyHerd"
ARCHIVE_URL="$REPOSITORY/archive/refs/heads/main.tar.gz"
DEFAULT_SERVER="http://127.0.0.1:3005"
PNPM_VERSION="10.11.0"
BUN_VERSION="1.3.11"

server_url=""
source_path=""
start_host=1

usage() {
  cat <<'EOF'
Install HappyHerd into the current user's home directory.

Usage:
  install.sh [--server URL] [--source PATH] [--no-start]

Options:
  --server URL  Persist this Happy server URL (default: http://127.0.0.1:3005).
  --source PATH Build from an existing HappyHerd checkout instead of downloading main.
  --no-start    Install and configure without starting the local server or daemon.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server)
      [ "$#" -ge 2 ] || { echo 'error: --server requires a URL' >&2; exit 1; }
      server_url="$2"
      shift 2
      ;;
    --source)
      [ "$#" -ge 2 ] || { echo 'error: --source requires a path' >&2; exit 1; }
      source_path="$2"
      shift 2
      ;;
    --no-start)
      start_host=0
      shift
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

[ "$(id -u)" -ne 0 ] || {
  echo 'error: run this installer as your normal user, not with sudo' >&2
  exit 1
}

for command_name in curl tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "error: $command_name is required" >&2
    exit 1
  }
done

install_root="$HOME/.local/share/happyherd"
runtime_root="$install_root/runtime"
bin_root="$HOME/.local/bin"
settings_path="$HOME/.happyherd/settings.json"
managed_server_pid="$HOME/.happyherd/server.pid"

legacy_happyherd_target() {
  case "$(uname -s)" in
    Linux) printf '/opt/happyherd/%s/bin/happyherd\n' "$(id -u)" ;;
    Darwin) printf '/Library/Application Support/HappyHerd/%s/bin/happyherd\n' "$(id -u)" ;;
    *) printf '\n' ;;
  esac
}

is_managed_command() {
  [ -f "$1" ] && [ ! -L "$1" ] && grep -Fq '# HappyHerd managed command' "$1"
}

check_command_target() {
  command_path="$1"
  command_name="$2"
  if is_managed_command "$command_path"; then
    return
  fi
  if [ "$command_name" = happyherd ] && [ -L "$command_path" ] \
    && [ "$(readlink "$command_path")" = "$(legacy_happyherd_target)" ]; then
    return
  fi
  if [ -e "$command_path" ] || [ -L "$command_path" ]; then
    [ "$command_name" = happy ] || {
      echo "error: refusing to replace unmanaged command: $command_path" >&2
      exit 1
    }
  fi
}

stop_managed_server() {
  [ -f "$managed_server_pid" ] || return 0
  IFS= read -r server_pid < "$managed_server_pid" || server_pid=""
  case "$server_pid" in
    ''|*[!0-9]*) rm -f -- "$managed_server_pid"; return 0 ;;
  esac
  if ! kill -0 "$server_pid" 2>/dev/null; then
    rm -f -- "$managed_server_pid"
    return 0
  fi
  process_command=$(ps -p "$server_pid" -o command= 2>/dev/null || true)
  expected_entry="$runtime_root/node_modules/happy/bin/happy.mjs server"
  case "$process_command" in
    *"$expected_entry"*) ;;
    *) rm -f -- "$managed_server_pid"; return 0 ;;
  esac
  kill "$server_pid"
  stop_attempt=0
  while kill -0 "$server_pid" 2>/dev/null && [ "$stop_attempt" -lt 100 ]; do
    stop_attempt=$((stop_attempt + 1))
    sleep 0.1
  done
  kill -0 "$server_pid" 2>/dev/null && {
    echo 'error: the installer-managed local server did not stop' >&2
    return 1
  }
  rm -f -- "$managed_server_pid"
}

has_terminal() {
  [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null
}

check_command_target "$bin_root/happy" happy
check_command_target "$bin_root/happyherd" happyherd
mkdir -p "$install_root" "$bin_root" "$(dirname "$settings_path")"
work_root=$(mktemp -d "${TMPDIR:-/tmp}/happyherd-install.XXXXXX")
tooling_root="$work_root/tooling"
cleanup() {
  rm -rf -- "$work_root"
}
trap cleanup EXIT HUP INT TERM

node_bin=""
npm_bin=""
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
  if [ "$node_major" -ge 20 ]; then
    node_bin=$(command -v node)
    npm_bin=$(command -v npm)
  fi
fi

if [ -z "$node_bin" ]; then
  os=$(uname -s)
  arch=$(uname -m)
  case "$os:$arch" in
    Darwin:arm64) node_target='darwin-arm64' ;;
    Darwin:x86_64) node_target='darwin-x64' ;;
    Linux:aarch64|Linux:arm64) node_target='linux-arm64' ;;
    Linux:x86_64) node_target='linux-x64' ;;
    *) echo "error: unsupported platform: $os $arch" >&2; exit 1 ;;
  esac

  node_listing=$(curl -fsSL 'https://nodejs.org/dist/latest-v22.x/')
  node_archive=$(printf '%s\n' "$node_listing" | sed -n "s/.*href=\"[^\"]*\/\(node-v[^\"]*-$node_target\\.tar\\.gz\)\".*/\1/p" | head -n 1)
  [ -n "$node_archive" ] || { echo 'error: could not find the current Node.js archive' >&2; exit 1; }
  curl -fL "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$work_root/node.tar.gz"
  rm -rf -- "$install_root/node"
  mkdir -p "$install_root/node"
  tar -xzf "$work_root/node.tar.gz" -C "$install_root/node" --strip-components=1
  node_bin="$install_root/node/bin/node"
  npm_bin="$install_root/node/bin/npm"
fi

rm -rf -- "$tooling_root"
mkdir -p "$tooling_root"
npm_config_cache="$work_root/npm-cache" \
  PATH="$(dirname "$node_bin"):$PATH" "$npm_bin" install --global --prefix "$tooling_root" \
  "pnpm@$PNPM_VERSION" "bun@$BUN_VERSION" --no-audit --no-fund
pnpm_bin="$tooling_root/bin/pnpm"

if [ -n "$source_path" ]; then
  source_root=$(CDPATH='' cd -- "$source_path" && pwd)
  [ -f "$source_root/server/pnpm-workspace.yaml" ] || {
    echo "error: not a HappyHerd source checkout: $source_root" >&2
    exit 1
  }
else
  curl -fL "$ARCHIVE_URL" -o "$work_root/happyherd.tar.gz"
  source_root="$work_root/source"
  mkdir -p "$source_root"
  tar -xzf "$work_root/happyherd.tar.gz" -C "$source_root" --strip-components=1
fi

PATH="$tooling_root/bin:$(dirname "$node_bin"):$PATH"
export PATH
npm_config_store_dir="$work_root/pnpm-store"
export npm_config_store_dir
CI=1
export CI
(
  cd "$source_root/server"
  "$pnpm_bin" install --frozen-lockfile --ignore-scripts \
    --filter @happyherd/cli... \
    --filter happy-server-self-host... \
    --filter happy-server... \
    --filter happy-app...
  SKIP_HAPPY_WIRE_BUILD=1 "$pnpm_bin" exec node scripts/postinstall.cjs
  "$pnpm_bin" --filter happy-app --fail-if-no-match exec patch-package
  "$pnpm_bin" --filter happy-app --fail-if-no-match exec setup-skia-web public
  "$pnpm_bin" --filter happy-server --fail-if-no-match generate
  "$pnpm_bin" --filter @slopus/happy-wire --fail-if-no-match build
  "$pnpm_bin" --filter happy-agent --fail-if-no-match build
  "$pnpm_bin" --filter happy --fail-if-no-match build
  "$pnpm_bin" --filter happy-server-self-host --fail-if-no-match build
  "$pnpm_bin" --filter happy-server-self-host --fail-if-no-match bundle:webapp
  "$pnpm_bin" --filter @happyherd/cli --fail-if-no-match build
  "$pnpm_bin" --ignore-scripts --filter @happyherd/cli --fail-if-no-match \
    deploy --legacy --prod "$work_root/runtime"
  "$pnpm_bin" --ignore-scripts --filter happy-server-self-host --fail-if-no-match \
    deploy --legacy --prod "$work_root/server"
)

[ -f "$work_root/runtime/bin/happyherd.mjs" ] || {
  echo 'error: the HappyHerd command was not built' >&2
  exit 1
}
[ -f "$work_root/runtime/node_modules/happy/bin/happy.mjs" ] || {
  echo 'error: the Happy command was not deployed' >&2
  exit 1
}
[ -f "$work_root/server/package.json" ] || {
  echo 'error: the local Happy server was not deployed' >&2
  exit 1
}
mv "$work_root/server" "$work_root/runtime/node_modules/happy-server-self-host"

happy_package="$work_root/runtime/node_modules/happy"
server_package="$work_root/runtime/node_modules/happy-server-self-host"
if [ -f "$happy_package/scripts/unpack-tools.cjs" ]; then
  "$node_bin" "$happy_package/scripts/unpack-tools.cjs"
fi
if [ -f "$server_package/scripts/postinstall.cjs" ]; then
  (
    cd "$server_package"
    PATH="$server_package/node_modules/.bin:$PATH" "$node_bin" scripts/postinstall.cjs
  )
fi
[ -x "$happy_package/tools/unpacked/rg" ] || {
  echo 'error: the Happy command tools were not unpacked' >&2
  exit 1
}

happy_entry="$runtime_root/node_modules/happy/bin/happy.mjs"
happyherd_entry="$runtime_root/bin/happyherd.mjs"
if is_managed_command "$bin_root/happyherd"; then
  "$bin_root/happyherd" daemon stop >/dev/null 2>&1 || true
fi
stop_managed_server
rm -rf -- "$runtime_root"
mv "$work_root/runtime" "$runtime_root"

install_command() {
  command_path="$1"
  entry_path="$2"
  command_name="$3"
  check_command_target "$command_path" "$command_name"
  if [ "$command_name" = happy ] && ! is_managed_command "$command_path" \
    && { [ -e "$command_path" ] || [ -L "$command_path" ]; }; then
    printf 'Preserved existing command: %s\n' "$command_path"
    return
  fi
  if [ -L "$command_path" ]; then
    rm -f -- "$command_path"
  fi
  command_temporary=$(mktemp "$bin_root/.happyherd-command.XXXXXX")
  {
    echo '#!/bin/sh'
    echo '# HappyHerd managed command'
    printf 'exec "%s" "%s" "$@"\n' "$node_bin" "$entry_path"
  } > "$command_temporary"
  chmod 755 "$command_temporary"
  mv -f -- "$command_temporary" "$command_path"
}
install_command "$bin_root/happy" "$happy_entry" happy
install_command "$bin_root/happyherd" "$happyherd_entry" happyherd

profile_path="$HOME/.zprofile"
case "${SHELL:-}" in
  */bash) profile_path="$HOME/.bashrc" ;;
esac
path_line="export PATH=\"\$HOME/.local/bin:\$PATH\" # HappyHerd managed PATH"
if ! grep -Fq '# HappyHerd managed PATH' "$profile_path" 2>/dev/null; then
  printf '\n%s\n' "$path_line" >> "$profile_path"
fi

if [ -z "$server_url" ]; then
  saved_server_url=$("$node_bin" - "$settings_path" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
if (!fs.existsSync(path)) process.exit(0);
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
if (typeof settings.serverUrl === 'string' && settings.serverUrl.length > 0) {
  process.stdout.write(settings.serverUrl);
}
NODE
  )
  server_default=${saved_server_url:-$DEFAULT_SERVER}
  response=""
  if has_terminal; then
    printf 'Happy server URL [%s]: ' "$server_default" > /dev/tty
    IFS= read -r response < /dev/tty || true
  fi
  server_url=${response:-$server_default}
fi

"$node_bin" - "$settings_path" "$server_url" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const serverUrl = process.argv[3];
let settings = {};
if (fs.existsSync(path)) settings = JSON.parse(fs.readFileSync(path, 'utf8'));
settings.serverUrl = serverUrl;
settings.webappUrl = serverUrl;
const temporary = `${path}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, path);
NODE

cp "$source_root/installers/uninstall.sh" "$install_root/uninstall.sh"
cp "$source_root/installers/cleanup-legacy.sh" "$install_root/cleanup-legacy.sh"
chmod 755 "$install_root/uninstall.sh" "$install_root/cleanup-legacy.sh"

auth_deferred=0
if [ "$start_host" -eq 1 ]; then
  if [ "$server_url" = "$DEFAULT_SERVER" ]; then
    if ! curl -fsS "$DEFAULT_SERVER/health" >/dev/null 2>&1; then
      nohup "$node_bin" "$happy_entry" server --host 127.0.0.1 --port 3005 --no-persist \
        > "$HOME/.happyherd/server.log" 2>&1 < /dev/null &
      echo "$!" > "$managed_server_pid"
    fi
    health_attempt=0
    until curl -fsS "$DEFAULT_SERVER/health" >/dev/null 2>&1; do
      health_attempt=$((health_attempt + 1))
      if [ "$health_attempt" -ge 60 ]; then
        stop_managed_server || true
        echo 'error: the local Happy server did not become ready' >&2
        exit 1
      fi
      sleep 1
    done
  fi

  if has_terminal; then
    "$node_bin" "$happy_entry" auth login < /dev/tty > /dev/tty 2>&1
    "$node_bin" "$happy_entry" daemon start
  elif "$node_bin" - "$settings_path" "$HOME/.happyherd/access.key" <<'NODE'
const fs = require('node:fs');
const settingsPath = process.argv[2];
const credentialsPath = process.argv[3];
if (!fs.existsSync(credentialsPath) || !fs.existsSync(settingsPath)) process.exit(1);
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
if (typeof settings.machineId !== 'string' || settings.machineId.length === 0) process.exit(1);
NODE
  then
    "$node_bin" "$happy_entry" daemon start
  else
    auth_deferred=1
  fi
fi

printf '\nHappyHerd installed.\n'
printf 'Server: %s\n' "$server_url"
printf 'Commands: %s/happyherd and %s/happy\n' "$bin_root" "$bin_root"
printf 'Open a new terminal, then run: happyherd --help\n'
[ "$auth_deferred" -eq 0 ] || \
  printf 'Next: happyherd auth login && happyherd daemon start\n'
printf 'Uninstall code only: %s/uninstall.sh\n' "$install_root"
printf 'Normal Happy state in %s/.happyherd is preserved.\n' "$HOME"
