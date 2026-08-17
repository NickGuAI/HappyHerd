#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
launcher="${1:?usage: test-installed-happyherd-e2e.sh LAUNCHER ISSUER_PORT}"
port="${2:?usage: test-installed-happyherd-e2e.sh LAUNCHER ISSUER_PORT}"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-issuer-e2e.XXXXXX")"
issuer_pid=''
spawn_marker="/tmp/happyherd-detached-e2e-$(id -u)-$$"
current_step='bootstrap'
failure_report() {
  status=$?
  printf 'installed-happyherd-e2e: failed during %s near line %s\n' \
    "$current_step" "${BASH_LINENO[0]:-unknown}" >&2
  exit "$status"
}
cleanup() {
  if [[ -n "$issuer_pid" ]]; then kill "$issuer_pid" >/dev/null 2>&1 || true; wait "$issuer_pid" 2>/dev/null || true; fi
  case "$spawn_marker" in /tmp/happyherd-detached-e2e-*) rm -f -- "$spawn_marker" ;; esac
  case "$fixture" in "${TMPDIR:-/tmp}"/happyherd-issuer-e2e.*) rm -rf -- "$fixture" ;; esac
}
trap cleanup EXIT INT TERM
trap failure_report ERR

issuer="http://127.0.0.1:$port"
case "$(uname -s)" in
  Linux)
    install_root="/opt/happyherd/$(id -u)"
    service_name="happyherd-broker-$(id -u).service"
    restart_broker() { sudo systemctl restart "$service_name"; }
    ;;
  Darwin)
    install_root="/Library/Application Support/HappyHerd/$(id -u)"
    state_root="/Library/Application Support/HappyHerd/Broker/$(id -u)"
    service_user="happyherd$(id -u)"
    service_name="dev.happyherd.broker.$(id -u)"
    keychain_path="$state_root/Library/Keychains/happyherd.keychain-db"
    keychain_master="/Library/Application Support/HappyHerd/Secrets/$(id -u)/keychain-master"
    restart_broker() { sudo launchctl kickstart -k "system/$service_name"; }
    ;;
  *) echo 'installed-happyherd-e2e: unsupported Unix platform' >&2; exit 1 ;;
esac
current_step='issuer startup'
node "$root/server/packages/happyherd-cli/scripts/create-e2e-issuer-fixture.mjs" --output "$fixture" --issuer "$issuer" >/dev/null
node "$root/server/packages/happyherd-cli/scripts/run-e2e-issuer.mjs" --fixture "$fixture/fixture.json" >"$fixture/issuer.log" 2>&1 &
issuer_pid=$!
for _ in {1..50}; do grep -Fq 'issuer-ready' "$fixture/issuer.log" && break; sleep 0.1; done
grep -Fq "issuer-ready $issuer" "$fixture/issuer.log"

# The bearer capability in broker.json is readable only by the installation
# owner. A different local identity must fail both a raw read and the public
# client path before any broker request can be authenticated.
client_config="$install_root/client/broker.json"
current_step='cross-user isolation'
spy_user=nobody
spy_uid=$(/usr/bin/id -u "$spy_user")
[ "$spy_uid" -ne "$(id -u)" ]
if [[ "$(uname -s)" == Darwin ]]; then
  master_metadata=$(sudo /usr/bin/stat -f '%u:%g:%Lp:%z:%l' "$keychain_master")
  [[ "$master_metadata" == '0:0:400:64:1' ]]
  if /usr/bin/head -c 1 "$keychain_master" >/dev/null 2>&1; then
    echo 'installation owner read the root-only Keychain unlock master without elevation' >&2; exit 1
  fi
  if sudo -u "$spy_user" /usr/bin/head -c 1 "$keychain_master" >/dev/null 2>&1; then
    echo 'another local user read the root-only Keychain unlock master' >&2; exit 1
  fi
fi
if sudo -u "$spy_user" /usr/bin/head -c 1 "$client_config" >/dev/null 2>&1; then
  echo 'another local user read the broker client capability' >&2; exit 1
fi
if sudo -u "$spy_user" env -i HOME=/tmp PATH=/usr/bin:/bin "$install_root/bin/happyherd" doctor >/dev/null 2>&1; then
  echo 'another local user authenticated to the broker through doctor' >&2; exit 1
fi
if sudo -u "$spy_user" env -i HOME=/tmp PATH=/usr/bin:/bin "$install_root/bin/happyherd" \
  run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null 2>&1; then
  echo 'another local user authenticated to run-tool' >&2; exit 1
fi

current_step='issuer connection'
connect_output="$fixture/connect.out"
"$launcher" connect "$issuer" --no-open >"$connect_output"
grep -Fq 'Credential expires:' "$connect_output"
grep -Fq 'Approved scopes: guide.read' "$connect_output"
if grep -Fq 'happyherd-e2e-broker-only-token-value' "$connect_output"; then echo 'connect output exposed the broker token' >&2; exit 1; fi

current_step='Skill installation'
"$launcher" install-skills --issuer "$issuer" >"$fixture/install.out"
grep -Fq 'Installed generic-e2e-skill-bundle@1.0.0' "$fixture/install.out"
test -f "$HOME/.claude/skills/generic-guide/SKILL.md"
test -f "$HOME/.codex/skills/generic-guide/SKILL.md"

current_step='provider launch'
"$launcher" launch claude --help >"$fixture/launch-claude.out"
grep -Fq 'happy - Claude Code On the Go' "$fixture/launch-claude.out"
grep -Fq 'happyherd-e2e claude help' "$fixture/launch-claude.out"
"$launcher" launch codex --help >"$fixture/launch-codex.out"
grep -Fq 'happyherd-e2e codex help' "$fixture/launch-codex.out"
current_step='verified tool execution'
"$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >"$fixture/tool.out"
grep -Fq '"result": "verified-e2e"' "$fixture/tool.out"
if grep -Fq 'happyherd-e2e-broker-only-token-value' "$fixture/tool.out"; then echo 'tool output exposed the broker token' >&2; exit 1; fi
current_step='detached-descendant denial'
test ! -e "$spawn_marker"
"$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/spawn.py -- "$spawn_marker" >"$fixture/spawn.out"
sleep 3
if ! grep -Fq '"spawnDenied": true' "$fixture/spawn.out" || [[ -e "$spawn_marker" ]]; then
  printf 'detached-descendant evidence (bounded):\n' >&2
  /usr/bin/head -c 4096 "$fixture/spawn.out" >&2 || true
  printf '\nmarkerPresent=%s\n' "$(if [[ -e "$spawn_marker" ]]; then printf yes; else printf no; fi)" >&2
  exit 1
fi

# Managed provider copies are never trusted as the executable source. macOS
# prevents the employee from mutating a service-created managed child; Linux
# permits an owner-controlled parent rename, so live registry validation must
# detect it and refuse token-bearing execution. Unrelated employee Skills stay
# manageable on both platforms. The canonical tool lives only in the protected
# broker bundle root.
current_step='managed Skill namespace tamper denial'
for provider in .claude .codex; do
  skills_root="$HOME/$provider/skills"
  managed="$skills_root/generic-guide"
  renamed="$skills_root/generic-guide.owner-renamed"
  if [[ "$(uname -s)" == Darwin ]]; then
    if mv "$managed" "$renamed" 2>/dev/null; then
      mv "$renamed" "$managed"
      echo "employee renamed a macOS managed Skill in $provider" >&2; exit 1
    fi
    write_probe="$managed/.employee-write-probe"
    if { printf 'tamper\n' >"$write_probe"; } 2>/dev/null; then
      rm -f -- "$write_probe"
      echo "employee wrote inside a macOS managed Skill in $provider" >&2; exit 1
    fi
    "$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null
  else
    mv "$managed" "$renamed"
    if "$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null 2>&1; then
      echo "tool execution ignored renamed managed Skill in $provider" >&2; exit 1
    fi
    mv "$renamed" "$managed"
  fi
  unrelated="$skills_root/employee-owned-skill"
  mkdir "$unrelated"
  printf '# Employee owned\n' >"$unrelated/SKILL.md"
  rm "$unrelated/SKILL.md"
  rmdir "$unrelated"
done

current_step='provider hierarchy tamper denial'
provider_backup="$HOME/.claude.happyherd-e2e-original"
test ! -e "$provider_backup"
mv "$HOME/.claude" "$provider_backup"
mkdir -p "$HOME/.claude/skills/generic-guide"
printf '# Hostile replacement\n' >"$HOME/.claude/skills/generic-guide/SKILL.md"
if "$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null 2>&1; then
  echo 'tool execution ignored whole .claude hierarchy replacement' >&2; exit 1
fi
rm "$HOME/.claude/skills/generic-guide/SKILL.md"
rmdir "$HOME/.claude/skills/generic-guide" "$HOME/.claude/skills" "$HOME/.claude"
mv "$provider_backup" "$HOME/.claude"
"$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >"$fixture/tool-after-provider-restore.out"
grep -Fq '"result": "verified-e2e"' "$fixture/tool-after-provider-restore.out"

# The long-lived issuer token must survive a real service/OS-store restart and
# remain unavailable to the owner process itself.
current_step='broker restart persistence'
if [[ "$(uname -s)" == Darwin ]]; then
  sudo -u "$service_user" env HOME="$state_root" /usr/bin/security lock-keychain "$keychain_path"
fi
restart_broker
for _ in {1..50}; do "$launcher" doctor >/dev/null 2>&1 && break; sleep 0.2; done
"$launcher" doctor >/dev/null
"$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >"$fixture/tool-after-restart.out"
grep -Fq '"result": "verified-e2e"' "$fixture/tool-after-restart.out"
keyring_module="$install_root/runtime/node_modules/@napi-rs/keyring"
env -u DBUS_SESSION_BUS_ADDRESS -u GNOME_KEYRING_CONTROL \
  "$install_root/native/node" -e '
const keyring=require(process.argv[1]);
try { if(keyring.findCredentials("dev.happyherd.issuer.v1").length!==0)process.exit(9); }
catch { /* no owner Secret Service session is also a successful denial */ }
' "$keyring_module"

current_step='credential revocation'
disconnect_output=$("$launcher" disconnect --all)
printf '%s\n' "$disconnect_output" | grep -Fq 'Removed 1 local issuer credential'
if "$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null 2>&1; then
  echo 'tool execution succeeded after deleteAll removed the OS-store credential' >&2
  exit 1
fi
# Leave one live credential so the native uninstaller, rather than the test,
# proves it can purge the durable OS-store entry before removing the service.
current_step='credential reconnect for uninstall proof'
"$launcher" connect "$issuer" --no-open >"$fixture/reconnect.out"
grep -Fq 'Credential expires:' "$fixture/reconnect.out"
echo 'installed-happyherd-e2e: ok'
