#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yazl from 'yazl';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

const universalExclusionPatterns = [
  '**/tests/**', '**/__pycache__/**', '**/.pytest_cache/**', '**/.mypy_cache/**', '**/.ruff_cache/**',
  '**/*.py[cod]', '**/*.pyd', '**/*.so', '**/*.dylib', '**/*.dll', '**/*.exe', '**/*.node', '**/*.wasm',
  '**/*.{a,o,obj,lib,class}', '**/.env', '**/.env.*', '**/*.env', '**/*credential*', '**/*credential*/**',
  '**/*secret*', '**/*secret*/**', '**/*.log', '**/logs/**',
  'content scan: ELF, PE, Mach-O, WebAssembly, and Java bytecode magic',
];

const output = resolve(option('output'));
const issuer = new URL(option('issuer'));
if (issuer.protocol !== 'http:' || issuer.hostname !== '127.0.0.1' || issuer.pathname !== '/' || issuer.search || issuer.hash) {
  throw new Error('--issuer must be a clean IPv4 loopback HTTP origin');
}
mkdirSync(output, { recursive: true });

const guide = Buffer.from('# Generic E2E Guide\n\nUse the declared check tool through HappyHerd.\n');
const tool = Buffer.from(`import ctypes, json, os, urllib.request
base = os.environ["HAPPYHERD_API_BASE_URL"]
request = urllib.request.Request(base + "/protected", headers={"Authorization": "Bearer " + os.environ["HAPPYHERD_ACCESS_TOKEN"]})
with urllib.request.urlopen(request, timeout=10) as response:
    result = {"issuer": os.environ["HAPPYHERD_ISSUER"], "result": json.load(response)["result"]}
if os.name == "nt":
    count = ctypes.c_uint32()
    credentials = ctypes.c_void_p()
    ok = ctypes.windll.advapi32.CredEnumerateW(None, 0, ctypes.byref(count), ctypes.byref(credentials))
    result["toolCredentialCount"] = int(count.value) if ok else 0
    if ok:
        ctypes.windll.advapi32.CredFree(credentials)
print(json.dumps(result, sort_keys=True))
`);
const holdTool = Buffer.from(`import time
print("holding", flush=True)
time.sleep(15)
`);
const spawnTool = Buffer.from(`import json, os, subprocess, sys
marker = sys.argv[1]
child = "import pathlib,sys,time;time.sleep(2);pathlib.Path(sys.argv[1]).write_text('survived', encoding='utf-8')"
options = {
    "stdin": subprocess.DEVNULL,
    "stdout": subprocess.DEVNULL,
    "stderr": subprocess.DEVNULL,
    "close_fds": True,
}
if os.name == "nt":
    options["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
else:
    options["start_new_session"] = True
try:
    subprocess.Popen([sys.executable, "-I", "-X", "utf8", "-c", child, marker], **options)
    denied = False
except (OSError, subprocess.SubprocessError):
    denied = True
print(json.dumps({"spawnDenied": denied, "markerPresentAtReturn": os.path.exists(marker)}, sort_keys=True))
`);
const files = [
  { path: 'generic-guide/SKILL.md', bytes: guide, mode: 0o644 },
  { path: 'generic-guide/scripts/check.py', bytes: tool, mode: 0o755 },
  { path: 'generic-guide/scripts/hold.py', bytes: holdTool, mode: 0o755 },
  { path: 'generic-guide/scripts/spawn.py', bytes: spawnTool, mode: 0o755 },
].map((file) => ({
  ...file,
  sizeBytes: file.bytes.length,
  sha256: sha256(file.bytes),
}));
const digestRecords = files.map((file) => ({
  mode: file.mode,
  path: file.path,
  sha256: file.sha256,
  sizeBytes: file.sizeBytes,
})).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
const manifest = {
  schemaVersion: 1,
  product: {
    name: 'HappyHerd E2E Issuer',
    baseUrl: `${issuer.origin}/api`,
    docsUrl: `${issuer.origin}/docs`,
  },
  artifact: {
    id: 'generic-e2e-skill-bundle',
    version: '1.0.0',
    format: 'zip',
    minHappyHerdVersion: '1.2.1-beta.1',
    skills: ['generic-guide'],
    contentSha256: sha256(JSON.stringify(digestRecords)),
  },
  source: { sha: 'a'.repeat(40) },
  permissions: { scopes: ['guide.read'] },
  exclusions: { policy: 'generic-e2e-allowlist', patterns: universalExclusionPatterns },
  files: files.map(({ bytes: _bytes, ...file }) => file),
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const archive = new yazl.ZipFile();
archive.addBuffer(manifestBytes, 'manifest.json', { mode: 0o100600 });
for (const file of files) archive.addBuffer(file.bytes, file.path, { mode: 0o100000 | file.mode });
archive.end();
const chunks = [];
for await (const chunk of archive.outputStream) chunks.push(chunk);
const bundle = Buffer.concat(chunks);
writeFileSync(join(output, 'bundle.zip'), bundle);
writeFileSync(join(output, 'fixture.json'), `${JSON.stringify({
  schemaVersion: 1,
  issuer: issuer.origin,
  bundlePath: join(output, 'bundle.zip'),
  bundleSha256: sha256(bundle),
  manifestSha256: sha256(manifestBytes),
  accessToken: 'happyherd-e2e-broker-only-token-value',
}, null, 2)}\n`);
process.stdout.write(`${join(output, 'fixture.json')}\n`);
