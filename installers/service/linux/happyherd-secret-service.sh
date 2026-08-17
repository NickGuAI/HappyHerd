#!/bin/sh
set -eu

PATH=/usr/bin:/bin
export PATH
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy HAPPYHERD_ACCESS_TOKEN
umask 077

fail() {
  printf 'happyherd secret-service: %s\n' "$*" >&2
  exit 1
}

[ "$#" -eq 4 ] || fail 'expected bundled Node, broker script, broker config, and state root'
[ "$(id -u)" -ne 0 ] || fail 'the broker must not run as root'

node_runtime=$1
broker_script=$2
broker_config=$3
state_root=$4
case "$node_runtime:$broker_script:$broker_config:$state_root" in
  /*:/*:/*:/*) ;;
  *) fail 'all broker paths must be absolute' ;;
esac
for path in "$node_runtime" "$broker_script" "$broker_config"; do
  [ -f "$path" ] && [ ! -L "$path" ] || fail "required broker asset is unsafe: $path"
done
[ -x "$node_runtime" ] || fail 'bundled Node runtime is not executable'
[ -d "$state_root" ] && [ ! -L "$state_root" ] || fail 'broker state root is unsafe'

credential_directory=${CREDENTIALS_DIRECTORY:-}
runtime_directory=${RUNTIME_DIRECTORY:-}
case "$credential_directory:$runtime_directory" in
  /*:/*) ;;
  *) fail 'systemd credential and runtime directories are required' ;;
esac
credential="$credential_directory/happyherd-keyring-password"
[ -f "$credential" ] && [ ! -L "$credential" ] && [ -r "$credential" ] \
  || fail 'encrypted keyring credential was not mounted for this service activation'

for command_path in /usr/bin/dbus-run-session /usr/bin/gnome-keyring-daemon; do
  [ -x "$command_path" ] || fail "required Secret Service component is unavailable: $command_path"
done

export HOME="$state_root"
export XDG_CONFIG_HOME="$state_root/.config"
export XDG_DATA_HOME="$state_root/.local/share"
export XDG_CACHE_HOME="$state_root/.cache"
export XDG_RUNTIME_DIR="$runtime_directory"
export GNOME_KEYRING_CONTROL="$runtime_directory/keyring"
/usr/bin/mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME/keyrings" "$XDG_CACHE_HOME" "$GNOME_KEYRING_CONTROL"

# gnome-keyring reads the stable, host-sealed password from stdin. It never
# appears in argv, an environment variable, a log, or the filesystem outside
# systemd's per-activation credential mount. The daemon and broker share the
# dbus-run-session created by the systemd unit.
/usr/bin/gnome-keyring-daemon \
  --unlock \
  --components=secrets \
  --control-directory="$GNOME_KEYRING_CONTROL" \
  < "$credential" \
  >/dev/null

exec "$node_runtime" "$broker_script" broker-service --config "$broker_config"
