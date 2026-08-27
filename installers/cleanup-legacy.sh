#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || {
  echo 'error: legacy privileged cleanup must be run with sudo' >&2
  exit 1
}

owner_uid=${SUDO_UID:-}
owner_user=${SUDO_USER:-}
case "$owner_uid" in
  ''|*[!0-9]*)
    echo 'error: sudo owner UID is invalid' >&2
    exit 1
    ;;
esac
if [ -z "$owner_uid" ] || [ "$owner_uid" -eq 0 ]; then
  echo 'error: run with sudo from the user whose legacy HappyHerd install is being removed' >&2
  exit 1
fi
case "$owner_user" in
  ''|*[!A-Za-z0-9._-]*)
    echo 'error: sudo owner name is invalid' >&2
    exit 1
    ;;
esac
[ "$(id -u "$owner_user")" = "$owner_uid" ] || {
  echo 'error: sudo owner name and UID do not match' >&2
  exit 1
}

remove_legacy_profile_blocks() {
  for profile_path in "$owner_home/.profile" "$owner_home/.bash_profile" "$owner_home/.zprofile"; do
    [ -f "$profile_path" ] || continue
    grep -Fq '# >>> HappyHerd managed PATH >>>' "$profile_path" || continue
    grep -Fq '# <<< HappyHerd managed PATH <<<' "$profile_path" || continue
    profile_temporary=$(mktemp "${TMPDIR:-/tmp}/happyherd-legacy-profile.XXXXXX")
    awk '
      /# >>> HappyHerd managed PATH >>>/ { managed = 1; next }
      /# <<< HappyHerd managed PATH <<</ { managed = 0; next }
      !managed { print }
    ' "$profile_path" > "$profile_temporary"
    cat "$profile_temporary" > "$profile_path"
    rm -f -- "$profile_temporary"
  done
}

remove_legacy_link() {
  link_path="$owner_home/.local/bin/happyherd"
  if [ -L "$link_path" ] && [ "$(readlink "$link_path")" = "$legacy_link_target" ]; then
    rm -f -- "$link_path"
  fi
}

case "$(uname -s)" in
  Linux)
    owner_home=$(getent passwd "$owner_user" | cut -d: -f6)
    if [ -z "$owner_home" ] || [ "$owner_home" = / ]; then
      echo 'error: owner home is invalid' >&2
      exit 1
    fi
    service_user="happyherd-$owner_uid"
    legacy_link_target="/opt/happyherd/$owner_uid/bin/happyherd"
    claude_skills="$owner_home/.claude/skills"
    codex_skills="$owner_home/.codex/skills"
    if command -v setfacl >/dev/null 2>&1; then
      for path in "$owner_home" "$owner_home/.claude" "$owner_home/.codex" "$claude_skills" "$codex_skills"; do
        [ ! -e "$path" ] || setfacl -x "u:$service_user" "$path" >/dev/null 2>&1 || true
      done
      for path in "$claude_skills" "$codex_skills"; do
        [ ! -e "$path" ] || setfacl -d -x "u:$service_user" "$path" >/dev/null 2>&1 || true
      done
    fi
    remove_legacy_link
    remove_legacy_profile_blocks
    service="happyherd-broker-$owner_uid.service"
    systemctl disable --now "$service" >/dev/null 2>&1 || true
    rm -f -- "/etc/systemd/system/$service" \
      "/etc/happyherd/tool-launcher-$owner_uid.conf" \
      "/etc/happyherd/credentials/keyring-$owner_uid.cred"
    rm -rf -- "/opt/happyherd/$owner_uid" "/var/lib/happyherd/$owner_uid"
    userdel "happyherd-tool-$owner_uid" >/dev/null 2>&1 || true
    userdel "happyherd-$owner_uid" >/dev/null 2>&1 || true
    groupdel "happyherd-$owner_uid" >/dev/null 2>&1 || true
    systemctl daemon-reload
    ;;
  Darwin)
    owner_home=$(dscacheutil -q user -a name "$owner_user" | sed -n 's/^dir: //p' | head -n 1)
    if [ -z "$owner_home" ] || [ "$owner_home" = / ]; then
      echo 'error: owner home is invalid' >&2
      exit 1
    fi
    service_user="happyherd$owner_uid"
    legacy_link_target="/Library/Application Support/HappyHerd/$owner_uid/bin/happyherd"
    claude_skills="$owner_home/.claude/skills"
    codex_skills="$owner_home/.codex/skills"
    [ ! -e "$owner_home" ] || chmod -a "user:$service_user allow search" "$owner_home" >/dev/null 2>&1 || true
    for path in "$owner_home/.claude" "$owner_home/.codex"; do
      [ ! -e "$path" ] || chmod -a "user:$service_user allow list,search" "$path" >/dev/null 2>&1 || true
    done
    for path in "$claude_skills" "$codex_skills"; do
      [ ! -e "$path" ] || chmod -a "user:$service_user allow list,search,readattr,readextattr,add_file,add_subdirectory,delete_child,file_inherit,directory_inherit" "$path" >/dev/null 2>&1 || true
    done
    remove_legacy_link
    remove_legacy_profile_blocks
    label="dev.happyherd.broker.$owner_uid"
    launchctl bootout "system/$label" >/dev/null 2>&1 || true
    rm -f -- "/Library/LaunchDaemons/$label.plist" \
      "/Library/PrivilegedHelperTools/dev.happyherd.keychain-broker-$owner_uid" \
      "/Library/Application Support/HappyHerd/tool-launcher-$owner_uid.conf"
    rm -rf -- "/Library/Application Support/HappyHerd/$owner_uid" \
      "/Library/Application Support/HappyHerd/Broker/$owner_uid" \
      "/Library/Application Support/HappyHerd/Secrets/$owner_uid"
    dscl . -delete "/Users/happyherdtool$owner_uid" >/dev/null 2>&1 || true
    dscl . -delete "/Users/happyherd$owner_uid" >/dev/null 2>&1 || true
    dscl . -delete "/Groups/happyherd$owner_uid" >/dev/null 2>&1 || true
    ;;
  *)
    echo 'error: legacy cleanup supports macOS and Linux' >&2
    exit 1
    ;;
esac

echo 'Removed obsolete HappyHerd #98 broker, vault, helper, identity, and installer files.'
echo 'Preserved ~/.happyherd, provider homes, sessions, settings, and user-managed Skills.'
