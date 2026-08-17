#!/usr/bin/env node

import {
  cpSync,
  copyFileSync,
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const targets = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);

function fail(message) {
  throw new Error(`public-launcher-stage: ${message}`);
}

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) fail('arguments must be --name value pairs');
    values.set(name.slice(2), value);
  }
  return values;
}

const options = argumentsMap(process.argv.slice(2));
const payload = resolve(options.get('payload') ?? fail('--payload is required'));
const stage = resolve(options.get('stage') ?? fail('--stage is required'));
const target = options.get('target') ?? fail('--target is required');
const sourceSha = options.get('source-sha') ?? fail('--source-sha is required');
const version = options.get('version') ?? fail('--version is required');
const nodeRuntime = resolve(options.get('node-runtime') ?? fail('--node-runtime is required'));
const pythonRoot = resolve(options.get('python-root') ?? fail('--python-root is required'));
const pythonExecutable = resolve(options.get('python-executable') ?? fail('--python-executable is required'));
const serviceAsset = resolve(options.get('service-asset') ?? fail('--service-asset is required'));
const secretServiceWrapperOption = options.get('secret-service-wrapper');
const secretServiceWrapper = secretServiceWrapperOption ? resolve(secretServiceWrapperOption) : undefined;
const keychainHostOption = options.get('keychain-host');
const keychainHost = keychainHostOption ? resolve(keychainHostOption) : undefined;
const toolLauncher = resolve(options.get('tool-launcher') ?? fail('--tool-launcher is required'));
const trustVerifierOption = options.get('trust-verifier');
const trustVerifier = trustVerifierOption ? resolve(trustVerifierOption) : undefined;
const uninstaller = resolve(options.get('uninstaller') ?? fail('--uninstaller is required'));

if (!targets.has(target)) fail(`unsupported target: ${target}`);
if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail('--source-sha must be a full Git SHA');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail('--version must be semantic');
if (!existsSync(join(payload, 'package.json'))) fail('deployment payload is missing package.json');
const packageJson = JSON.parse(readFileSync(join(payload, 'package.json'), 'utf8'));
if (packageJson.name !== '@happyherd/cli' || packageJson.version !== version) {
  fail('deployment payload identity does not match the requested release');
}
for (const required of [
  'bin/happyherd.mjs',
  'dist/index.mjs',
  'node_modules/happy/package.json',
]) {
  if (!existsSync(join(payload, required))) fail(`deployment payload is missing ${required}`);
}

for (const [path, label] of [
  [nodeRuntime, 'Node runtime'],
  [pythonRoot, 'Python root'],
  [pythonExecutable, 'Python executable'],
  [serviceAsset, 'broker service asset'],
  [toolLauncher, 'isolated tool launcher'],
  [uninstaller, 'uninstaller'],
]) {
  if (!existsSync(path)) fail(`${label} is missing`);
}
if (target.startsWith('linux-')) {
  if (!secretServiceWrapper || !existsSync(secretServiceWrapper)) {
    fail('Linux release requires --secret-service-wrapper');
  }
} else if (secretServiceWrapper) {
  fail('--secret-service-wrapper is valid only for Linux targets');
}
if (target.startsWith('darwin-')) {
  if (!keychainHost || !existsSync(keychainHost)) fail('macOS release requires --keychain-host');
} else if (keychainHost) {
  fail('--keychain-host is valid only for macOS targets');
}
if (target === 'win32-x64') {
  if (!trustVerifier || !existsSync(trustVerifier)) fail('Windows release requires --trust-verifier');
} else if (trustVerifier) {
  fail('--trust-verifier is valid only for the Windows target');
}

function contained(rootDirectory, candidate) {
  const child = relative(rootDirectory, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function verifyPortableTree(rootDirectory, prefix, directory = rootDirectory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(rootDirectory, path).split(sep).join('/');
    if (!/^[\x20-\x7e]+$/.test(relativePath) || Buffer.byteLength(`${prefix}/${relativePath}`, 'utf8') > 240) {
      fail(`${prefix} path is not portable: ${relativePath}`);
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const targetPath = realpathSync(path);
      if (!contained(rootDirectory, targetPath)) fail(`${prefix} symlink escapes its root: ${relativePath}`);
    } else if (stat.isDirectory()) {
      verifyPortableTree(rootDirectory, prefix, path);
    } else if (!stat.isFile()) {
      fail(`${prefix} contains an unsupported entry: ${relativePath}`);
    }
  }
}

if (!contained(pythonRoot, pythonExecutable)) fail('Python executable is outside the bundled Python root');
verifyPortableTree(pythonRoot, 'happyherd/python');

const pythonProbe = spawnSync(pythonExecutable, [
  '-I', '-X', 'utf8', '-c',
  'import json,sys;from importlib.metadata import version;from zoneinfo import ZoneInfo;print(json.dumps({"version":list(sys.version_info[:3]),"timezone":ZoneInfo("America/New_York").key,"tzdata":version("tzdata")}))',
], { cwd: pythonRoot, env: {}, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
if (pythonProbe.error || pythonProbe.status !== 0) fail('source Python 3.10+ runtime with tzdata failed its isolated smoke test');
let pythonReceipt;
try { pythonReceipt = JSON.parse(pythonProbe.stdout.trim()); } catch { fail('source Python smoke result is invalid'); }
if (
  !Array.isArray(pythonReceipt.version)
  || pythonReceipt.version.length !== 3
  || pythonReceipt.version[0] !== 3
  || pythonReceipt.version[1] < 10
  || pythonReceipt.timezone !== 'America/New_York'
  || typeof pythonReceipt.tzdata !== 'string'
) fail('Python 3.10+ and bundled tzdata are required');

function verifyPayloadTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(payload, path).split(sep).join('/');
    const archivePath = `happyherd/runtime/${relativePath}`;
    if (!/^[\x20-\x7e]+$/.test(relativePath) || Buffer.byteLength(archivePath, 'utf8') > 255) {
      fail(`deployment payload path is not portable: ${relativePath}`);
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const targetPath = realpathSync(path);
      const targetRelative = relative(payload, targetPath);
      if (targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) {
        fail(`deployment payload symlink escapes its root: ${relativePath}`);
      }
    } else if (stat.isDirectory()) {
      verifyPayloadTree(path);
    } else if (!stat.isFile()) {
      fail(`deployment payload contains an unsupported entry: ${relativePath}`);
    }
  }
}

verifyPayloadTree(payload);

rmSync(stage, { recursive: true, force: true });
const root = join(stage, 'happyherd');
mkdirSync(root, { recursive: true });
// pnpm deploy creates convenience symlinks whose absolute targets live inside
// the deployment directory. Resolve those only after proving containment so
// published archives have no host-specific or traversable links.
cpSync(payload, join(root, 'runtime'), { recursive: true, dereference: true });

function materializeLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const targetPath = realpathSync(path);
      const targetStat = lstatSync(targetPath);
      rmSync(path, { force: true });
      if (targetStat.isDirectory()) {
        cpSync(targetPath, path, { recursive: true, dereference: true });
        materializeLinks(path);
      } else if (targetStat.isFile()) {
        copyFileSync(targetPath, path);
        chmodSync(path, targetStat.mode & 0o777);
      } else {
        fail(`deployment payload link points to an unsupported entry: ${relative(payload, targetPath)}`);
      }
    } else if (stat.isDirectory()) {
      materializeLinks(path);
    }
  }
}

materializeLinks(join(root, 'runtime'));

const nativeRoot = join(root, 'native');
mkdirSync(nativeRoot, { recursive: true });
const stagedNode = join(nativeRoot, target === 'win32-x64' ? 'node.exe' : 'node');
copyFileSync(nodeRuntime, stagedNode);
chmodSync(stagedNode, 0o755);

const stagedPythonRoot = join(root, 'python');
cpSync(pythonRoot, stagedPythonRoot, { recursive: true, dereference: true });
materializeLinks(stagedPythonRoot);
const pythonRelative = relative(pythonRoot, pythonExecutable);
const stagedPython = join(stagedPythonRoot, pythonRelative);
if (!existsSync(stagedPython)) fail('staged Python executable is missing');
if (target !== 'win32-x64') chmodSync(stagedPython, 0o755);
const stagedProbe = spawnSync(stagedPython, [
  '-I', '-X', 'utf8', '-c',
  'import json,sys;from importlib.metadata import version;from zoneinfo import ZoneInfo;print(json.dumps({"version":list(sys.version_info[:3]),"timezone":ZoneInfo("America/New_York").key,"tzdata":version("tzdata")}))',
], { cwd: root, env: {}, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
if (stagedProbe.error || stagedProbe.status !== 0) fail('relocated broker-owned Python runtime failed its isolated smoke test');

const serviceRoot = join(root, 'service');
mkdirSync(serviceRoot, { recursive: true });
copyFileSync(
  resolve(import.meta.dirname, '..', 'installers', 'service', 'common', 'happyherd-uninstall-managed.mjs'),
  join(serviceRoot, 'happyherd-uninstall-managed.mjs'),
);
copyFileSync(
  resolve(import.meta.dirname, '..', 'installers', 'service', 'common', 'happyherd-uninstall-phase.mjs'),
  join(serviceRoot, 'happyherd-uninstall-phase.mjs'),
);
copyFileSync(
  resolve(import.meta.dirname, '..', 'installers', 'service', 'common', 'happyherd-profile-path.mjs'),
  join(serviceRoot, 'happyherd-profile-path.mjs'),
);
const serviceName = target === 'win32-x64'
  ? 'happyherd-broker-service.exe'
  : target.startsWith('darwin-')
    ? 'dev.happyherd.broker.plist.template'
    : 'happyherd-broker.service.template';
copyFileSync(serviceAsset, join(serviceRoot, serviceName));
if (target === 'win32-x64') chmodSync(join(serviceRoot, serviceName), 0o755);
if (secretServiceWrapper) {
  copyFileSync(secretServiceWrapper, join(serviceRoot, 'happyherd-secret-service'));
  chmodSync(join(serviceRoot, 'happyherd-secret-service'), 0o755);
}
if (keychainHost) {
  copyFileSync(keychainHost, join(serviceRoot, 'happyherd-keychain-broker'));
  chmodSync(join(serviceRoot, 'happyherd-keychain-broker'), 0o755);
}
const toolLauncherName = target === 'win32-x64' ? 'happyherd-tool-launcher.exe' : 'happyherd-tool-launcher';
copyFileSync(toolLauncher, join(serviceRoot, toolLauncherName));
chmodSync(join(serviceRoot, toolLauncherName), 0o755);
if (trustVerifier) {
  copyFileSync(trustVerifier, join(serviceRoot, 'happyherd-acl-check.exe'));
  chmodSync(join(serviceRoot, 'happyherd-acl-check.exe'), 0o755);
}
const uninstallName = target === 'win32-x64' ? 'uninstall.ps1' : 'uninstall.sh';
copyFileSync(uninstaller, join(root, uninstallName));
if (target !== 'win32-x64') chmodSync(join(root, uninstallName), 0o755);

const receipt = {
  schemaVersion: 1,
  product: 'HappyHerd',
  version,
  target,
  sourceSha,
  nodeRuntime: target === 'win32-x64' ? 'native/node.exe' : 'native/node',
  pythonRuntime: `python/${pythonRelative.split(sep).join('/')}`,
  pythonVersion: pythonReceipt.version.join('.'),
  tzdataVersion: pythonReceipt.tzdata,
  toolLauncher: `service/${toolLauncherName}`,
  ...(keychainHost ? { keychainHost: 'service/happyherd-keychain-broker' } : {}),
  ...(trustVerifier ? { trustVerifier: 'service/happyherd-acl-check.exe' } : {}),
};
writeFileSync(join(root, 'release.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });

if (target === 'win32-x64') {
  writeFileSync(
    join(root, 'happyherd.cmd'),
    '@echo off\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "NODE_EXTRA_CA_CERTS="\r\nset "SSL_CERT_FILE="\r\nset "SSL_CERT_DIR="\r\nset "HTTP_PROXY="\r\nset "HTTPS_PROXY="\r\nset "ALL_PROXY="\r\nset "HAPPYHERD_ACCESS_TOKEN="\r\nset "HAPPYHERD_NATIVE_INSTALLATION=1"\r\n"%~dp0native\\node.exe" "%~dp0runtime\\bin\\happyherd.mjs" %*\r\n',
    { mode: 0o644 },
  );
} else {
  const wrapper = join(root, 'bin', 'happyherd');
  mkdirSync(dirname(wrapper), { recursive: true });
  writeFileSync(
    wrapper,
    '#!/bin/sh\nset -eu\nunset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy HAPPYHERD_ACCESS_TOKEN\nSELF=$0\nwhile [ -L "$SELF" ]; do\n  LINK=$(readlink "$SELF")\n  case "$LINK" in\n    /*) SELF=$LINK ;;\n    *) SELF=$(dirname -- "$SELF")/$LINK ;;\n  esac\ndone\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)\nexec "$SCRIPT_DIR/../native/node" "$SCRIPT_DIR/../runtime/bin/happyherd.mjs" "$@"\n',
    { mode: 0o755 },
  );
}

process.stdout.write(`${root}\n`);
