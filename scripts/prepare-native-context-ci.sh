#!/usr/bin/env bash
# Provision the source-built supervisor only on a disposable hosted Linux runner.
set -euo pipefail

[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
[[ "$(uname -s)" == Linux ]]
[[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == 1 ]]
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$repo_root" == "$(realpath "$GITHUB_WORKSPACE")" ]]
# rename:preserve
source_binary="$repo_root/native/packages/happy-agent-supervisor/native/target/release/happy-agent-supervisor"
installed_directory=/usr/local/lib/happyherd-native-ci
installed_binary="$installed_directory/happy-agent-supervisor"
# /rename:preserve
profile_file=/etc/apparmor.d/happyherd-native-ci
[[ -f "$source_binary" && -x "$source_binary" && ! -L "$source_binary" ]]
cd "$repo_root/native"
# Query the same package resolver used by host compute, rather than assuming
# that a successful source build displaced any installed platform artifact.
# rename:preserve
resolved_binary="$(pnpm --filter @slopus/happy-agent-compute exec node --input-type=module -e '
import { resolveSupervisorBinary } from "@slopus/happy-agent-supervisor";
console.log(resolveSupervisorBinary());
')"
# /rename:preserve
printf 'Native compute resolved supervisor before CI preparation: %s\n' "$resolved_binary"
[[ "$resolved_binary" == "$source_binary" ]]
[[ ! -e "$installed_directory" && ! -e "$profile_file" ]]
sudo install -d -o root -g root -m 0755 "$installed_directory"
sudo install -o root -g root -m 0755 "$source_binary" "$installed_binary"
[[ "$(realpath "$installed_binary")" == "$installed_binary" ]]
for path in /usr /usr/local /usr/local/lib "$installed_directory" "$installed_binary"; do
  [[ "$(stat -c %u "$path")" == 0 && ! -w "$path" ]]
done

# The inherited source resolver still selects its usual build target. Only the
# ignored build output redirects to the immutable, exact profiled executable.
rm "$source_binary"
ln -s "$installed_binary" "$source_binary"
[[ "$(realpath "$source_binary")" == "$installed_binary" ]]
sudo tee "$profile_file" >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>
profile happyherd-native-ci "$installed_binary" flags=(unconfined) {
    userns,
}
EOF
sudo chown root:root "$profile_file"
sudo chmod 0644 "$profile_file"
sudo apparmor_parser --skip-kernel-load "$profile_file"
sudo apparmor_parser --replace "$profile_file"
[[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == 1 ]]
echo 'native-context-runtime CI: exact immutable supervisor userns profile loaded; global restriction unchanged'
# rename:preserve
resolved_binary="$(pnpm --filter @slopus/happy-agent-compute exec node --input-type=module -e '
import { resolveSupervisorBinary } from "@slopus/happy-agent-supervisor";
console.log(resolveSupervisorBinary());
')"
# /rename:preserve
printf 'Native compute resolved supervisor after CI preparation: %s\n' "$resolved_binary"
[[ "$resolved_binary" == "$installed_binary" ]]
# Exercise automatic executable-profile attachment through the existing source
# resolver's target; no aa-exec override or interpreter allowance supplies it.
probe_output="$(timeout 15 "$source_binary" \
  --policy '{"mode":"read_only","network":{"egress":false,"localBinding":false}}' \
  -- /bin/sh -c 'printf ready')"
[[ "$probe_output" == ready ]]
[[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == 1 ]]
echo 'native-context-runtime CI: source-built read-only sandbox probe passed'
