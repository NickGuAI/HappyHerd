#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const targets = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
const targetPackages = {
  'darwin-arm64': {
    agent: 'claude-agent-sdk-darwin-arm64',
    keyring: 'keyring-darwin-arm64',
  },
  'darwin-x64': {
    agent: 'claude-agent-sdk-darwin-x64',
    keyring: 'keyring-darwin-x64',
  },
  'linux-arm64': {
    agent: 'claude-agent-sdk-linux-arm64',
    keyring: 'keyring-linux-arm64-gnu',
  },
  'linux-x64': {
    agent: 'claude-agent-sdk-linux-x64',
    keyring: 'keyring-linux-x64-gnu',
  },
  'win32-x64': {
    agent: 'claude-agent-sdk-win32-x64',
    keyring: 'keyring-win32-x64-msvc',
  },
};

function fail(message) {
  throw new Error(`public-launcher-payload: ${message}`);
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

function contained(rootDirectory, candidate) {
  const child = relative(rootDirectory, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function configure(payload, serverRoot) {
  const packagePath = join(payload, 'package.json');
  const lockPath = join(payload, 'pnpm-lock.yaml');
  if (!existsSync(packagePath) || !existsSync(lockPath)) {
    fail('configure requires a pnpm deployment package and lockfile');
  }

  const rootPackage = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8'));
  const overrides = rootPackage.pnpm?.overrides;
  if (!overrides || Object.keys(overrides).length === 0) fail('source workspace pnpm overrides are missing');

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (packageJson.name !== '@happyherd/cli') fail('deployment payload has the wrong package identity');
  packageJson.pnpm = { ...packageJson.pnpm, overrides };
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const require = createRequire(join(serverRoot, 'package.json'));
  const yaml = require('yaml');
  const lockfile = yaml.parse(readFileSync(lockPath, 'utf8'));
  lockfile.overrides = overrides;
  writeFileSync(lockPath, yaml.stringify(lockfile, { lineWidth: 0 }));
  writeFileSync(
    join(payload, 'pnpm-workspace.yaml'),
    'packages:\n  - .\ninjectWorkspacePackages: true\nnodeLinker: hoisted\nsymlink: false\npreferSymlinkedExecutables: true\n',
  );
}

function prunePlatformPackages(scopeRoot, pattern, expected, label) {
  if (!existsSync(scopeRoot)) fail(`${label} package scope is missing`);
  for (const entry of readdirSync(scopeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !pattern.test(entry.name) || entry.name === expected) continue;
    rmSync(join(scopeRoot, entry.name), { recursive: true, force: true });
  }
  if (!existsSync(join(scopeRoot, expected, 'package.json'))) {
    fail(`${label} package for the release target is missing: ${expected}`);
  }
}

function verifyDependencyClosure(payload) {
  const probePath = join(payload, 'node_modules', 'yauzl', 'fd-slicer.js');
  if (!existsSync(probePath)) fail('yauzl runtime dependency is missing');
  const require = createRequire(probePath);
  const resolved = require.resolve('pend');
  if (!contained(payload, resolved)) fail('transitive dependency resolution escapes the deployment payload');
}

function scanHostPaths(payload, forbiddenValues) {
  const needles = [
    ...forbiddenValues,
    '/home/runner/',
    '/Users/runner/',
    'C:\\Users\\runneradmin\\',
    'D:\\a\\',
  ].filter((value) => value && value !== sep);

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const targetPath = realpathSync(path);
        if (!contained(payload, targetPath)) {
          fail(`final payload symlink escapes its root: ${relative(payload, path)}`);
        }
        continue;
      }
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) continue;
      const buffer = readFileSync(path);
      if (buffer.includes(0)) continue;
      const content = buffer.toString('utf8');
      const found = needles.find((needle) => content.includes(needle));
      if (found) fail(`final payload exposes a build-host path in ${relative(payload, path)}`);
    }
  }

  walk(payload);
}

function finalize(payload, serverRoot, target) {
  const packagePath = join(payload, 'package.json');
  const nodeModules = join(payload, 'node_modules');
  if (!existsSync(packagePath) || !existsSync(nodeModules)) {
    fail('finalize requires an installed deployment payload');
  }

  const expected = targetPackages[target];
  prunePlatformPackages(
    join(nodeModules, '@anthropic-ai'),
    /^claude-agent-sdk-(?:darwin|linux|win32)-/,
    expected.agent,
    'Claude agent runtime',
  );
  prunePlatformPackages(
    join(nodeModules, '@napi-rs'),
    /^keyring-(?:darwin|freebsd|linux|win32)-/,
    expected.keyring,
    'keyring runtime',
  );

  const happyRoot = join(nodeModules, 'happy');
  const toolsRoot = join(happyRoot, 'tools');
  const unpackedRoot = join(toolsRoot, 'unpacked');
  rmSync(unpackedRoot, { recursive: true, force: true });
  const unpack = spawnSync(process.execPath, [join(happyRoot, 'scripts', 'unpack-tools.cjs')], {
    cwd: happyRoot,
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  if (unpack.error || unpack.status !== 0) {
    fail(`current-platform tool extraction failed: ${(unpack.stderr || unpack.stdout || '').trim()}`);
  }
  const executableSuffix = target === 'win32-x64' ? '.exe' : '';
  for (const required of [`difft${executableSuffix}`, `rg${executableSuffix}`, 'ripgrep.node']) {
    if (!existsSync(join(unpackedRoot, required))) fail(`extracted runtime tool is missing: ${required}`);
  }
  rmSync(join(toolsRoot, 'archives'), { recursive: true, force: true });

  verifyDependencyClosure(payload);

  const sourceHappy = JSON.parse(readFileSync(join(serverRoot, 'packages', 'happy-cli', 'package.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  packageJson.dependencies = { ...packageJson.dependencies, happy: sourceHappy.version };
  delete packageJson.devDependencies;
  delete packageJson.optionalDependencies;
  delete packageJson.scripts;
  delete packageJson.pnpm;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  for (const metadata of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'node_modules/.modules.yaml',
    'node_modules/.pnpm-workspace-state.json',
    'node_modules/.pnpm',
  ]) {
    rmSync(join(payload, metadata), { recursive: true, force: true });
  }

  scanHostPaths(payload, [resolve(payload), resolve(serverRoot), resolve(serverRoot, '..')]);
}

const options = argumentsMap(process.argv.slice(2));
const phase = options.get('phase') ?? fail('--phase is required');
const payload = resolve(options.get('payload') ?? fail('--payload is required'));
const serverRoot = resolve(options.get('server-root') ?? fail('--server-root is required'));
const target = options.get('target') ?? fail('--target is required');
if (!targets.has(target)) fail(`unsupported target: ${target}`);
if (phase === 'configure') configure(payload, serverRoot);
else if (phase === 'finalize') finalize(payload, serverRoot, target);
else fail(`unsupported phase: ${phase}`);

process.stdout.write(`${phase}: ${payload}\n`);
