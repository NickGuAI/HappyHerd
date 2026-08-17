#!/bin/sh
set -eu

destination=${1:?usage: prepare-agent-cli-fixtures.sh DESTINATION}
mkdir -p "$destination"

claude_fixture="$destination/claude.js"
# The maintained Happy launcher resolves Unix PATH entries to their real
# JavaScript/native Claude entrypoint. Model that supported installation shape
# instead of presenting an extensionless shell file that it correctly rejects.
printf '%s\n' \
  '#!/usr/bin/env node' \
  "'use strict';" \
  "const argument = process.argv[2] || '';" \
  "if (argument === '--version') console.log('happyherd-e2e claude version 1.0.0');" \
  "else if (argument === '--help' || argument === '-h') console.log('happyherd-e2e claude help');" \
  "else { console.error('unexpected happyherd-e2e claude invocation'); process.exitCode = 64; }" \
  > "$claude_fixture"
chmod 755 "$claude_fixture"
ln -sf claude.js "$destination/claude"

codex_fixture="$destination/codex"
# shellcheck disable=SC2016 # The generated fixture must inspect its own argv.
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'case "${1:-}" in' \
  "  --version) printf 'happyherd-e2e codex version 1.0.0\\n' ;;" \
  "  --help|-h) printf 'happyherd-e2e codex help\\n' ;;" \
  "  *) printf 'unexpected happyherd-e2e codex invocation\\n' >&2; exit 64 ;;" \
  'esac' > "$codex_fixture"
chmod 755 "$codex_fixture"
