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
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const packageNames = new Set(['@happyherd/cli', 'happy-server-self-host']);
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function fail(message) {
  throw new Error(`native-installer-deployment: ${message}`);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) fail('arguments must be --name value pairs');
    values.set(name.slice(2), value);
  }
  return values;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function contained(root, candidate) {
  const child = relative(root, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function configure(payload, serverRoot, packageName) {
  const packagePath = join(payload, 'package.json');
  const lockPath = join(payload, 'pnpm-lock.yaml');
  if (!existsSync(packagePath) || !existsSync(lockPath)) {
    fail('configure requires the deployment package and generated lockfile');
  }

  const packageJson = readJson(packagePath);
  if (packageJson.name !== packageName) fail(`expected ${packageName}, found ${packageJson.name}`);
  const rootPackage = readJson(join(serverRoot, 'package.json'));
  const overrides = rootPackage.pnpm?.overrides;
  if (!overrides || Object.keys(overrides).length === 0) fail('workspace pnpm overrides are missing');

  packageJson.pnpm = { ...packageJson.pnpm, overrides };
  writeJson(packagePath, packageJson);

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

function workspaceVersions(serverRoot) {
  const packagePaths = [
    'packages/happy-wire/package.json',
    'packages/happy-agent/package.json',
    'packages/happy-server-self-host/package.json',
    'packages/happy-cli/package.json',
  ];
  return new Map(packagePaths.map((path) => {
    const packageJson = readJson(join(serverRoot, path));
    return [packageJson.name, packageJson.version];
  }));
}

function rewriteWorkspaceReferences(packagePath, versions) {
  if (!existsSync(packagePath)) return;
  const packageJson = readJson(packagePath);
  let changed = false;
  for (const field of dependencyFields) {
    const dependencies = packageJson[field];
    if (!dependencies) continue;
    for (const [name, value] of Object.entries(dependencies)) {
      const version = versions.get(name);
      if (!version || (typeof value === 'string' && !value.startsWith('workspace:') && !value.includes('file:'))) {
        continue;
      }
      dependencies[name] = version;
      changed = true;
    }
  }
  if (changed) writeJson(packagePath, packageJson);
}

function verifyPortableTree(payload) {
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!contained(payload, target)) fail(`symlink escapes deployment: ${relative(payload, path)}`);
      } else if (stat.isDirectory()) {
        visit(path);
      } else if (!stat.isFile()) {
        fail(`unsupported deployment entry: ${relative(payload, path)}`);
      }
    }
  };
  visit(payload);
}

function finalize(payload, serverRoot, packageName) {
  const packagePath = join(payload, 'package.json');
  const packageJson = readJson(packagePath);
  if (packageJson.name !== packageName) fail(`expected ${packageName}, found ${packageJson.name}`);
  if (!existsSync(join(payload, 'node_modules'))) fail('installed node_modules is missing');

  const versions = workspaceVersions(serverRoot);
  rewriteWorkspaceReferences(packagePath, versions);
  rewriteWorkspaceReferences(join(payload, 'node_modules', 'happy-agent', 'package.json'), versions);
  rewriteWorkspaceReferences(join(payload, 'node_modules', '@slopus', 'happy-wire', 'package.json'), versions);

  const finalizedPackage = readJson(packagePath);
  delete finalizedPackage.devDependencies;
  delete finalizedPackage.optionalDependencies;
  delete finalizedPackage.scripts;
  delete finalizedPackage.pnpm;
  writeJson(packagePath, finalizedPackage);

  for (const metadata of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'node_modules/.modules.yaml',
    'node_modules/.pnpm-workspace-state.json',
    'node_modules/.pnpm',
  ]) {
    rmSync(join(payload, metadata), { recursive: true, force: true });
  }

  verifyPortableTree(payload);
}

const options = parseArguments(process.argv.slice(2));
const phase = options.get('phase') ?? fail('--phase is required');
const payload = resolve(options.get('payload') ?? fail('--payload is required'));
const serverRoot = resolve(options.get('server-root') ?? fail('--server-root is required'));
const packageName = options.get('package-name') ?? fail('--package-name is required');
if (!packageNames.has(packageName)) fail(`unsupported package: ${packageName}`);

if (phase === 'configure') configure(payload, serverRoot, packageName);
else if (phase === 'finalize') finalize(payload, serverRoot, packageName);
else fail(`unsupported phase: ${phase}`);

process.stdout.write(`${phase}: ${packageName}\n`);
