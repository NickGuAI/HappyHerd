#!/bin/sh
set -eu

[ "$(id -u)" -ne 0 ] || {
  echo 'error: run this uninstaller as the user who installed HappyHerd' >&2
  exit 1
}

install_root="$HOME/.local/share/happyherd"
runtime_root="$install_root/runtime"
bin_root="$HOME/.local/bin"
managed_server_pid="$HOME/.happyherd/server.pid"

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

remove_managed_command() {
  command_path="$1"
  if [ -f "$command_path" ] && grep -Fq '# HappyHerd managed command' "$command_path"; then
    rm -f -- "$command_path"
  fi
}

if [ -f "$bin_root/happyherd" ] && [ ! -L "$bin_root/happyherd" ] \
  && grep -Fq '# HappyHerd managed command' "$bin_root/happyherd"; then
  "$bin_root/happyherd" daemon stop >/dev/null 2>&1 || true
fi
stop_managed_server

remove_managed_command "$bin_root/happyherd"
remove_managed_command "$bin_root/happy"

for profile_path in "$HOME/.zprofile" "$HOME/.bashrc"; do
  if [ -f "$profile_path" ]; then
    temporary=$(mktemp "${TMPDIR:-/tmp}/happyherd-profile.XXXXXX")
    sed '/# HappyHerd managed PATH$/d' "$profile_path" > "$temporary"
    cat "$temporary" > "$profile_path"
    rm -f -- "$temporary"
  fi
done

rm -rf -- "$install_root"

echo 'HappyHerd program files removed.'
echo "Preserved normal Happy state: $HOME/.happyherd"
echo 'To remove obsolete privileged #98 artifacts separately, run cleanup-legacy.sh before uninstalling.'
