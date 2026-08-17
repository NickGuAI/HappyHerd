#!/usr/bin/env bash
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
grep -Fq 'install --prod --frozen-lockfile --offline --ignore-scripts' "$workflow"
tool_launcher_source="$root/installers/service/unix/happyherd-tool-launcher.c"
keychain_broker_source="$root/installers/service/darwin/happyherd-keychain-broker.c"
node "$root/scripts/test-macos-uninstall-recovery.mjs"
node "$root/scripts/test-happyherd-profile-path.mjs"
grep -Fq 'happyherd-v*' "$workflow"
grep -Fq 'gh release create' "$workflow"
grep -Fq -- '--prerelease' "$workflow"
for required_target in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do
  grep -Fq "target: $required_target" "$workflow"
done
grep -Fq 'execve(runtime, child, clean_environment);' "$tool_launcher_source"
grep -Fq 'execve(sandbox[0], sandbox, clean_environment);' "$tool_launcher_source"
grep -Fq 'execve(node_runtime, arguments, clean_environment);' "$keychain_broker_source"
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
grep -Fq 'HappyHerd installation diagnostics (no credential values are displayed):' "$root/installers/install.sh.template"
grep -Fq 'sudo journalctl --unit "$service_name" --no-pager --lines=80' "$root/installers/install.sh.template"
payload="$fixture/payload"
mkdir -p \
  "$payload/bin" \
  "$payload/dist" \
  "$payload/node_modules/happy"
printf '{"name":"@happyherd/cli","version":"%s"}\n' "$version" > "$payload/package.json"
printf '#!/usr/bin/env node\n' > "$payload/bin/happyherd.mjs"
printf 'export const fixture = true;\n' > "$payload/dist/index.mjs"
printf '{"name":"happy"}\n' > "$payload/node_modules/happy/package.json"
mkdir -p "$payload/node_modules/.bin"
ln -s "$payload/bin/happyherd.mjs" "$payload/node_modules/.bin/happyherd"
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
grep -Fq '.happyherd-profile-recovery' "$release/install.sh"
grep -Fq 'retain_temporary=1' "$release/install.sh"
# shellcheck disable=SC2016 # Assert the literal PowerShell variable reference.
grep -Fq 'NT SERVICE\$ServiceName' "$release/install.ps1"
grep -Fq '"@napi-rs/keyring": "1.3.0"' "$root/server/packages/happyherd-cli/package.json"
grep -Fq 'findCredentials' "$root/server/packages/happyherd-cli/src/secretStore.ts"
grep -Fq 'volatile keyutils fallback was rejected' "$root/server/packages/happyherd-cli/src/secretStore.ts"
grep -Fq 'LoadCredentialEncrypted=happyherd-keyring-password:' "$root/installers/service/linux/happyherd-broker.service.template"
grep -Fq '/usr/bin/dbus-run-session --' "$root/installers/service/linux/happyherd-broker.service.template"
# shellcheck disable=SC2016 # Assert the literal generated shell redirection.
grep -Fq '< "$credential"' "$root/installers/service/linux/happyherd-secret-service.sh"
grep -Fq 'HAPPYHERD_KEYRING_TARGET' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'SecKeychainUnlock' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'later invocation accepts the already-absent custom Keychain' "$root/installers/service/darwin/happyherd-keychain-broker.c"
grep -Fq 'its master was preserved' "$root/installers/service/darwin/happyherd-keychain-broker.c"
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
