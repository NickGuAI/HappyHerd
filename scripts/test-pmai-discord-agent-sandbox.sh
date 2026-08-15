#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-source}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$MODE" in
    source) NODE_ROOT="$ROOT/server" ;;
    runtime)
        NODE_ROOT="${PMAI_HAPPYHERD_RELEASE:-/opt/happyherd/current}/daemon"
        export PATH="$NODE_ROOT/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
        ;;
    *) printf 'error: mode must be source or runtime\n' >&2; exit 1 ;;
esac

if ! command -v bwrap >/dev/null 2>&1 \
    || ! command -v rg >/dev/null 2>&1 \
    || ! command -v socat >/dev/null 2>&1; then
    if [[ "$MODE" == source ]]; then
        printf 'PMAI sandbox broker canary skipped: bwrap, rg, and socat are host-only dependencies.\n'
        exit 0
    fi
    printf 'error: PMAI sandbox broker canary requires bwrap, rg, and socat\n' >&2
    exit 1
fi
[[ -d "$NODE_ROOT/node_modules/@anthropic-ai/sandbox-runtime" ]] || {
    printf 'error: sandbox runtime package is missing from %s\n' "$NODE_ROOT" >&2
    exit 1
}
[[ -d "$NODE_ROOT/node_modules/undici" ]] || {
    printf 'error: undici is missing from %s\n' "$NODE_ROOT" >&2
    exit 1
}

cd "$NODE_ROOT"
node --input-type=module <<'NODE'
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';

const server = createServer((_request, response) => response.end('pmai-broker-ok'));
const readOnlyDirectory = await mkdtemp('/var/tmp/pmai-sandbox-readonly-');
const workspaceDirectory = await mkdtemp('/var/tmp/pmai-sandbox-workspace-');
const forbiddenWrite = `${readOnlyDirectory}/must-not-exist`;
const originalCwd = process.cwd();
const undiciUrl = import.meta.resolve('undici');
let sandboxInitialized = false;
try {
  process.chdir(workspaceDirectory);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('canary server has no TCP port');

  await SandboxManager.initialize({
    network: {
      allowedDomains: ['pmai-broker.localhost'],
      deniedDomains: [],
      allowLocalBinding: false,
      allowUnixSockets: [],
    },
    filesystem: {
      denyRead: [],
      allowWrite: ['/tmp'],
      denyWrite: [],
    },
  });
  sandboxInitialized = true;

  const childProgram = [
    'import { writeFileSync } from "node:fs";',
    `import { ProxyAgent, request } from ${JSON.stringify(undiciUrl)};`,
    `try { writeFileSync(${JSON.stringify(forbiddenWrite)}, "forbidden"); process.exit(3); } catch {}`,
    'const proxy = process.env.HTTP_PROXY;',
    'if (proxy === undefined) throw new Error("sandbox proxy missing");',
    `const response = await request("http://pmai-broker.localhost:${address.port}", { dispatcher: new ProxyAgent(proxy) });`,
    'const body = await response.body.text();',
    'if (response.statusCode === 200 && body === "pmai-broker-ok") process.exit(0);',
    'process.exit(2);',
  ].join(' ');
  const command = `node --input-type=module -e ${JSON.stringify(childProgram)}`;
  const wrapped = await SandboxManager.wrapWithSandbox(command);
  const result = await new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', wrapped], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stderr }));
  });
  if (result.status !== 0) {
    throw new Error(`sandboxed PMAI broker request failed: ${result.stderr.trim()}`);
  }
} finally {
  if (sandboxInitialized) await SandboxManager.reset();
  process.chdir(originalCwd);
  if (server.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await rm(readOnlyDirectory, { recursive: true, force: true });
  await rm(workspaceDirectory, { recursive: true, force: true });
}
NODE

printf 'PMAI sandbox broker canary passed.\n'
