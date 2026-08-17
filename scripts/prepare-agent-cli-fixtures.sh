#!/bin/sh
set -eu

destination=${1:?usage: prepare-agent-cli-fixtures.sh DESTINATION}
mkdir -p "$destination"
for provider in claude codex; do
  fixture="$destination/$provider"
  # shellcheck disable=SC2016 # The generated fixture must inspect its own argv.
  printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'case "${1:-}" in' \
    "  --version) printf 'happyherd-e2e $provider version 1.0.0\\n' ;;" \
    "  --help|-h) printf 'happyherd-e2e $provider help\\n' ;;" \
    "  *) printf 'unexpected happyherd-e2e $provider invocation\\n' >&2; exit 64 ;;" \
    'esac' > "$fixture"
  chmod 755 "$fixture"
done
