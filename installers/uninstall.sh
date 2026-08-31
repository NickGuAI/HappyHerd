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

is_managed_happyherd_command() {
  is_managed_command_for_entry "$1" "$runtime_root/bin/happy.mjs" \
    || is_managed_command_for_entry "$1" "$runtime_root/bin/happyherd.mjs"
}

remove_managed_command_for_entry() {
  if is_managed_command_for_entry "$1" "$2"; then
    rm -f -- "$1"
  fi
}

if is_managed_happyherd_command "$bin_root/happyherd"; then
  "$bin_root/happyherd" daemon stop >/dev/null 2>&1 || true
fi
stop_managed_server

remove_managed_command_for_entry "$bin_root/happyherd" "$runtime_root/bin/happy.mjs"
remove_managed_command_for_entry "$bin_root/happyherd" "$runtime_root/bin/happyherd.mjs"
remove_managed_command_for_entry "$bin_root/happy" "$runtime_root/node_modules/happy/bin/happy.mjs"

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
