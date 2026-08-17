#!/usr/bin/env bash
# shellcheck disable=SC2016 # Contract assertions intentionally match literal shell and PowerShell source.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-public-release.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

version='1.2.1-beta.1'
source_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
published_at='2026-08-17T00:00:00Z'
workflow="$root/.github/workflows/public-launcher-release.yml"
if grep -Fq 'forceLegacyDeploy:' "$root/server/pnpm-workspace.yaml"; then
  echo 'public launcher must not disable lockfile-backed deployment globally' >&2
  exit 1
fi
grep -Fq -- '--frozen-lockfile --offline' "$workflow"
grep -Fq 'test -f "$RUNNER_TEMP/payload/pnpm-lock.yaml"' "$workflow"
grep -Fq 'prepare-public-launcher-payload.mjs' "$workflow"
grep -Fq 'install --prod --frozen-lockfile --offline --ignore-scripts' "$workflow"
grep -Fq 'nodeLinker: hoisted' "$root/scripts/prepare-public-launcher-payload.mjs"
grep -Fq 'symlink: false' "$root/scripts/prepare-public-launcher-payload.mjs"
grep -Fq "rmSync(join(toolsRoot, 'archives')" "$root/scripts/prepare-public-launcher-payload.mjs"
grep -Fq "'node_modules/.pnpm-workspace-state.json'" "$root/scripts/prepare-public-launcher-payload.mjs"
grep -Fq 'python-build-standalone/releases/download/20260718/' "$workflow"
grep -Fq "python_sha256='06469835e1b0f73bcdb6c498a1d60ce579cc43a980754490a6f1e30062f43850'" "$workflow"
grep -Fq 'archive_shell_path="$(cygpath -u "$archive_path")"' "$workflow"
grep -Fq "'share', 'terminfo'" "$workflow"
grep -Fq -- '--python-root "$BUNDLED_PYTHON_ROOT"' "$workflow"
grep -Fq -- '--python-executable "$BUNDLED_PYTHON_EXECUTABLE"' "$workflow"
grep -Fq 'rmSync(path, { recursive: true, force: true });' "$root/scripts/prepare-public-launcher-asset.mjs"
if grep -Fq -- '--python-root "$pythonLocation"' "$workflow"; then
  echo 'public launcher must not publish the non-relocatable setup-python runtime' >&2
  exit 1
fi
tool_launcher_source="$root/installers/service/unix/happyherd-tool-launcher.c"
keychain_broker_source="$root/installers/service/darwin/happyherd-keychain-broker.c"
node "$root/scripts/test-macos-uninstall-recovery.mjs"
node "$root/scripts/test-happyherd-profile-path.mjs"
grep -Fq 'happyherd-v*' "$workflow"
grep -Fq 'gh release create' "$workflow"
grep -Fq -- '--prerelease' "$workflow"
package_line=$(grep -nF 'name: Package Windows asset' "$workflow" | /usr/bin/cut -d: -f1)
upload_line=$(grep -nF 'name: Upload native asset' "$workflow" | /usr/bin/cut -d: -f1)
lifecycle_line=$(grep -nF 'name: Install and verify native Unix lifecycle' "$workflow" | /usr/bin/cut -d: -f1)
test "$package_line" -lt "$upload_line"
test "$upload_line" -lt "$lifecycle_line"
for required_target in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do
  grep -Fq "target: $required_target" "$workflow"
done
grep -Fq 'execve(runtime, child, clean_environment);' "$tool_launcher_source"
grep -Fq 'execve(sandbox[0], sandbox, clean_environment);' "$tool_launcher_source"
grep -Fq 'execve(node_runtime, arguments, clean_environment);' "$keychain_broker_source"
grep -Fq 'SecKeychainSetUserInteractionAllowed(false)' "$keychain_broker_source"
grep -Fq '#define SECRET_ROOT "/Library/Application Support/HappyHerd/Secrets"' "$keychain_broker_source"
grep -Fq '#define RANDOM_MASTER_LENGTH 32' "$keychain_broker_source"
grep -Fq '#define MASTER_LENGTH 64' "$keychain_broker_source"
test "$(grep -Fc 'SecKeychainUnlock(custom, MASTER_LENGTH, master, true)' "$keychain_broker_source")" -eq 3
if grep -Fq 'SecKeychainUnlock(custom, MASTER_LENGTH, master, false)' "$keychain_broker_source"; then
  echo 'macOS broker ignores the supplied custom Keychain password' >&2
  exit 1
fi
grep -Fq 'O_RDONLY | O_NOFOLLOW | O_CLOEXEC' "$keychain_broker_source"
grep -Fq 'O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC' "$keychain_broker_source"
grep -Fq 'value.st_nlink != 1' "$keychain_broker_source"
grep -Fq 'require_exact_regular(master_path, 0, 0, 0400, MASTER_LENGTH' "$keychain_broker_source"
grep -Fq 'Library/Preferences' "$keychain_broker_source"
test "$(grep -Fc 'ensure_service_directory(preferences_path, service_uid, service_gid)' "$keychain_broker_source")" -eq 1
grep -Fq 'require_exact_directory(preferences_path, service_uid, service_gid, 0700' "$keychain_broker_source"
preferences_ensure_line=$(grep -nF 'ensure_service_directory(preferences_path, service_uid, service_gid)' "$keychain_broker_source" | /usr/bin/cut -d: -f1)
existing_unlock_line=$(grep -nF 'existing service Keychain could not be unlocked' "$keychain_broker_source" | /usr/bin/cut -d: -f1)
test "$preferences_ensure_line" -lt "$existing_unlock_line"
if grep -Fq 'System.keychain' "$keychain_broker_source"; then
  echo 'headless macOS broker must not mutate the TCC-protected System Keychain' >&2
  exit 1
fi
for native_source in "$tool_launcher_source" "$keychain_broker_source"; do
  if grep -Fq 'clearenv()' "$native_source"; then
    echo 'native launcher uses non-portable environment mutation' >&2
    exit 1
  fi
done
if grep -Fq '/DUNICODE /D_UNICODE' "$workflow"; then
  echo 'Windows release build duplicates source-owned Unicode definitions' >&2
  exit 1
fi
grep -Fq 'sudo chown root:root /opt' "$workflow"
grep -Fq 'Get-LocalGroup -SID $UsersGroupSid' "$workflow"
grep -Fq 'Get-LocalGroup -SID $UsersGroupSid' "$root/installers/install.ps1.template"
if grep -Fq 'Install Linux native service prerequisites' "$workflow"; then
  echo 'release workflow hides clean-machine Linux prerequisite handling' >&2
  exit 1
fi
grep -Fq 'HappyHerd installation diagnostics (no credential values are displayed):' "$root/installers/install.sh.template"
grep -Fq 'sudo journalctl --unit "$service_name" --no-pager --lines=80' "$root/installers/install.sh.template"
grep -Fq "sudo env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get install --yes --no-install-recommends acl dbus-daemon gnome-keyring" "$root/installers/install.sh.template"
grep -Fq "sudo /usr/bin/install -d -o root -g wheel -m 755 '/Library/PrivilegedHelperTools'" "$root/installers/install.sh.template"
grep -Fq "keychain_master_path=\"\$keychain_master_dir/keychain-master\"" "$root/installers/install.sh.template"
grep -Fq "protected_metadata \"\$keychain_master_path\"" "$root/installers/install.sh.template"
grep -Fq "stat -f '%z:%l' \"\$keychain_master_path\"" "$root/installers/install.sh.template"
grep -Fq "stat -f '%z:%l' \"\$keychain_master_path\"" "$root/installers/uninstall.sh"
test "$(grep -F "stat -f '%z:%l' \"\$keychain_master_path\"" "$root/installers/install.sh.template" "$root/installers/uninstall.sh" | grep -Fc "= '64:1'")" -eq 2
grep -Fq "master_metadata=\$(sudo /usr/bin/stat -f '%u:%g:%Lp:%z:%l' \"\$keychain_master\")" "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'sudo -u "$service_user" env HOME="$state_root" /usr/bin/security lock-keychain "$keychain_path"' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'detached-descendant evidence (bounded):' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq "\$LogText = ''" "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq '$LogCandidate = Get-Content -Raw -LiteralPath $Log -ErrorAction SilentlyContinue' "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq 'if ($null -ne $LogCandidate) { $LogText = [string]$LogCandidate }' "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq 'if ($LogText -and $LogText.Contains("issuer-ready $Issuer")) { $IssuerReady = $true; break }' "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq '$SpyScriptPath = Join-Path $env:SystemRoot ("Temp\happyherd-spy-probe-"' "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq '"*${SpySid}:(RX)"' "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq "'-File', \$SpyScriptPath" "$root/scripts/test-installed-happyherd-e2e.ps1"
grep -Fq 'if ($SpyScriptPath -and (Test-Path -LiteralPath $SpyScriptPath))' "$root/scripts/test-installed-happyherd-e2e.ps1"
if grep -Fq '(Get-Content -Raw $Log).Contains' "$root/scripts/test-installed-happyherd-e2e.ps1"; then
  echo 'Windows native E2E calls a method on a possibly empty log read' >&2
  exit 1
fi
if grep -Fq "'-EncodedCommand', \$SpyScript" "$root/scripts/test-installed-happyherd-e2e.ps1"; then
  echo 'Windows native E2E exceeds the credentialed-process command-line limit' >&2
  exit 1
fi
if grep -Fq '$SpyScriptPath, $SpyPayloadBase64' "$root/scripts/test-installed-happyherd-e2e.ps1"; then
  echo 'Windows native E2E puts its probe payload back on the credentialed command line' >&2
  exit 1
fi
grep -Fq 'claude_fixture="$destination/claude.js"' "$root/scripts/prepare-agent-cli-fixtures.sh"
grep -Fq 'ln -sf claude.js "$destination/claude"' "$root/scripts/prepare-agent-cli-fixtures.sh"
grep -Fq "node_modules\\@anthropic-ai\\claude-code" "$root/scripts/prepare-agent-cli-fixtures.ps1"
grep -Fq "Join-Path \$ClaudePackage 'cli.js'" "$root/scripts/prepare-agent-cli-fixtures.ps1"
grep -Fq 'service_uid=$(id -u "$service_user")' "$root/installers/uninstall.sh"
test "$(grep -Fc '$MemberSids = @($Members | ForEach-Object { $_.SID.Value })' "$root/installers/install.ps1.template")" -eq 1
test "$(grep -Fc '$MemberSids = @($Members | ForEach-Object { $_.SID.Value })' "$root/installers/uninstall.ps1")" -eq 1
if grep -Fq '$Members.SID.Value' "$root/installers/install.ps1.template" "$root/installers/uninstall.ps1"; then
  echo 'Windows local-group validation is not empty-safe under strict mode' >&2
  exit 1
fi
grep -Fq '$InstallReaders = @($ServiceSid, $ToolSid, $OwnerSid)' "$root/installers/install.ps1.template"
grep -Fq '[Security.AccessControl.FileSystemRights]::ReadAndExecute, $Flags, $Propagation, $Allow' "$root/installers/install.ps1.template"
grep -Fq '$Security = [Security.AccessControl.FileSecurity]::new()' "$root/installers/install.ps1.template"
grep -Fq '$Security.SetAccessRuleProtection($true, $false)' "$root/installers/install.ps1.template"
grep -Fq '[Security.AccessControl.FileSystemRights]::Read' "$root/installers/install.ps1.template"
grep -Fq 'Set-Acl -LiteralPath $Path -AclObject $Security' "$root/installers/install.ps1.template"
if grep -Fq 'Invoke-Icacls $Path $Rules' "$root/installers/install.ps1.template"; then
  echo 'Windows protected files still reuse pre-existing explicit ACL entries' >&2
  exit 1
fi
if grep -Eq "inheritance:r['\",[:space:]]+.*grant:r" "$root/installers/install.ps1.template"; then
  echo 'Windows ACL publication removes inherited access before trusted grants are explicit' >&2
  exit 1
fi
grep -Fq 'function Protect-ManagedTree([string]$Path, [string[]]$ReadExecuteSids)' "$root/installers/install.ps1.template"
grep -Fq "Invoke-Icacls \$Children @('/reset', '/T', '/C')" "$root/installers/install.ps1.template"
grep -Fq 'Protect-ManagedTree $InstallDir $InstallReaders' "$root/installers/install.ps1.template"
grep -Fq 'Protect-ManagedTree $InstallDir @()' "$root/installers/install.ps1.template"
grep -Fq 'Protect-ManagedTree $StateRoot @()' "$root/installers/install.ps1.template"
grep -Fq 'Protect-File $ReleaseReceipt $InstallReaders' "$root/installers/install.ps1.template"
grep -Fq 'Protect-File $ExecutablePath $InstallReaders $ReadAndExecute' "$root/installers/install.ps1.template"
grep -Fq 'native ACL verification rejected the published installation' "$root/installers/install.ps1.template"
grep -Fq 'Start-BrokerService $ServiceName $LogPath' "$root/installers/install.ps1.template"
grep -Fq 'sc=$(Bounded-Diagnostic $StartOutput); query=$(Bounded-Diagnostic $QueryOutput)' "$root/installers/install.ps1.template"
grep -Fq 'Windows ACL verification failed: ${verifierDiagnostic}' "$root/server/packages/happyherd-cli/src/broker.ts"
grep -Fq 'function Grant-SharedDirectoryMetadata([string]$Path, [string[]]$ReaderSids)' "$root/installers/install.ps1.template"
grep -Fq '[Security.AccessControl.FileSystemRights]::Traverse -bor' "$root/installers/install.ps1.template"
grep -Fq '[Security.AccessControl.InheritanceFlags]::None' "$root/installers/install.ps1.template"
grep -Fq 'Grant-SharedDirectoryMetadata $InstallProductRoot @($ServiceSid, $ToolSid, $OwnerSid)' "$root/installers/install.ps1.template"
grep -Fq 'Grant-SharedDirectoryMetadata $StateProductRoot @($ServiceSid, $ToolSid)' "$root/installers/install.ps1.template"
grep -Fq 'Grant-SharedDirectoryMetadata $StateBrokerRoot @($ServiceSid, $ToolSid)' "$root/installers/install.ps1.template"
grep -Fq '$SharedDirectoryAclRecords += [ordered]@{ path = $SharedPath; sddl = (Get-Acl -LiteralPath $SharedPath).Sddl }' "$root/installers/install.ps1.template"
grep -Fq '$Security.SetSecurityDescriptorSddlForm([string]$Record.sddl)' "$root/installers/install.ps1.template"
grep -Fq 'restore shared directory ACLs:' "$root/installers/install.ps1.template"
grep -Fq 'function Assert-SharedDirectoryMetadata([string]$Path, [string[]]$ReaderSids)' "$root/installers/uninstall.ps1"
grep -Fq 'function Remove-SharedDirectoryMetadata([string]$Path, [string[]]$ReaderSids)' "$root/installers/uninstall.ps1"
grep -Fq '[int]$Rules[0].FileSystemRights -ne [int]$SharedMetadataRights' "$root/installers/uninstall.ps1"
grep -Fq '[void]$Security.RemoveAccessRuleSpecific($Rule)' "$root/installers/uninstall.ps1"
grep -Fq 'Assert-SharedDirectoryMetadata $InstallProductRoot @($ServiceSid, $ToolSid, $OwnerSid)' "$root/installers/uninstall.ps1"
grep -Fq 'Assert-SharedDirectoryMetadata $StateProductRoot @($ServiceSid, $ToolSid)' "$root/installers/uninstall.ps1"
grep -Fq 'Assert-SharedDirectoryMetadata $StateBrokerRoot @($ServiceSid, $ToolSid)' "$root/installers/uninstall.ps1"
grep -Fq 'Remove-SharedDirectoryMetadata $InstallProductRoot @($ServiceSid, $ToolSid, $OwnerSid)' "$root/installers/uninstall.ps1"
grep -Fq 'Remove-SharedDirectoryMetadata $StateProductRoot @($ServiceSid, $ToolSid)' "$root/installers/uninstall.ps1"
grep -Fq 'Remove-SharedDirectoryMetadata $StateBrokerRoot @($ServiceSid, $ToolSid)' "$root/installers/uninstall.ps1"
shared_acl_preflight_line=$(grep -nF 'Assert-SharedDirectoryMetadata $InstallProductRoot' "$root/installers/uninstall.ps1" | /usr/bin/tail -n 1 | /usr/bin/cut -d: -f1)
managed_preflight_line=$(grep -nF '$PreflightJson = & $NodeRuntime $ManagedRemoval --preflight' "$root/installers/uninstall.ps1" | /usr/bin/cut -d: -f1)
shared_acl_remove_line=$(grep -nF 'Remove-SharedDirectoryMetadata $InstallProductRoot' "$root/installers/uninstall.ps1" | /usr/bin/cut -d: -f1)
tool_identity_remove_line=$(grep -nF 'Remove-LocalUser -Name $ToolUser' "$root/installers/uninstall.ps1" | /usr/bin/cut -d: -f1)
test "$shared_acl_preflight_line" -lt "$managed_preflight_line"
test "$shared_acl_remove_line" -lt "$tool_identity_remove_line"
if grep -Fq "Invoke-Icacls \$InstallDir @('/grant:r'" "$root/installers/install.ps1.template"; then
  echo 'Windows install-tree publication still writes inheritance-only ACEs recursively' >&2
  exit 1
fi
grep -Fq 'function Bounded-Diagnostic([object[]]$Lines)' "$root/installers/install.ps1.template"
grep -Fq '$PrimaryError = $_' "$root/installers/install.ps1.template"
grep -Fq '$ServiceStopped = $false' "$root/installers/install.ps1.template"
test "$(grep -Fc 'because the broker service stop was not verified' "$root/installers/install.ps1.template")" -eq 5
grep -Fq 'previous broker service remains stopped because rollback validation is incomplete' "$root/installers/install.ps1.template"
grep -Fq 'if (-not $InstallRollbackReady -or -not $ConfigRollbackReady -or -not $ProviderRollbackReady -or -not $SharedAclRollbackReady)' "$root/installers/install.ps1.template"
windows_commit_line=$(grep -nF '$Committed = $true' "$root/installers/install.ps1.template" | /usr/bin/cut -d: -f1)
windows_catch_line=$(/usr/bin/awk -v start="$windows_commit_line" 'NR > start && $0 == "} catch {" { print NR; exit }' "$root/installers/install.ps1.template")
windows_retire_line=$(grep -nF '$RetiredBackup = ' "$root/installers/install.ps1.template" | /usr/bin/cut -d: -f1)
test "$windows_commit_line" -lt "$windows_catch_line"
test "$windows_catch_line" -lt "$windows_retire_line"
grep -Fq 'if (-not $Committed -and $Temporary -and (Test-Path -LiteralPath $Temporary))' "$root/installers/install.ps1.template"
test "$(grep -Eic '\$mutating[[:space:]]*=.*FileSystemRights]::WriteData.*FileSystemRights]::AppendData.*FileSystemRights]::WriteExtendedAttributes.*FileSystemRights]::DeleteSubdirectoriesAndFiles.*FileSystemRights]::WriteAttributes.*FileSystemRights]::Delete.*FileSystemRights]::ChangePermissions.*FileSystemRights]::TakeOwnership' "$root/installers/install.ps1.template")" -eq 4
test "$(grep -Eic '\$mutating[[:space:]]*=.*FileSystemRights]::WriteData.*FileSystemRights]::AppendData.*FileSystemRights]::WriteExtendedAttributes.*FileSystemRights]::DeleteSubdirectoriesAndFiles.*FileSystemRights]::WriteAttributes.*FileSystemRights]::Delete.*FileSystemRights]::ChangePermissions.*FileSystemRights]::TakeOwnership' "$root/installers/uninstall.ps1")" -eq 1
if grep -Ei '\$mutating[[:space:]]*=.*FileSystemRights]::(Write|Modify|FullControl)([[:space:]]|-bor|$)' "$root/installers/install.ps1.template" "$root/installers/uninstall.ps1"; then
  echo 'Windows ACL mutation mask includes a composite right that overlaps legitimate read-only access' >&2
  exit 1
fi
if grep -Eq '"\$(ServiceSid|ToolSid|OwnerSid)`:' "$root/installers/install.ps1.template"; then
  echo 'Windows icacls uses an unresolved dynamic SID without the required literal-SID prefix' >&2
  exit 1
fi
if grep -Fq '$Rules += "$Reader`:R"' "$root/installers/install.ps1.template"; then
  echo 'Windows protected-file ACL uses an unresolved dynamic reader SID' >&2
  exit 1
fi
grep -Fq 'To uninstall later from that employee account:' "$root/installers/install.ps1.template"
grep -Fq '(Get-Command happyherd.cmd -CommandType Application -ErrorAction Stop).Source' "$root/README.md"
grep -Fq '(Get-Command happyherd.cmd -CommandType Application -ErrorAction Stop).Source' "$root/docs/public-launcher-release.md"
if grep -Fq '& "$InstallRoot\uninstall.ps1"' "$root/docs/public-launcher-release.md"; then
  echo 'Windows uninstall guidance relies on an undefined shell variable' >&2
  exit 1
fi
grep -Fq 'candidate=45000' "$root/installers/install.sh.template"
grep -Fq 'dscacheutil -q user -a uid "$candidate"' "$root/installers/install.sh.template"
grep -Fq 'dscacheutil -q group -a gid "$candidate"' "$root/installers/install.sh.template"
grep -Fq "mac_create_record \"/Groups/\$service_group\" 'broker service group'" "$root/installers/install.sh.template"
test "$(grep -Fc 'GeneratedUID "$(uuidgen)"' "$root/installers/install.sh.template")" -eq 1
if grep -Fq 'mac_create_attribute "/Users/$service_user" GeneratedUID' "$root/installers/install.sh.template" \
  || grep -Fq 'mac_create_attribute "/Users/$tool_user" GeneratedUID' "$root/installers/install.sh.template"; then
  echo 'macOS installer replaces a system-generated user identity' >&2
  exit 1
fi
test "$(grep -Fc 'authentication_record_data=$(dscl . -read "$record")' "$root/installers/install.sh.template")" -eq 1
test "$(grep -Fc "grep -Eq '^[[:space:]]*AuthenticationAuthority:'" "$root/installers/install.sh.template")" -eq 1
grep -Fq 'sudo dscl . -delete "$record" AuthenticationAuthority' "$root/installers/install.sh.template"
test "$(grep -Fc 'mac_require_no_authentication_authority "/Users/$service_user"' "$root/installers/install.sh.template")" -eq 2
test "$(grep -Fc 'mac_require_no_authentication_authority "/Users/$tool_user"' "$root/installers/install.sh.template")" -eq 2
test "$(grep -Fc 'mac_remove_authentication_authority "/Users/$service_user"' "$root/installers/install.sh.template")" -eq 1
test "$(grep -Fc 'mac_remove_authentication_authority "/Users/$tool_user"' "$root/installers/install.sh.template")" -eq 1
test "$(grep -Fc 'authentication_record_data=$(dscl . -read "$record")' "$root/installers/uninstall.sh")" -eq 1
test "$(grep -Fc "grep -Eq '^[[:space:]]*AuthenticationAuthority:'" "$root/installers/uninstall.sh")" -eq 1
grep -Fq 'mac_require_no_authentication_authority "/Users/$service_user"' "$root/installers/uninstall.sh"
grep -Fq 'mac_require_no_authentication_authority "/Users/$tool_user"' "$root/installers/uninstall.sh"
grep -Fq 'new_service_group=1' "$root/installers/install.sh.template"
grep -Fq 'new_service_user=1' "$root/installers/install.sh.template"
grep -Fq 'new_tool_user=1' "$root/installers/install.sh.template"
service_no_auth_line=$(grep -nF 'mac_remove_authentication_authority "/Users/$service_user"' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
service_password_line=$(grep -nF 'mac_create_attribute "/Users/$service_user" Password' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
service_post_password_check_line=$(grep -nF 'mac_require_no_authentication_authority "/Users/$service_user"' "$root/installers/install.sh.template" | /usr/bin/tail -n 1 | /usr/bin/cut -d: -f1)
service_readback_line=$(grep -nF 'created_service_home=$(mac_read_attribute' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
service_ready_line=$(grep -nF '    new_service_identity=1' "$root/installers/install.sh.template" | /usr/bin/tail -n 1 | /usr/bin/cut -d: -f1)
test "$service_no_auth_line" -lt "$service_password_line"
test "$service_password_line" -lt "$service_post_password_check_line"
test "$service_post_password_check_line" -lt "$service_readback_line"
test "$service_readback_line" -lt "$service_ready_line"
tool_no_auth_line=$(grep -nF 'mac_remove_authentication_authority "/Users/$tool_user"' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
tool_password_line=$(grep -nF 'mac_create_attribute "/Users/$tool_user" Password' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
tool_post_password_check_line=$(grep -nF 'mac_require_no_authentication_authority "/Users/$tool_user"' "$root/installers/install.sh.template" | /usr/bin/tail -n 1 | /usr/bin/cut -d: -f1)
tool_readback_line=$(grep -nF 'created_tool_home=$(mac_read_attribute' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
tool_ready_line=$(grep -nF '    new_tool_identity=1' "$root/installers/install.sh.template" | /usr/bin/tail -n 1 | /usr/bin/cut -d: -f1)
test "$tool_no_auth_line" -lt "$tool_password_line"
test "$tool_password_line" -lt "$tool_post_password_check_line"
test "$tool_post_password_check_line" -lt "$tool_readback_line"
test "$tool_readback_line" -lt "$tool_ready_line"
grep -Fq "[ \"\$created_service_password\" = '*' ]" "$root/installers/install.sh.template"
grep -Fq "[ \"\$created_tool_password\" = '*' ]" "$root/installers/install.sh.template"
grep -Fq 'created broker service identity read-back mismatch:$created_service_mismatch' "$root/installers/install.sh.template"
grep -Fq 'created isolated tool identity read-back mismatch:$created_tool_mismatch' "$root/installers/install.sh.template"
grep -Fq 'dscl -plist . -read "$record" "$attribute"' "$root/installers/install.sh.template"
grep -Fq '/usr/bin/plutil -convert json -o - -' "$root/installers/install.sh.template"
grep -Fq 'if (matches.length !== 1) process.exit(3);' "$root/installers/install.sh.template"
grep -Fq 'if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string") process.exit(4);' "$root/installers/install.sh.template"
test "$(grep -Fc '=$(dscl . -read "/Users/$service_user"' "$root/installers/install.sh.template")" -eq 0
test "$(grep -Fc '=$(dscl . -read "/Users/$tool_user"' "$root/installers/install.sh.template")" -eq 0
test "$(grep -Fc '=$(dscl . -read "/Groups/$service_group"' "$root/installers/install.sh.template")" -eq 0
grep -Fq 'dscl -plist . -read "$record" "$attribute"' "$root/installers/uninstall.sh"
grep -Fq '/usr/bin/plutil -convert json -o - -' "$root/installers/uninstall.sh"
grep -Fq 'if (matches.length !== 1) process.exit(3);' "$root/installers/uninstall.sh"
grep -Fq 'if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string") process.exit(4);' "$root/installers/uninstall.sh"
if grep -Eq 'dscl .* -read .*\| ([^ ]*/)?(sed|cut)([[:space:]]|$)' "$root/installers/install.sh.template" "$root/installers/uninstall.sh"; then
  echo 'macOS lifecycle parses a Directory Service scalar from ambiguous text output' >&2
  exit 1
fi
service_recheck_line=$(grep -nF 'actual=$(mac_read_attribute "/Users/$service_user" RealName)' "$root/installers/uninstall.sh" | /usr/bin/cut -d: -f1)
install_remove_line=$(grep -nF 'sudo rm -rf -- "$install_dir" "$state_root"' "$root/installers/uninstall.sh" | /usr/bin/tail -n 1 | /usr/bin/cut -d: -f1)
test "$service_recheck_line" -lt "$install_remove_line"
unix_service_start_line=$(grep -nF 'sudo launchctl kickstart -k system/"$service_name"' "$root/installers/uninstall.sh" | /usr/bin/cut -d: -f1)
unix_uninstall_ready_line=$(grep -nF 'doctor --installation' "$root/installers/uninstall.sh" | /usr/bin/cut -d: -f1)
unix_disconnect_line=$(grep -nF 'disconnect --all' "$root/installers/uninstall.sh" | /usr/bin/cut -d: -f1)
test "$unix_service_start_line" -lt "$unix_uninstall_ready_line"
test "$unix_uninstall_ready_line" -lt "$unix_disconnect_line"
windows_service_start_line=$(grep -nF 'Start-Service -Name $ServiceName' "$root/installers/uninstall.ps1" | /usr/bin/cut -d: -f1)
windows_uninstall_ready_line=$(grep -nF '& $Launcher doctor --installation' "$root/installers/uninstall.ps1" | /usr/bin/cut -d: -f1)
windows_disconnect_line=$(grep -nF '& $Launcher disconnect --all' "$root/installers/uninstall.ps1" | /usr/bin/cut -d: -f1)
test "$windows_service_start_line" -lt "$windows_uninstall_ready_line"
test "$windows_uninstall_ready_line" -lt "$windows_disconnect_line"
grep -Fq "signingPublicKey=crypto.createPublicKey(fs.readFileSync(e.HAPPYHERD_PRIVATE_KEY_PATH)).export({type:'spki',format:'pem'}).toString()" "$root/installers/install.sh.template"
if grep -Fq 'HAPPYHERD_PUBLIC_KEY' "$root/installers/install.sh.template"; then
  echo 'Unix installer transports a multiline trust anchor through an environment variable' >&2
  exit 1
fi
if grep -Eq '\[IO\.Directory\]::CreateDirectory\([^)]*,[[:space:]]*\$' "$root/installers/install.ps1.template"; then
  echo 'Windows installer uses the unavailable DirectorySecurity CreateDirectory overload' >&2
  exit 1
fi
test "$(grep -Fc "Invoke-Icacls \$path @('/setowner','*S-1-5-18')" "$root/installers/install.ps1.template")" -eq 1
test "$(grep -Fc "Invoke-Icacls \$Cursor @('/setowner', '*S-1-5-18')" "$root/installers/install.ps1.template")" -eq 1
grep -Fq '$ToolMarker = "HappyHerd tool $OwnerKey"' "$root/installers/install.ps1.template"
grep -Fq '$ToolMarker = "HappyHerd tool $OwnerKey"' "$root/installers/uninstall.ps1"
test "$(grep -Fc 'Protect-ManagedTree $ClientDir $InstallReaders' "$root/installers/install.ps1.template")" -eq 1
grep -Fq -- '--directory $ClientDir `' "$root/installers/install.ps1.template"
grep -Fq -- '--directory $ClientDir `' "$root/installers/uninstall.ps1"
grep -Fq '`verifier process failed (${bounded(error.code || error.name)})`' "$root/server/packages/happyherd-cli/src/broker.ts"
grep -Fq '`inheritedCwd=${bounded(process.cwd())}`' "$root/server/packages/happyherd-cli/src/broker.ts"
grep -Fq "const nodeProbe = probe(process.execPath, ['--version']);" "$root/server/packages/happyherd-cli/src/broker.ts"
grep -Fq "const commandProbe = probe(join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/c', 'exit', '0']);" "$root/server/packages/happyherd-cli/src/broker.ts"
grep -Fq '`verifierSize=${bounded(verifierMetadata.size)}`' "$root/server/packages/happyherd-cli/src/broker.ts"
grep -Fq "return { Path: win32.join(systemRoot, 'System32'), SystemRoot: systemRoot };" "$root/server/packages/happyherd-cli/src/broker.ts"
test "$(grep -Fhc 'L"Path=" + std::wstring(windows_directory) + L"\\System32"' "$root/installers/service/windows/happyherd-broker-service.cpp" "$root/installers/service/windows/happyherd-tool-launcher.cpp" | /usr/bin/awk '{ total += $1 } END { print total }')" -eq 2
grep -Fq 'L"tool_sid"' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'if (_wcsicmp(account_sid(config[L"tool_user"]).c_str(), config[L"tool_sid"].c_str()))' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;" + broker_sid + L")(A;;GA;;;" + tool_sid + L")"' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'if (flags.dwFlags & WSF_VISIBLE) fail(L"broker window station must be noninteractive")' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'entry.grfAccessPermissions = GENERIC_READ | GENERIC_EXECUTE' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'restore_window_station_access(station_access)' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
if grep -Fq 'CreateWindowStationW' "$root/installers/service/windows/happyherd-tool-launcher.cpp"; then
  echo 'Windows isolated tool launcher creates a named station from its non-admin service identity' >&2
  exit 1
fi
grep -Fq 'CreateDesktopW(desktop_name.c_str(), nullptr, nullptr, 0, MAXIMUM_ALLOWED, &desktop_attributes)' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'startup.lpDesktop = startup_desktop.data()' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq 'password.c_str(), 0,' "$root/installers/service/windows/happyherd-tool-launcher.cpp"
grep -Fq '"tool_sid=$ToolSid"' "$root/installers/install.ps1.template"
grep -Fq 'Crypt32.lib User32.lib' "$root/.github/workflows/public-launcher-release.yml"
grep -Fq '& $Python -I -X utf8 -c '\''import ctypes; from zoneinfo import ZoneInfo;' "$root/.github/workflows/public-launcher-release.yml"
grep -Fq '$UninstallOutput = & (Join-Path $InstallRoot '\''uninstall.ps1'\'') -Elevated 6>&1 | Out-String' "$root/.github/workflows/public-launcher-release.yml"
grep -Fq '`spawnargs=${bounded(error.spawnargs?.join('"'"' '"'"'))}`' "$root/server/packages/happyherd-cli/src/broker.ts"
test "$(grep -Fc 'cwd: installationRoot,' "$root/server/packages/happyherd-cli/src/broker.ts")" -eq 3
test "$(grep -Fc '/std:c++17 /MT /W4 /WX' "$root/.github/workflows/public-launcher-release.yml")" -eq 1
grep -Fq "trap failure_report ERR" "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'employee renamed a macOS managed Skill' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'tool execution ignored renamed managed Skill' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'state_root="/Library/Application Support/HappyHerd/Broker/$(id -u)"' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'service_user="happyherd$(id -u)"' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'keychain_path="$state_root/Library/Keychains/happyherd.keychain-db"' "$root/scripts/test-installed-happyherd-e2e.sh"
platform_branch_line=$(grep -nF 'if [ "$platform" = linux ]; then' "$root/installers/install.sh.template" | /usr/bin/head -n 1 | /usr/bin/cut -d: -f1)
service_marker_line=$(grep -nF 'service_marker="HappyHerd broker for UID $owner_uid"' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
tool_marker_line=$(grep -nF 'tool_marker="HappyHerd isolated tool runner for UID $owner_uid"' "$root/installers/install.sh.template" | /usr/bin/cut -d: -f1)
test "$service_marker_line" -lt "$platform_branch_line"
test "$tool_marker_line" -lt "$platform_branch_line"
test -x "$root/scripts/test-installed-happyherd-e2e.sh"
payload="$fixture/payload"
mkdir -p \
  "$payload/bin" \
  "$payload/dist" \
  "$payload/node_modules/happy/scripts" \
  "$payload/node_modules/happy/tools/archives" \
  "$payload/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64" \
  "$payload/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl" \
  "$payload/node_modules/@napi-rs/keyring-linux-x64-gnu" \
  "$payload/node_modules/@napi-rs/keyring-linux-x64-musl" \
  "$payload/node_modules/yauzl" \
  "$payload/node_modules/pend"
printf '{"name":"@happyherd/cli","version":"%s","dependencies":{"happy":"happy@file:///fixture/build-host/happy"}}\n' "$version" > "$payload/package.json"
printf "lockfileVersion: '9.0'\nimporters: {}\npackages: {}\n" > "$payload/pnpm-lock.yaml"
node "$root/scripts/prepare-public-launcher-payload.mjs" \
  --phase configure \
  --payload "$payload" \
  --server-root "$root/server" \
  --target linux-x64 >/dev/null
grep -Fq 'nodeLinker: hoisted' "$payload/pnpm-workspace.yaml"
printf '#!/usr/bin/env node\n' > "$payload/bin/happyherd.mjs"
printf 'export const fixture = true;\n' > "$payload/dist/index.mjs"
printf '{"name":"happy"}\n' > "$payload/node_modules/happy/package.json"
cat > "$payload/node_modules/happy/scripts/unpack-tools.cjs" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '..', 'tools', 'unpacked');
fs.mkdirSync(output, { recursive: true });
for (const name of ['difft', 'rg', 'ripgrep.node']) fs.writeFileSync(path.join(output, name), name);
JS
printf 'fixture archive\n' > "$payload/node_modules/happy/tools/archives/fixture.tar.gz"
printf '{"name":"@anthropic-ai/claude-agent-sdk-linux-x64"}\n' > "$payload/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/package.json"
printf '{"name":"@anthropic-ai/claude-agent-sdk-linux-x64-musl"}\n' > "$payload/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/package.json"
printf '{"name":"@napi-rs/keyring-linux-x64-gnu"}\n' > "$payload/node_modules/@napi-rs/keyring-linux-x64-gnu/package.json"
printf '{"name":"@napi-rs/keyring-linux-x64-musl"}\n' > "$payload/node_modules/@napi-rs/keyring-linux-x64-musl/package.json"
printf 'module.exports = require("pend");\n' > "$payload/node_modules/yauzl/fd-slicer.js"
printf '{"name":"pend","main":"index.js"}\n' > "$payload/node_modules/pend/package.json"
printf 'module.exports = {};\n' > "$payload/node_modules/pend/index.js"
printf '{"buildHost":"/fixture/build-host"}\n' > "$payload/node_modules/.pnpm-workspace-state.json"
mkdir -p "$payload/node_modules/.bin"
ln -s "$payload/bin/happyherd.mjs" "$payload/node_modules/.bin/happyherd"
node "$root/scripts/prepare-public-launcher-payload.mjs" \
  --phase finalize \
  --payload "$payload" \
  --server-root "$root/server" \
  --target linux-x64 >/dev/null
test ! -e "$payload/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl"
test ! -e "$payload/node_modules/@napi-rs/keyring-linux-x64-musl"
test ! -e "$payload/node_modules/happy/tools/archives"
test ! -e "$payload/node_modules/.pnpm-workspace-state.json"
grep -Fq '"happy": "1.2.1-beta.1"' "$payload/package.json"
mkdir -p "$fixture/python/bin"
cat > "$fixture/python/bin/python3" <<'SH'
#!/bin/sh
printf '{"version":[3,13,7],"timezone":"America/New_York","tzdata":"2025.2"}\n'
SH
chmod +x "$fixture/python/bin/python3"
printf 'fixture service\n' > "$fixture/service.template"
printf '#!/bin/sh\nexit 0\n' > "$fixture/tool-launcher"
chmod +x "$fixture/tool-launcher"
printf '#!/bin/sh\nexit 0\n' > "$fixture/uninstall.sh"

node "$root/scripts/prepare-public-launcher-asset.mjs" \
  --payload "$payload" \
  --stage "$fixture/prepared" \
  --target linux-x64 \
  --source-sha "$source_sha" \
  --version "$version" \
  --node-runtime "$(node -p 'process.execPath')" \
  --python-root "$fixture/python" \
  --python-executable "$fixture/python/bin/python3" \
  --service-asset "$fixture/service.template" \
  --secret-service-wrapper "$root/installers/service/linux/happyherd-secret-service.sh" \
  --tool-launcher "$fixture/tool-launcher" \
  --uninstaller "$fixture/uninstall.sh" >/dev/null
test -x "$fixture/prepared/happyherd/bin/happyherd"
test -x "$fixture/prepared/happyherd/native/node"
test -x "$fixture/prepared/happyherd/python/bin/python3"
test -f "$fixture/prepared/happyherd/service/happyherd-broker.service.template"
test -x "$fixture/prepared/happyherd/service/happyherd-secret-service"
test -x "$fixture/prepared/happyherd/service/happyherd-tool-launcher"
test -f "$fixture/prepared/happyherd/service/happyherd-uninstall-phase.mjs"
test -f "$fixture/prepared/happyherd/service/happyherd-profile-path.mjs"
test -x "$fixture/prepared/happyherd/uninstall.sh"
test -x "$root/installers/install.sh.template"
test -f "$fixture/prepared/happyherd/runtime/node_modules/.bin/happyherd"
mkdir -p "$fixture/launcher-bin"
ln -s "$fixture/prepared/happyherd/bin/happyherd" "$fixture/launcher-bin/happyherd"
"$fixture/launcher-bin/happyherd"
if find "$fixture/prepared/happyherd" -type l | grep -q .; then
  echo 'prepared public launcher contains a host-specific symbolic link' >&2
  exit 1
fi

assets="$fixture/assets"
release="$fixture/release"
mkdir -p "$assets" "$release"
for target in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do
  stage="$fixture/$target"
  mkdir -p "$stage/happyherd"
  TARGET="$target" VERSION="$version" SOURCE_SHA="$source_sha" \
    node -e 'const fs=require("node:fs");const win=process.env.TARGET==="win32-x64",mac=process.env.TARGET.startsWith("darwin-");fs.writeFileSync(process.argv[1],JSON.stringify({schemaVersion:1,product:"HappyHerd",version:process.env.VERSION,target:process.env.TARGET,sourceSha:process.env.SOURCE_SHA,nodeRuntime:win?"native/node.exe":"native/node",pythonRuntime:win?"python/python.exe":"python/bin/python3",pythonVersion:"3.13.7",tzdataVersion:"2025.2",toolLauncher:win?"service/happyherd-tool-launcher.exe":"service/happyherd-tool-launcher",...(win?{trustVerifier:"service/happyherd-acl-check.exe"}:{}),...(mac?{keychainHost:"service/happyherd-keychain-broker"}:{})})+"\n")' \
    "$stage/happyherd/release.json"
  if [[ "$target" != win32-x64 ]]; then
    mkdir -p "$stage/happyherd/bin"
    cat > "$stage/happyherd/bin/happyherd" <<'SH'
#!/bin/sh
[ "${1:-}" = doctor ]
[ -z "${HAPPYHERD_FIXTURE_DOCTOR_FAIL:-}" ] || exit 23
printf 'fixture doctor: ok\n'
SH
    chmod +x "$stage/happyherd/bin/happyherd"
  fi
  if [[ "$target" == win32-x64 ]]; then
    filename="happyherd-v${version}-${target}.zip"
    (cd "$stage" && zip -qr "$assets/$filename" happyherd)
    format=zip
  else
    filename="happyherd-v${version}-${target}.tar.gz"
    tar --format=ustar -czf "$assets/$filename" -C "$stage" happyherd
    format=tar.gz
  fi
  node "$root/scripts/write-public-asset-fragment.mjs" \
    --asset "$assets/$filename" \
    --output "$assets/$target.asset.json" \
    --target "$target" \
    --format "$format" \
    --source-sha "$source_sha"
done

cp "$assets"/happyherd-* "$release/"
node "$root/scripts/build-public-release-metadata.mjs" \
  --assets-dir "$assets" \
  --output "$release" \
  --version "$version" \
  --source-sha "$source_sha" \
  --published-at "$published_at" \
  --release-base-url "https://downloads.happyherd.example/releases/happyherd-v$version"
node "$root/scripts/verify-public-launcher-release.mjs" "$release"
test -x "$release/install.sh"
grep -Fq -- '--local-manifest' "$release/install.sh"
grep -Fq -- '--local-asset' "$release/install.sh"
grep -Fq 'LocalManifest' "$release/install.ps1"
grep -Fq 'LocalAsset' "$release/install.ps1"
if node -e 'const fs=require("node:fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.channel="beta";fs.writeFileSync(p,JSON.stringify(v)+"\n")' "$release/release-manifest.json" \
  && node "$root/scripts/verify-public-launcher-release.mjs" "$release" >/dev/null 2>&1; then
  echo 'public launcher verifier accepted a manifest field outside the deployed v1 schema' >&2
  exit 1
fi
node "$root/scripts/build-public-release-metadata.mjs" \
  --assets-dir "$assets" \
  --output "$release" \
  --version "$version" \
  --source-sha "$source_sha" \
  --published-at "$published_at" \
  --release-base-url "https://downloads.happyherd.example/releases/happyherd-v$version" >/dev/null

cp "$release/happyherd-v${version}-linux-x64.tar.gz" "$fixture/tampered.tar.gz"
printf 'tamper' >> "$release/happyherd-v${version}-linux-x64.tar.gz"
if node "$root/scripts/verify-public-launcher-release.mjs" "$release" >/dev/null 2>&1; then
  echo 'public launcher verifier accepted a tampered asset' >&2
  exit 1
fi
mv "$fixture/tampered.tar.gz" "$release/happyherd-v${version}-linux-x64.tar.gz"

grep -Fq 'useradd --system' "$release/install.sh"
grep -Fq 'launchctl bootstrap system' "$release/install.sh"
grep -Fq 'broker-service --config' "$root/installers/service/linux/happyherd-secret-service.sh"
grep -Fq 'OS-separated HappyHerd broker' "$root/server/packages/happyherd-cli/src/cli.ts"
grep -Fq 'HappyHerd managed PATH' "$root/installers/service/common/happyherd-profile-path.mjs"
grep -Fq "from '../runtime/dist/index.mjs'" "$root/installers/service/common/happyherd-uninstall-managed.mjs"
if grep -Fq "from '../../runtime/dist/index.mjs'" "$root/installers/service/common/happyherd-uninstall-managed.mjs"; then
  echo 'managed-Skill uninstaller escapes the owner installation root' >&2
  exit 1
fi
grep -Fq '.happyherd-profile-recovery' "$release/install.sh"
grep -Fq 'retain_temporary=1' "$release/install.sh"
# shellcheck disable=SC2016 # Assert the literal PowerShell variable reference.
grep -Fq 'NT SERVICE\$ServiceName' "$release/install.ps1"
grep -Fq '"@napi-rs/keyring": "1.3.0"' "$root/server/packages/happyherd-cli/package.json"
grep -Fq 'findCredentials' "$root/server/packages/happyherd-cli/src/secretStore.ts"
grep -Fq 'volatile keyutils fallback was rejected' "$root/server/packages/happyherd-cli/src/secretStore.ts"
grep -Fq 'LoadCredentialEncrypted=happyherd-keyring-password:' "$root/installers/service/linux/happyherd-broker.service.template"
grep -Fq '/usr/bin/dbus-run-session --' "$root/installers/service/linux/happyherd-broker.service.template"
grep -Fq 'NoNewPrivileges=false' "$root/installers/service/linux/happyherd-broker.service.template"
if grep -Eq '^(DynamicUser|LockPersonality|MemoryDenyWriteExecute|PrivateDevices|ProtectClock|ProtectHostname|ProtectKernelLogs|ProtectKernelModules|ProtectKernelTunables|RestrictNamespaces|RestrictRealtime|RestrictSUIDSGID)=true$|^(RestrictAddressFamilies|SystemCallArchitectures|SystemCallFilter|SystemCallLog)=' "$root/installers/service/linux/happyherd-broker.service.template"; then
  echo 'Linux broker unit disables the guarded setuid tool launcher' >&2
  exit 1
fi
grep -Fq "execFileSync(process.execPath, [claudeCliPath, '--help']" "$root/server/packages/happy-cli/src/index.ts"
grep -Fq "spawn.sync('codex', ['--help']" "$root/server/packages/happy-cli/src/commands/codexCommand.ts"
grep -Fq 'spawnCommand.sync(command, args, options)' "$root/server/packages/happyherd-cli/src/doctor.ts"
grep -Fq 'const result = spawn.sync(command, args' "$root/server/packages/happy-cli/src/capabilities/agentCapabilities.ts"
if grep -Fq "execFileSync('codex', ['--help']" "$root/server/packages/happy-cli/src/commands/codexCommand.ts"; then
  echo 'Codex help bypasses Windows npm command shims' >&2
  exit 1
fi
# shellcheck disable=SC2016 # Assert the literal generated shell redirection.
grep -Fq '< "$credential"' "$root/installers/service/linux/happyherd-secret-service.sh"
grep -Fq 'SecKeychainSetDomainDefault(kSecPreferencesDomainUser, custom)' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'SecKeychainSetDomainSearchList(kSecPreferencesDomainUser, search_list)' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'CFIndex domain_search_count = CFArrayGetCount(domain_search_list)' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'SecKeychainGetPath(keychain, &path_length, actual_path)' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'keychain_has_exact_path(domain_default, keychain_path)' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'HAPPYHERD_KEYRING_PATH' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'findCredentials(service)' "$root/server/packages/happyherd-cli/src/secretStore.ts"
if grep -Fq 'Entry.withTarget(configured' "$root/server/packages/happyherd-cli/src/secretStore.ts"; then
  echo 'macOS keyring path was passed to a domain-only target modifier' >&2
  exit 1
fi
grep -Fq 'SecKeychainUnlock' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'accepts an already-absent Keychain' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'its unlock master was preserved' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq "const FINAL_PHASE = 'macos-final-cleanup-pending'" "$root/installers/service/common/happyherd-uninstall-phase.mjs"
profile_cleanup_line=$(grep -nF 'HAPPYHERD_PROFILE_HOME=' "$root/installers/uninstall.sh" | /usr/bin/cut -d: -f1)
# shellcheck disable=SC2016 # Assert the literal shell variable references.
service_removal_line=$(grep -nF 'if [ "$platform" = darwin ]; then sudo rm -f -- "$service_definition"; fi' "$root/installers/uninstall.sh" | /usr/bin/cut -d: -f1)
test "$service_removal_line" -gt "$profile_cleanup_line"
if grep -Eq 'FileSecretStore|writeFileSync|writeFile\(' "$root/server/packages/happyherd-cli/src/secretStore.ts"; then
  echo 'public launcher retained a plaintext file-backed secret adapter' >&2
  exit 1
fi

echo 'public-launcher-release-contract: ok'
