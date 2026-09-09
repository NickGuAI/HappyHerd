#!/bin/sh
set -eu

REPOSITORY="https://github.com/NickGuAI/HappyHerd"
DEFAULT_SERVER="http://127.0.0.1:3005"

server_url=""
asset_source=""
release_version=""
start_host=1

usage() {
  cat <<'EOF'
Install a prepared HappyHerd release into the current user's home directory.

Usage:
  install.sh [--server URL] [--version VERSION] [--asset FILE_OR_URL] [--no-start]

Options:
  --server URL         Persist this Happy server URL (default: http://127.0.0.1:3005).
  --version VERSION    Install a tagged release instead of the latest stable release.
  --asset FILE_OR_URL  Install a prepared platform asset directly.
  --no-start           Install and configure without starting the local server or daemon.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server)
      [ "$#" -ge 2 ] || { echo 'error: --server requires a URL' >&2; exit 1; }
      server_url="$2"
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || { echo 'error: --version requires a value' >&2; exit 1; }
      release_version="$2"
      shift 2
      ;;
    --asset)
      [ "$#" -ge 2 ] || { echo 'error: --asset requires a file or URL' >&2; exit 1; }
      asset_source="$2"
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

case "$(uname -s):$(uname -m)" in
  Darwin:arm64) target='darwin-arm64' ;;
  Darwin:x86_64) target='darwin-x64' ;;
  Linux:aarch64|Linux:arm64) target='linux-arm64' ;;
  Linux:x86_64) target='linux-x64' ;;
  *) echo "error: unsupported platform: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
asset_name="happyherd-$target.tar.gz"

if [ -z "$asset_source" ]; then
  if [ -n "$release_version" ]; then
    case "$release_version" in
      happyherd-v*) release_tag="$release_version" ;;
      v*) release_tag="happyherd-$release_version" ;;
      *) release_tag="happyherd-v$release_version" ;;
    esac
    asset_source="$REPOSITORY/releases/download/$release_tag/$asset_name"
  else
    asset_source="$REPOSITORY/releases/latest/download/$asset_name"
  fi
fi

install_root="$HOME/.local/share/happyherd"
runtime_root="$install_root/runtime"
node_root="$install_root/node"
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

is_managed_command_for_entry() {
  managed_check_path="$1"
  managed_check_entry="$2"
  [ -f "$managed_check_path" ] && [ ! -L "$managed_check_path" ] || return 1

  managed_line_1=''
  managed_line_2=''
  managed_line_3=''
  managed_extra=''
  {
    IFS= read -r managed_line_1 || return 1
    IFS= read -r managed_line_2 || return 1
    IFS= read -r managed_line_3 || [ -n "$managed_line_3" ] || return 1
    if IFS= read -r managed_extra || [ -n "$managed_extra" ]; then
      return 1
    fi
  } < "$managed_check_path"

  [ "$managed_line_1" = '#!/bin/sh' ] || return 1
  [ "$managed_line_2" = '# HappyHerd managed command' ] || return 1
  managed_bundled_line="PATH=\"$node_root/bin:\$PATH\" exec \"$node_root/bin/node\" \"$managed_check_entry\" \"\$@\""
  if [ "$managed_line_3" = "$managed_bundled_line" ]; then
    return 0
  fi

  managed_prefix='exec "'
  managed_suffix="\" \"$managed_check_entry\" \"\$@\""
  case "$managed_line_3" in
    "$managed_prefix"*"$managed_suffix") ;;
    *) return 1 ;;
  esac
  managed_node=${managed_line_3#"$managed_prefix"}
  managed_node=${managed_node%"$managed_suffix"}
  [ -n "$managed_node" ] || return 1
  case "$managed_node" in
    *'"'*) return 1 ;;
  esac
}

is_managed_command() {
  is_managed_command_for_entry "$1" "$runtime_root/bin/happy.mjs" \
    || is_managed_command_for_entry "$1" "$runtime_root/bin/happyherd.mjs"
}

check_happyherd_target() {
  command_path="$1"
  if is_managed_command "$command_path"; then
    return
  fi
  if [ -L "$command_path" ] \
    && [ "$(readlink "$command_path")" = "$(legacy_happyherd_target)" ]; then
    return
  fi
  if [ -e "$command_path" ] || [ -L "$command_path" ]; then
    echo "error: refusing to replace unmanaged command: $command_path" >&2
    exit 1
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
  expected_entry="$runtime_root/bin/happy.mjs server"
  legacy_expected_entry="$runtime_root/node_modules/happy/bin/happy.mjs server"
  case "$process_command" in
    *"$expected_entry"*|*"$legacy_expected_entry"*) ;;
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

check_happyherd_target "$bin_root/happyherd"
mkdir -p "$install_root" "$bin_root" "$(dirname "$settings_path")"
work_root=$(mktemp -d "$install_root/.install.XXXXXX")
stage_root="$work_root/stage"
mkdir -p "$stage_root"
cleanup() {
  rm -rf -- "$work_root"
}
trap cleanup EXIT HUP INT TERM
asset_archive="$work_root/$asset_name"

if [ -f "$asset_source" ]; then
  cp "$asset_source" "$asset_archive"
else
  case "$asset_source" in
    http://*|https://*) curl -fL "$asset_source" -o "$asset_archive" ;;
    *) echo "error: asset is not a readable file or HTTP URL: $asset_source" >&2; exit 1 ;;
  esac
fi

tar -xzf "$asset_archive" -C "$stage_root"
asset_root="$stage_root/happyherd"
staged_node="$asset_root/node/bin/node"
staged_runtime="$asset_root/runtime"
[ -x "$staged_node" ] || { echo 'error: prepared release has no Node runtime' >&2; exit 1; }
[ -f "$asset_root/node/LICENSE" ] || { echo 'error: prepared release has no Node license' >&2; exit 1; }
[ -f "$staged_runtime/bin/happy.mjs" ] || { echo 'error: prepared release has no HappyHerd command' >&2; exit 1; }
[ -x "$staged_runtime/tools/unpacked/rg" ] || { echo 'error: prepared release has no platform tools' >&2; exit 1; }
[ -f "$staged_runtime/node_modules/happy-server-self-host/package.json" ] || {
  echo 'error: prepared release has no self-host server' >&2
  exit 1
}
[ -f "$staged_runtime/node_modules/happy-server-self-host/webapp/index.html" ] || {
  echo 'error: prepared release has no Web app' >&2
  exit 1
}
[ -f "$asset_root/uninstall.sh" ] || { echo 'error: prepared release has no uninstaller' >&2; exit 1; }
[ -f "$asset_root/cleanup-legacy.sh" ] || { echo 'error: prepared release has no legacy cleanup' >&2; exit 1; }
"$staged_node" "$staged_runtime/bin/happy.mjs" --version >/dev/null

if is_managed_command "$bin_root/happyherd"; then
  "$bin_root/happyherd" daemon stop >/dev/null 2>&1 || true
fi
stop_managed_server
legacy_happy_entry="$runtime_root/node_modules/happy/bin/happy.mjs"
if is_managed_command_for_entry "$bin_root/happy" "$legacy_happy_entry"; then
  rm -f -- "$bin_root/happy"
fi
rm -rf -- "$runtime_root" "$node_root"
mv "$staged_runtime" "$runtime_root"
mv "$asset_root/node" "$node_root"
PATH="$node_root/bin:$PATH"
export PATH

happyherd_entry="$runtime_root/bin/happy.mjs"
node_bin="$node_root/bin/node"
install_command() {
  command_path="$1"
  entry_path="$2"
  check_happyherd_target "$command_path"
  if [ -L "$command_path" ]; then
    rm -f -- "$command_path"
  fi
  command_temporary=$(mktemp "$bin_root/.happyherd-command.XXXXXX")
  {
    echo '#!/bin/sh'
    echo '# HappyHerd managed command'
    # The installed wrapper must expand PATH when it runs, not while it is written.
    # shellcheck disable=SC2016
    printf 'PATH="%s/bin:$PATH" exec "%s" "%s" "$@"\n' "$node_root" "$node_bin" "$entry_path"
  } > "$command_temporary"
  chmod 755 "$command_temporary"
  mv -f -- "$command_temporary" "$command_path"
}
install_command "$bin_root/happyherd" "$happyherd_entry"

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

cp "$asset_root/uninstall.sh" "$install_root/uninstall.sh"
cp "$asset_root/cleanup-legacy.sh" "$install_root/cleanup-legacy.sh"
chmod 755 "$install_root/uninstall.sh" "$install_root/cleanup-legacy.sh"

auth_deferred=0
if [ "$start_host" -eq 1 ]; then
  if [ "$server_url" = "$DEFAULT_SERVER" ]; then
    if ! curl -fsS "$DEFAULT_SERVER/health" >/dev/null 2>&1; then
      nohup "$node_bin" "$happyherd_entry" server --host 127.0.0.1 --port 3005 --no-persist \
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
    "$node_bin" "$happyherd_entry" auth login < /dev/tty > /dev/tty 2>&1
    "$node_bin" "$happyherd_entry" daemon start
  elif "$node_bin" - "$settings_path" "$HOME/.happyherd/access.key" <<'NODE'
const fs = require('node:fs');
const settingsPath = process.argv[2];
const credentialsPath = process.argv[3];
if (!fs.existsSync(credentialsPath) || !fs.existsSync(settingsPath)) process.exit(1);
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
if (typeof settings.machineId !== 'string' || settings.machineId.length === 0) process.exit(1);
NODE
  then
    "$node_bin" "$happyherd_entry" daemon start
  else
    auth_deferred=1
  fi
fi

printf '\nHappyHerd installed.\n'
printf 'Server: %s\n' "$server_url"
printf 'Command: %s/happyherd\n' "$bin_root"
printf 'Open a new terminal, then run: happyherd --help\n'
[ "$auth_deferred" -eq 0 ] || printf 'Next: happyherd auth login && happyherd daemon start\n'
printf 'Uninstall code only: %s/uninstall.sh\n' "$install_root"
printf 'Normal Happy state in %s/.happyherd is preserved.\n' "$HOME"
