#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract_workflow="$repo_root/.github/workflows/contract-suite.yml"
proposal_doc="$repo_root/docs/upstream-sync-rehearsal.md"
server_guide="$repo_root/server/AGENTS.md"
lifecycle_playbook="$repo_root/.dev/playbooks/development-lifecycle.md"

fail() {
  echo "upstream-proposal-ownership: $*" >&2
  exit 1
}

[[ ! -e "$repo_root/.github/workflows/upstream-sync.yml" ]] ||
  fail "scheduled GitHub upstream workflow must remain removed"
! grep -Fq 'Real upstream rehearsal' "$contract_workflow" ||
  fail "normal contract workflow must not rehearse upstream"
! grep -Fq 'rehearse-upstream-sync.sh' "$contract_workflow" ||
  fail "normal contract workflow must not call the rehearsal script"
grep -Fq 'happyherd-upstream-merge-proposal' "$proposal_doc" ||
  fail "proposal documentation must name the native automation"
! grep -Fiq 'real upstream rehearsal' "$server_guide" ||
  fail "server delivery guide must not require the removed rehearsal"
grep -Fq 'happyherd-upstream-merge-proposal' "$server_guide" ||
  fail "server delivery guide must name the native proposal automation"
! grep -Fiq 'upstream: rehearsal' "$lifecycle_playbook" ||
  fail "development lifecycle must not route upstream proposals through GitHub rehearsal"
grep -Fq 'happyherd-upstream-merge-proposal' "$lifecycle_playbook" ||
  fail "development lifecycle must name the native proposal automation"
grep -Fq "native \`happyherd automation\`" "$repo_root/.dev/SOP_INDEX.md" ||
  fail "SOP index must route proposals through native automation"
[[ -x "$repo_root/scripts/rehearse-upstream-sync.sh" ]] ||
  fail "read-only rehearsal evidence owner must remain executable"

echo "upstream-proposal-ownership: ok (native proposal, no GitHub trigger)"
