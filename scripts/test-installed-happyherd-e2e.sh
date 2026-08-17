#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
launcher="${1:?usage: test-installed-happyherd-e2e.sh LAUNCHER ISSUER_PORT}"
port="${2:?usage: test-installed-happyherd-e2e.sh LAUNCHER ISSUER_PORT}"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-issuer-e2e.XXXXXX")"
issuer_pid=''
spawn_marker="/tmp/happyherd-detached-e2e-$(id -u)-$$"
cleanup() {
  if [[ -n "$issuer_pid" ]]; then kill "$issuer_pid" >/dev/null 2>&1 || true; wait "$issuer_pid" 2>/dev/null || true; fi
  case "$spawn_marker" in /tmp/happyherd-detached-e2e-*) rm -f -- "$spawn_marker" ;; esac
  case "$fixture" in "${TMPDIR:-/tmp}"/happyherd-issuer-e2e.*) rm -rf -- "$fixture" ;; esac
}
trap cleanup EXIT INT TERM

issuer="http://127.0.0.1:$port"
case "$(uname -s)" in
  Linux)
    install_root="/opt/happyherd/$(id -u)"
    service_name="happyherd-broker-$(id -u).service"
    restart_broker() { sudo systemctl restart "$service_name"; }
    ;;
  Darwin)
    install_root="/Library/Application Support/HappyHerd/$(id -u)"
    service_name="dev.happyherd.broker.$(id -u)"
    restart_broker() { sudo launchctl kickstart -k "system/$service_name"; }
    ;;
  *) echo 'installed-happyherd-e2e: unsupported Unix platform' >&2; exit 1 ;;
esac
node "$root/server/packages/happyherd-cli/scripts/create-e2e-issuer-fixture.mjs" --output "$fixture" --issuer "$issuer" >/dev/null
node "$root/server/packages/happyherd-cli/scripts/run-e2e-issuer.mjs" --fixture "$fixture/fixture.json" >"$fixture/issuer.log" 2>&1 &
issuer_pid=$!
for _ in {1..50}; do grep -Fq 'issuer-ready' "$fixture/issuer.log" && break; sleep 0.1; done
grep -Fq "issuer-ready $issuer" "$fixture/issuer.log"

# The bearer capability in broker.json is readable only by the installation
# owner. A different local identity must fail both a raw read and the public
# client path before any broker request can be authenticated.
client_config="$install_root/client/broker.json"
spy_user=nobody
spy_uid=$(/usr/bin/id -u "$spy_user")
[ "$spy_uid" -ne "$(id -u)" ]
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

connect_output="$fixture/connect.out"
"$launcher" connect "$issuer" --no-open >"$connect_output"
grep -Fq 'Credential expires:' "$connect_output"
grep -Fq 'Approved scopes: guide.read' "$connect_output"
if grep -Fq 'happyherd-e2e-broker-only-token-value' "$connect_output"; then echo 'connect output exposed the broker token' >&2; exit 1; fi

"$launcher" install-skills --issuer "$issuer" >"$fixture/install.out"
grep -Fq 'Installed generic-e2e-skill-bundle@1.0.0' "$fixture/install.out"
test -f "$HOME/.claude/skills/generic-guide/SKILL.md"
test -f "$HOME/.codex/skills/generic-guide/SKILL.md"

"$launcher" launch claude --help >"$fixture/launch-claude.out"
grep -Fq 'happy - Claude Code On the Go' "$fixture/launch-claude.out"
grep -Fq 'happyherd-e2e claude help' "$fixture/launch-claude.out"
"$launcher" launch codex --help >"$fixture/launch-codex.out"
grep -Fq 'happyherd-e2e codex help' "$fixture/launch-codex.out"
"$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >"$fixture/tool.out"
grep -Fq '"result": "verified-e2e"' "$fixture/tool.out"
if grep -Fq 'happyherd-e2e-broker-only-token-value' "$fixture/tool.out"; then echo 'tool output exposed the broker token' >&2; exit 1; fi
test ! -e "$spawn_marker"
"$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/spawn.py -- "$spawn_marker" >"$fixture/spawn.out"
sleep 3
grep -Fq '"spawnDenied": true' "$fixture/spawn.out"
if [[ -e "$spawn_marker" ]]; then echo 'detached tool descendant survived its isolated launcher' >&2; exit 1; fi

# The provider tree belongs to the employee and remains manageable. If that
# user (or a compromised same-user agent) renames a managed child or replaces
# the entire .claude/.codex hierarchy, registry validation must observe the
# live namespace and refuse token-bearing execution. The canonical tool still
# lives only in the protected broker bundle root.
for provider in .claude .codex; do
  skills_root="$HOME/$provider/skills"
  managed="$skills_root/generic-guide"
  renamed="$skills_root/generic-guide.owner-renamed"
  mv "$managed" "$renamed"
  if "$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null 2>&1; then
    echo "tool execution ignored renamed managed Skill in $provider" >&2; exit 1
  fi
  mv "$renamed" "$managed"
  unrelated="$skills_root/employee-owned-skill"
  mkdir "$unrelated"
  printf '# Employee owned\n' >"$unrelated/SKILL.md"
  rm "$unrelated/SKILL.md"
  rmdir "$unrelated"
done

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

disconnect_output=$("$launcher" disconnect --all)
printf '%s\n' "$disconnect_output" | grep -Fq 'Removed 1 local issuer credential'
if "$launcher" run-tool --issuer "$issuer" --skill generic-guide --script scripts/check.py >/dev/null 2>&1; then
  echo 'tool execution succeeded after deleteAll removed the OS-store credential' >&2
  exit 1
fi
# Leave one live credential so the native uninstaller, rather than the test,
# proves it can purge the durable OS-store entry before removing the service.
"$launcher" connect "$issuer" --no-open >"$fixture/reconnect.out"
grep -Fq 'Credential expires:' "$fixture/reconnect.out"
echo 'installed-happyherd-e2e: ok'
