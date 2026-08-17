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
grep -Fq 'sudo /usr/bin/security lock-keychain "$keychain_path"' "$root/scripts/test-installed-happyherd-e2e.sh"
grep -Fq 'detached-descendant evidence (bounded):' "$root/scripts/test-installed-happyherd-e2e.sh"
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
grep -Fq '"*$ServiceSid`:(OI)(CI)F"' "$root/installers/install.ps1.template"
grep -Fq '"*$ToolSid`:(OI)(CI)RX"' "$root/installers/install.ps1.template"
grep -Fq '"*$OwnerSid`:(OI)(CI)RX"' "$root/installers/install.ps1.template"
grep -Fq '$Rules += "*$Reader`:R"' "$root/installers/install.ps1.template"
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
if grep -F '/Users/$' "$root/installers/install.sh.template" | grep -Fq 'GeneratedUID'; then
  echo 'macOS installer writes the protected GeneratedUID attribute on a local user' >&2
  exit 1
fi
grep -Fq 'new_service_group=1' "$root/installers/install.sh.template"
grep -Fq 'new_service_user=1' "$root/installers/install.sh.template"
grep -Fq 'new_tool_user=1' "$root/installers/install.sh.template"
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
grep -Fq "trap failure_report ERR" "$root/scripts/test-installed-happyherd-e2e.sh"
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
