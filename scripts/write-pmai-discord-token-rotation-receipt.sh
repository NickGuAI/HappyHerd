#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${1:-/etc/pmai-discord-agent/secrets/discord-token}"
APPLICATION_ID="${2:-}"
RECEIPT_FILE="${3:-/etc/pmai-discord-agent/secrets/discord-token-rotation.json}"
BRIDGE_USER=pmai-discord-bridge

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'token receipt creation must run as root'
[[ "$APPLICATION_ID" =~ ^[0-9]+$ ]] || die 'Discord application ID is required'
[[ -f "$TOKEN_FILE" && ! -L "$TOKEN_FILE" && -s "$TOKEN_FILE" ]] || die 'rotated Discord token file is missing'
[[ "$(stat -c '%a:%U' "$TOKEN_FILE")" == "600:$BRIDGE_USER" ]] || die 'rotated token must be mode 0600 and owned by the bridge user'

export PMAI_ROTATED_TOKEN_FILE="$TOKEN_FILE"
export PMAI_ROTATED_APPLICATION_ID="$APPLICATION_ID"
export PMAI_ROTATION_RECEIPT_FILE="$RECEIPT_FILE"
node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const token = fs.readFileSync(process.env.PMAI_ROTATED_TOKEN_FILE, 'utf8').trim();
if (!token) process.exit(1);
const receipt = {
  schemaVersion: 1,
  applicationId: process.env.PMAI_ROTATED_APPLICATION_ID,
  rotatedAt: new Date().toISOString(),
  tokenSha256: crypto.createHash('sha256').update(token).digest('hex'),
};
const target = process.env.PMAI_ROTATION_RECEIPT_FILE;
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
fs.renameSync(temporary, target);
NODE
chown "$BRIDGE_USER:$BRIDGE_USER" "$RECEIPT_FILE"
chmod 0600 "$RECEIPT_FILE"
unset PMAI_ROTATED_TOKEN_FILE PMAI_ROTATED_APPLICATION_ID PMAI_ROTATION_RECEIPT_FILE
printf 'Discord token rotation receipt installed without printing token material.\n'
