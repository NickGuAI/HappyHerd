#!/bin/sh
set -eu

PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy HAPPYHERD_ACCESS_TOKEN

fail() { printf 'happyherd uninstaller: %s\n' "$*" >&2; exit 1; }
for command_name in sudo id uname; do command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"; done
[ "$(id -u)" -ne 0 ] || fail 'run this uninstaller as the user who installed HappyHerd'
sudo -v || fail 'administrator access is required to remove the broker service and credential vault'

owner_user=$(id -un)
owner_uid=$(id -u)
case "$owner_user" in ''|*[!A-Za-z0-9._-]*) fail 'target user name is unsafe' ;; esac
case "$(uname -s)" in
  Linux)
    for command_name in getent getfacl systemctl userdel groupdel; do command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"; done
    platform=linux
    owner_home=$(getent passwd "$owner_user" | /usr/bin/cut -d: -f6)
    install_dir="/opt/happyherd/$owner_uid"
    state_root="/var/lib/happyherd/$owner_uid"
    service_user="happyherd-$owner_uid"
    tool_user="happyherd-tool-$owner_uid"
    service_group="$service_user"
    service_name="happyherd-broker-$owner_uid.service"
    service_definition="/etc/systemd/system/$service_name"
    tool_launcher_config="/etc/happyherd/tool-launcher-$owner_uid.conf"
    keyring_credential="/etc/happyherd/credentials/keyring-$owner_uid.cred"
    service_marker="HappyHerd broker for UID $owner_uid"
    tool_marker="HappyHerd isolated tool runner for UID $owner_uid"
    ;;
  Darwin)
    for command_name in dscl dseditgroup dscacheutil launchctl plutil; do command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"; done
    platform=darwin
    owner_record=$(dscacheutil -q user -a name "$owner_user") \
      || fail 'target user account could not be resolved'
    [ "$(printf '%s\n' "$owner_record" | /usr/bin/grep -Ec '^dir: ')" -eq 1 ] \
      || fail 'target user account has an ambiguous home'
    owner_home=$(printf '%s\n' "$owner_record" | /usr/bin/sed -n 's/^dir: //p')
    install_dir="/Library/Application Support/HappyHerd/$owner_uid"
    state_root="/Library/Application Support/HappyHerd/Broker/$owner_uid"
    service_user="happyherd$owner_uid"
    tool_user="happyherdtool$owner_uid"
    service_group="$service_user"
    service_name="dev.happyherd.broker.$owner_uid"
    service_definition="/Library/LaunchDaemons/$service_name.plist"
    tool_launcher_config="/Library/Application Support/HappyHerd/tool-launcher-$owner_uid.conf"
    keychain_host="/Library/PrivilegedHelperTools/dev.happyherd.keychain-broker-$owner_uid"
    keychain_path="$state_root/Library/Keychains/happyherd.keychain-db"
    keychain_master_dir="/Library/Application Support/HappyHerd/Secrets/$owner_uid"
    keychain_master_path="$keychain_master_dir/keychain-master"
    ;;
  *) fail 'unsupported operating system' ;;
esac
case "$owner_home" in ''|'/') fail 'target user home is unsafe' ;; esac
case "$install_dir" in ''|'/'|'/opt'|'/Library'|'/Library/Application Support') fail 'resolved install path is unsafe' ;; esac
case "$state_root" in ''|'/'|'/var'|'/var/lib'|'/Library'|'/Library/Application Support') fail 'resolved state path is unsafe' ;; esac

protected_metadata() {
  if [ "$platform" = linux ]; then sudo /usr/bin/stat -c '%u:%g:%a' -- "$1"
  else sudo /usr/bin/stat -f '%u:%g:%Lp' "$1"; fi
}
protected_mode() {
  metadata=$(protected_metadata "$1") || return 1
  metadata_uid=${metadata%%:*}; metadata_rest=${metadata#*:}
  metadata_gid=${metadata_rest%%:*}; metadata_mode=${metadata_rest#*:}
  [ -n "$metadata_uid" ] && [ -n "$metadata_gid" ] && [ -n "$metadata_mode" ] || return 1
  case "$metadata_uid:$metadata_gid:$metadata_mode" in *[!0-9:]*) return 1 ;; esac
  [ "$metadata_uid" -eq 0 ] || return 1
  mode_value=$((0$metadata_mode))
  [ $((mode_value & 2)) -eq 0 ] || return 1
  if [ $((mode_value & 16)) -ne 0 ]; then
    [ "${2:-strict}" = trusted-admin-group ] && { [ "$metadata_gid" -eq 0 ] || [ "$metadata_gid" -eq 80 ]; } || return 1
  fi
}
protected_directory() { sudo test -d "$1" && sudo test ! -L "$1" && protected_mode "$1" "${2:-strict}"; }
protected_regular() {
  sudo test -f "$1" && sudo test ! -L "$1" && protected_mode "$1" strict || return 1
  [ "${2:-data}" != executable ] || sudo test -x "$1"
}
service_regular() {
  sudo test -f "$1" && sudo test ! -L "$1" || return 1
  [ "$(protected_metadata "$1")" = "$service_uid:$service_gid:${2:-600}" ]
}
protected_client_config() {
  path=$1
  sudo test -f "$path" && sudo test ! -L "$path" || return 1
  if [ "$platform" = linux ]; then
    [ "$(protected_metadata "$path")" = '0:0:640' ] || return 1
    client_acl=$(sudo /usr/bin/getfacl --absolute-names --numeric --omit-header -- "$path") || return 1
    expected_acl=$(printf 'user::rw-\nuser:%s:r--\ngroup::---\nmask::r--\nother::---' "$owner_uid")
    [ "$client_acl" = "$expected_acl" ]
  else
    [ "$(protected_metadata "$path")" = '0:0:600' ] || return 1
    client_acl=$(sudo /bin/ls -lde "$path") || return 1
    client_acl_count=$(printf '%s\n' "$client_acl" | /usr/bin/grep -Ec '^[[:space:]]*[0-9]+:')
    [ "$client_acl_count" -eq 1 ] \
      && printf '%s\n' "$client_acl" | /usr/bin/grep -Eq "^[[:space:]]*0: user:$owner_user allow read[[:space:]]*$"
  fi
}

mac_require_no_authentication_authority() {
  record=$1
  label=$2
  authentication_record_data=$(dscl . -read "$record") \
    || fail "could not verify the macOS $label record"
  if printf '%s\n' "$authentication_record_data" | /usr/bin/grep -Eq '^[[:space:]]*AuthenticationAuthority:'; then
    fail "macOS $label unexpectedly has an authentication authority"
  fi
}

mac_read_attribute() {
  record=$1
  attribute=$2
  dscl -plist . -read "$record" "$attribute" \
    | /usr/bin/plutil -convert json -o - - \
    | sudo "$bundled_node" -e '
const fs = require("node:fs");
const attribute = process.argv[1];
let record;
try {
  const bytes = fs.readFileSync(0);
  if (bytes.length > 65536) process.exit(2);
  record = JSON.parse(bytes.toString("utf8"));
} catch { process.exit(2); }
const matches = Object.entries(record).filter(([key]) => key === attribute || key.endsWith(`:${attribute}`));
if (matches.length !== 1) process.exit(3);
const values = matches[0][1];
if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string") process.exit(4);
process.stdout.write(values[0]);
' "$attribute"
}

if [ "$platform" = linux ]; then
  protected_directory /opt || fail '/opt is not administrator-protected'
  protected_directory /opt/happyherd || fail 'HappyHerd install parent is unsafe'
  protected_directory /var || fail '/var is not administrator-protected'
  protected_directory /var/lib || fail '/var/lib is not administrator-protected'
  protected_directory /var/lib/happyherd || fail 'HappyHerd state parent is unsafe'
else
  protected_directory /Library || fail '/Library is not administrator-protected'
  protected_directory '/Library/Application Support' trusted-admin-group || fail 'Application Support is not administrator-protected'
  protected_directory '/Library/Application Support/HappyHerd' || fail 'HappyHerd install parent is unsafe'
  protected_directory '/Library/Application Support/HappyHerd/Broker' || fail 'HappyHerd state parent is unsafe'
  protected_directory '/Library/PrivilegedHelperTools' trusted-admin-group || fail 'macOS privileged helper root is unsafe'
fi
protected_directory "$install_dir" || fail 'owned HappyHerd installation was not found or is unsafe'
protected_directory "$install_dir/native" || fail 'owned installation native runtime root is unsafe'
protected_directory "$install_dir/runtime" || fail 'owned installation runtime root is unsafe'
protected_directory "$install_dir/service" || fail 'owned installation service root is unsafe'
bundled_node="$install_dir/native/node"
protected_regular "$bundled_node" executable || fail 'owned installation is missing a protected bundled verifier'
protected_regular "$install_dir/runtime/bin/happyherd.mjs" || fail 'owned installation broker entrypoint is unsafe'
protected_regular "$install_dir/service/happyherd-uninstall-managed.mjs" || fail 'owned installation managed-Skill verifier is unsafe'
protected_regular "$install_dir/service/happyherd-uninstall-phase.mjs" || fail 'owned installation uninstall phase verifier is unsafe'
protected_regular "$install_dir/release.json" || fail 'owned installation release receipt is unsafe'
expected_target_prefix=$platform
sudo env -i HAPPYHERD_EXPECTED_TARGET_PREFIX="$expected_target_prefix" "$bundled_node" - "$install_dir/release.json" <<'NODE' || fail 'installation receipt is not owned by HappyHerd'
const fs=require('node:fs');
try {
  const path=process.argv[2];const bytes=fs.readFileSync(path);if(bytes.length>65536)process.exit(1);
  const r=JSON.parse(bytes.toString('utf8'));
  if(r.schemaVersion!==1||r.product!=='HappyHerd'||typeof r.target!=='string'||!r.target.startsWith(process.env.HAPPYHERD_EXPECTED_TARGET_PREFIX+'-')||r.nodeRuntime!=='native/node'||typeof r.sourceSha!=='string'||!/^[0-9a-f]{40}$/.test(r.sourceSha))process.exit(1);
} catch { process.exit(1); }
NODE

claude_skills="$owner_home/.claude/skills"
codex_skills="$owner_home/.codex/skills"

if [ "$platform" = linux ]; then
  service_record=$(getent passwd "$service_user") || fail 'owned broker service identity was not found'
  tool_record=$(getent passwd "$tool_user") || fail 'owned tool execution identity was not found'
  service_home=$(printf '%s\n' "$service_record" | /usr/bin/cut -d: -f6)
  service_shell=$(printf '%s\n' "$service_record" | /usr/bin/cut -d: -f7)
  service_actual_marker=$(printf '%s\n' "$service_record" | /usr/bin/cut -d: -f5)
  service_uid=$(id -u "$service_user")
  service_gid=$(id -g "$service_user")
  service_groups=$(id -G "$service_user")
  service_group_name=$(getent group "$service_gid" | /usr/bin/cut -d: -f1)
  tool_home=$(printf '%s\n' "$tool_record" | /usr/bin/cut -d: -f6)
  tool_shell=$(printf '%s\n' "$tool_record" | /usr/bin/cut -d: -f7)
  tool_actual_marker=$(printf '%s\n' "$tool_record" | /usr/bin/cut -d: -f5)
  tool_gid=$(id -g "$tool_user")
  tool_groups=$(id -G "$tool_user")
  [ "$service_home" = "$state_root" ] \
    && [ "$service_shell" = /usr/sbin/nologin ] \
    && [ "$service_actual_marker" = "$service_marker" ] \
    && [ "$service_groups" = "$service_gid" ] \
    && [ "$service_group_name" = "$service_group" ] \
    && [ "$tool_home" = /nonexistent ] \
    && [ "$tool_shell" = /usr/sbin/nologin ] \
    && [ "$tool_actual_marker" = "$tool_marker" ] \
    && [ "$tool_gid" = "$service_gid" ] \
    && [ "$tool_groups" = "$service_gid" ] \
    || fail 'refusing to remove system identities not owned by this HappyHerd installation'
  [ "$service_uid" -ne "$owner_uid" ] \
    && [ "$(id -u "$tool_user")" -ne "$owner_uid" ] \
    && [ "$service_uid" -ne "$(id -u "$tool_user")" ] \
    || fail 'HappyHerd system identities overlap a protected identity'
else
  dscl . -read "/Users/$service_user" >/dev/null 2>&1 || fail 'owned broker service identity was not found'
  dscl . -read "/Users/$tool_user" >/dev/null 2>&1 || fail 'owned tool execution identity was not found'
  dscl . -read "/Groups/$service_group" >/dev/null 2>&1 || fail 'owned broker service group was not found'
  mac_require_no_authentication_authority "/Users/$service_user" 'broker service identity'
  mac_require_no_authentication_authority "/Users/$tool_user" 'tool execution identity'
  service_home=$(mac_read_attribute "/Users/$service_user" NFSHomeDirectory) || fail 'broker service identity home could not be verified'
  service_shell=$(mac_read_attribute "/Users/$service_user" UserShell) || fail 'broker service identity shell could not be verified'
  service_hidden=$(mac_read_attribute "/Users/$service_user" IsHidden) || fail 'broker service identity hidden state could not be verified'
  service_password=$(mac_read_attribute "/Users/$service_user" Password) || fail 'broker service identity password state could not be verified'
  service_generated_uid=$(mac_read_attribute "/Users/$service_user" GeneratedUID) || fail 'broker service generated identity could not be verified'
  service_actual_marker=$(mac_read_attribute "/Users/$service_user" RealName) || fail 'broker service identity marker could not be verified'
  service_gid=$(mac_read_attribute "/Users/$service_user" PrimaryGroupID) || fail 'broker service identity group could not be verified'
  service_uid=$(mac_read_attribute "/Users/$service_user" UniqueID) || fail 'broker service identity ID could not be verified'
  group_gid=$(mac_read_attribute "/Groups/$service_group" PrimaryGroupID) || fail 'broker service group ID could not be verified'
  group_marker=$(mac_read_attribute "/Groups/$service_group" RealName) || fail 'broker service group marker could not be verified'
  tool_home=$(mac_read_attribute "/Users/$tool_user" NFSHomeDirectory) || fail 'tool execution identity home could not be verified'
  tool_shell=$(mac_read_attribute "/Users/$tool_user" UserShell) || fail 'tool execution identity shell could not be verified'
  tool_hidden=$(mac_read_attribute "/Users/$tool_user" IsHidden) || fail 'tool execution identity hidden state could not be verified'
  tool_password=$(mac_read_attribute "/Users/$tool_user" Password) || fail 'tool execution identity password state could not be verified'
  tool_generated_uid=$(mac_read_attribute "/Users/$tool_user" GeneratedUID) || fail 'tool execution generated identity could not be verified'
  tool_actual_marker=$(mac_read_attribute "/Users/$tool_user" RealName) || fail 'tool execution identity marker could not be verified'
  tool_gid=$(mac_read_attribute "/Users/$tool_user" PrimaryGroupID) || fail 'tool execution identity group could not be verified'
  tool_uid=$(mac_read_attribute "/Users/$tool_user" UniqueID) || fail 'tool execution identity ID could not be verified'
  printf '%s\n' "$service_generated_uid" | /usr/bin/grep -Eq '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' \
    || fail 'broker service identity has an invalid generated identity'
  printf '%s\n' "$tool_generated_uid" | /usr/bin/grep -Eq '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' \
    || fail 'tool execution identity has an invalid generated identity'
  [ "$service_home" = "$state_root" ] \
    && [ "$service_shell" = /usr/bin/false ] \
    && [ "$service_hidden" = 1 ] \
    && [ "$service_password" = '*' ] \
    && [ "$service_actual_marker" = "HappyHerd broker for UID $owner_uid" ] \
    && [ "$service_gid" = "$group_gid" ] \
    && [ "$group_marker" = "HappyHerd broker for UID $owner_uid group" ] \
    && [ "$tool_home" = /var/empty ] \
    && [ "$tool_shell" = /usr/bin/false ] \
    && [ "$tool_hidden" = 1 ] \
    && [ "$tool_password" = '*' ] \
    && [ "$tool_actual_marker" = "HappyHerd isolated tool runner for UID $owner_uid" ] \
    && [ "$tool_gid" = "$service_gid" ] \
    || fail 'refusing to remove macOS identities not exactly owned by this HappyHerd installation'
  [ "$service_uid" -ne "$owner_uid" ] && [ "$tool_uid" -ne "$owner_uid" ] && [ "$service_uid" -ne "$tool_uid" ] \
    || fail 'HappyHerd macOS identities overlap a protected identity'
  if sudo dseditgroup -o checkmember -m "$service_user" admin | /usr/bin/grep -Fq yes; then fail 'broker service identity unexpectedly has administrator access'; fi
  if sudo dseditgroup -o checkmember -m "$tool_user" admin | /usr/bin/grep -Fq yes; then fail 'tool execution identity unexpectedly has administrator access'; fi
fi

service_config="$state_root/broker-service.json"
client_config="$install_dir/client/broker.json"
managed_uninstaller="$install_dir/service/happyherd-uninstall-managed.mjs"
uninstall_phase_helper="$install_dir/service/happyherd-uninstall-phase.mjs"
resume_receipt="$install_dir/uninstall-keychain-pending.json"
mac_resume=0
macos_phase() {
  sudo env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin "$bundled_node" "$uninstall_phase_helper" "$1" \
    "$owner_uid" "$service_uid" "$service_gid" "$state_root" "$keychain_path" "$keychain_host" \
    "$install_dir" "$install_dir/release.json" "$resume_receipt"
}
state_metadata=$(protected_metadata "$state_root") || fail 'broker state root metadata is unavailable'
case "$state_metadata" in "$service_uid:$service_gid:700"|"$service_uid:$service_gid:710") ;; *) fail 'broker state root ownership or mode is unsafe' ;; esac
service_regular "$service_config" 600 || fail 'broker service configuration is unsafe'
service_regular "$state_root/client-capability" 600 || fail 'broker client capability is unsafe'
service_regular "$state_root/signing-private.pem" 600 || fail 'broker signing key is unsafe'
protected_client_config "$client_config" || fail 'broker client capability ACL is unsafe'
protected_regular "$service_definition" || fail 'broker service definition is unsafe'
[ "$(protected_metadata "$service_definition")" = '0:0:644' ] || fail 'broker service definition ownership or mode is unsafe'
protected_regular "$tool_launcher_config" || fail 'isolated tool configuration is unsafe'
[ "$(protected_metadata "$tool_launcher_config")" = '0:0:600' ] || fail 'isolated tool configuration ownership or mode is unsafe'
protected_regular "$install_dir/bin/happyherd" executable || fail 'installed HappyHerd launcher is unsafe'
if [ "$platform" = linux ]; then
  protected_regular "$keyring_credential" || fail 'encrypted Secret Service credential is unsafe'
  [ "$(protected_metadata "$keyring_credential")" = '0:0:600' ] || fail 'encrypted Secret Service credential ownership or mode is unsafe'
else
  protected_regular "$keychain_host" executable || fail 'macOS Keychain broker host is unsafe'
  [ "$(sudo "$keychain_host" --version)" = happyherd-keychain-broker-v1 ] || fail 'macOS Keychain broker host identity is unsafe'
  if sudo test -e "$resume_receipt" || sudo test -L "$resume_receipt"; then
    macos_phase --verify || fail 'macOS uninstall resume evidence is unsafe'
    mac_resume=1
  fi
  if sudo test -e "$keychain_master_path" || sudo test -L "$keychain_master_path"; then
    protected_directory '/Library/Application Support/HappyHerd/Secrets' || fail 'macOS Keychain master root is unsafe'
    [ "$(protected_metadata '/Library/Application Support/HappyHerd/Secrets')" = '0:0:700' ] || fail 'macOS Keychain master root metadata is unsafe'
    protected_directory "$keychain_master_dir" || fail 'macOS Keychain master owner directory is unsafe'
    [ "$(protected_metadata "$keychain_master_dir")" = '0:0:700' ] || fail 'macOS Keychain master owner directory metadata is unsafe'
    protected_regular "$keychain_master_path" || fail 'macOS Keychain unlock master is unsafe'
    [ "$(protected_metadata "$keychain_master_path")" = '0:0:400' ] || fail 'macOS Keychain unlock master metadata is unsafe'
    [ "$(sudo /usr/bin/stat -f '%z:%l' "$keychain_master_path")" = '64:1' ] || fail 'macOS Keychain unlock master shape is unsafe'
  elif [ "$mac_resume" -ne 1 ]; then
    fail 'macOS Keychain unlock master is unsafe'
  fi
  if sudo test -e "$keychain_path" || sudo test -L "$keychain_path"; then
    service_regular "$keychain_path" 600 || fail 'durable macOS service Keychain is unsafe'
  elif [ "$mac_resume" -ne 1 ]; then
    fail 'durable macOS service Keychain is unsafe'
  fi
fi

# A verified phase receipt exists only after credential purge, broker stop, and
# managed-Skill removal all completed. Resume skips exactly those completed
# operations; every other invocation performs and verifies them first.
if [ "$mac_resume" -eq 0 ]; then
  # Verify every managed provider copy before touching credentials, services,
  # identities, ACLs, or protected state. Any ambiguous evidence aborts with the
  # entire installation intact.
  managed_preflight=$(sudo -u "$service_user" env -i "$bundled_node" "$managed_uninstaller" --preflight "$service_config") \
    || fail 'managed Skill uninstall preflight failed; installation was preserved'
  printf '%s' "$managed_preflight" | sudo env -i "$bundled_node" -e '
let b="";process.stdin.on("data",c=>{b+=c;if(Buffer.byteLength(b)>1048576)process.exit(2)});process.stdin.on("end",()=>{try{const r=JSON.parse(b);if(r.schemaVersion!==1||!Array.isArray(r.verified)||!Array.isArray(r.removed)||!Array.isArray(r.preserved)||r.removed.length!==0||r.preserved.length!==0)process.exit(2)}catch{process.exit(2)}})
' || fail 'managed Skill evidence is ambiguous; no uninstall mutation was performed'

  # Purge native-store credentials through the still-attested broker before its
  # service identity or Secret Service session is removed. If this cannot be
  # verified, keep the installation intact so a later repair can still delete
  # the credentials safely.
  if [ "$platform" = linux ]; then
    sudo systemctl start "$service_name" >/dev/null 2>&1 || fail 'broker service could not start to purge OS-store credentials'
  else
    sudo launchctl kickstart -k system/"$service_name" >/dev/null 2>&1 || fail 'broker service could not start to purge OS-store credentials'
  fi
  broker_ready=0
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if "$install_dir/bin/happyherd" doctor --installation >/dev/null 2>&1; then broker_ready=1; break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
  [ "$broker_ready" -eq 1 ] \
    || fail 'broker service did not become ready to purge OS-store credentials; installation was preserved'
  credential_output=$("$install_dir/bin/happyherd" disconnect --all) || fail 'OS-store credentials could not be verified and removed; installation was preserved'
  printf '%s\n' "$credential_output"

  if [ "$platform" = linux ]; then
    sudo systemctl stop "$service_name" >/dev/null 2>&1 || fail 'broker service could not be stopped safely'
  else
    sudo launchctl bootout system/"$service_name" >/dev/null 2>&1 || fail 'broker service could not be stopped safely'
  fi

  # Stop the broker before publication removal, then repeat complete verification
  # inside the apply helper. The helper is fail-closed and performs no deletion if
  # any registered copy changed after the earlier preflight.
  managed_apply=$(sudo -u "$service_user" env -i "$bundled_node" "$managed_uninstaller" --apply "$service_config") \
    || fail 'managed Skill removal failed; protected installation evidence was retained'
  printf '%s' "$managed_apply" | sudo env -i "$bundled_node" -e '
let b="";process.stdin.on("data",c=>{b+=c;if(Buffer.byteLength(b)>1048576)process.exit(2)});process.stdin.on("end",()=>{try{const r=JSON.parse(b);if(r.schemaVersion!==1||!Array.isArray(r.verified)||!Array.isArray(r.removed)||!Array.isArray(r.preserved)||r.preserved.length!==0||r.removed.length!==r.verified.length)process.exit(2)}catch{process.exit(2)}})
' || fail 'managed Skill copies changed during uninstall; protected installation evidence was retained'
fi

if [ "$platform" = linux ]; then
  sudo systemctl disable "$service_name" >/dev/null 2>&1 || true
  sudo rm -f -- "$service_definition"
  sudo systemctl daemon-reload
else
  macos_phase --destroy || fail 'durable macOS service Keychain could not be destroyed; protected resume evidence was retained'
  if sudo test -e "$keychain_master_path" || sudo test -L "$keychain_master_path" \
    || sudo test -e "$keychain_master_dir" || sudo test -L "$keychain_master_dir"; then
    fail 'macOS Keychain unlock master survived verified destruction'
  fi
fi

if [ "$platform" = linux ]; then
  if command -v setfacl >/dev/null 2>&1; then
    for path in "$owner_home" "$owner_home/.claude" "$owner_home/.codex" "$claude_skills" "$codex_skills"; do [ ! -e "$path" ] || sudo setfacl -x "u:$service_user" "$path" >/dev/null 2>&1 || true; done
    for path in "$claude_skills" "$codex_skills"; do [ ! -e "$path" ] || sudo setfacl -d -x "u:$service_user" "$path" >/dev/null 2>&1 || true; done
  fi
else
  [ ! -e "$owner_home" ] || sudo chmod -a "user:$service_user allow search" "$owner_home" >/dev/null 2>&1 || true
  for path in "$owner_home/.claude" "$owner_home/.codex"; do [ ! -e "$path" ] || sudo chmod -a "user:$service_user allow list,search" "$path" >/dev/null 2>&1 || true; done
  for path in "$claude_skills" "$codex_skills"; do [ ! -e "$path" ] || sudo chmod -a "user:$service_user allow list,search,readattr,readextattr,add_file,add_subdirectory,delete_child,file_inherit,directory_inherit" "$path" >/dev/null 2>&1 || true; done
fi

link_path="$owner_home/.local/bin/happyherd"
if [ -L "$link_path" ]; then [ "$(readlink "$link_path")" = "$install_dir/bin/happyherd" ] || fail 'launcher link points to an unrelated installation'; rm -- "$link_path"; fi
HAPPYHERD_PROFILE_HOME="$owner_home" "$bundled_node" <<'NODE'
const fs=require('node:fs'),path=require('node:path');const home=process.env.HAPPYHERD_PROFILE_HOME;
const pattern=/\n?# >>> HappyHerd managed PATH >>>\n[\s\S]*?# <<< HappyHerd managed PATH <<<\n?/g;
for(const name of ['.profile','.bash_profile','.zprofile']){const file=path.join(home,name);try{const text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.replace(pattern,'\n'),{mode:fs.statSync(file).mode&0o777})}catch(error){if(error.code!=='ENOENT')throw error}}
NODE

# Keep the verified LaunchDaemon definition until every fallible owner-profile
# cleanup has completed. A failure above leaves both the exact phase receipt
# and service definition available for a safe second uninstall invocation.
if [ "$platform" = darwin ]; then sudo rm -f -- "$service_definition"; fi

sudo rm -f -- "$tool_launcher_config"
if [ "$platform" = linux ]; then sudo rm -f -- "$keyring_credential"; fi
if [ "$platform" = linux ]; then
  sudo rm -rf -- "$install_dir" "$state_root"
  sudo userdel "$tool_user" >/dev/null 2>&1 || true
  sudo userdel "$service_user" >/dev/null 2>&1 || true
  sudo groupdel "$service_group" >/dev/null 2>&1 || true
else
  expected="HappyHerd broker for UID $owner_uid"
  if dscl . -read "/Users/$service_user" >/dev/null 2>&1; then
    actual=$(mac_read_attribute "/Users/$service_user" RealName) \
      || fail 'service identity owner marker could not be reverified'
    [ "$actual" = "$expected" ] || fail 'refusing to delete a service identity with an unexpected owner marker'
    sudo dscl . -delete "/Users/$service_user" >/dev/null 2>&1 || true
  fi
  sudo dscl . -delete "/Groups/$service_group" >/dev/null 2>&1 || true
  tool_expected="HappyHerd isolated tool runner for UID $owner_uid"
  if dscl . -read "/Users/$tool_user" >/dev/null 2>&1; then
    tool_actual=$(mac_read_attribute "/Users/$tool_user" RealName) \
      || fail 'tool identity owner marker could not be reverified'
    [ "$tool_actual" = "$tool_expected" ] || fail 'refusing to delete a tool identity with an unexpected owner marker'
    sudo dscl . -delete "/Users/$tool_user" >/dev/null 2>&1 || true
  fi
  sudo rm -f -- "$keychain_host"
  sudo rm -rf -- "$install_dir" "$state_root"
fi
printf 'Removed HappyHerd, its broker service, managed Skill copies, and its credential vault. Stored issuer credentials are not recoverable.\n'
