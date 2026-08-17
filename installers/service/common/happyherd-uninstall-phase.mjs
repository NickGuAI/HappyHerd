#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const KEYCHAIN_PHASE = 'macos-keychain-destroy-pending';
const FINAL_PHASE = 'macos-final-cleanup-pending';
const PHASES = new Set([KEYCHAIN_PHASE, FINAL_PHASE]);

function fail(message) {
  throw new Error(`HappyHerd uninstall phase: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(`${label} has unexpected keys`);
  }
}

function positiveId(value, label) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 0xffffffff) fail(`${label} is invalid`);
  return parsed;
}

function exactAbsolutePath(value, expected, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || value !== expected || value.includes('\0')) {
    fail(`${label} is invalid`);
  }
  return value;
}

function absolutePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) fail(`${label} is invalid`);
  return value;
}

function protectedEntry(path, expectedUid, type, executable = false) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink()
    || (type === 'file' ? !stat.isFile() : !stat.isDirectory())
    || stat.uid !== expectedUid
    || (stat.mode & 0o022) !== 0
    || (executable && (stat.mode & 0o111) === 0)
  ) fail(`${path} is not administrator protected`);
  return stat;
}

function releaseSource(contract, expectedAdminUid) {
  protectedEntry(contract.releasePath, expectedAdminUid, 'file');
  const bytes = readFileSync(contract.releasePath);
  if (bytes.length > 65536) fail('release receipt is too large');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('release receipt is invalid JSON'); }
  if (
    value?.schemaVersion !== 1
    || value.product !== 'HappyHerd'
    || typeof value.target !== 'string'
    || !value.target.startsWith('darwin-')
    || typeof value.sourceSha !== 'string'
    || !/^[0-9a-f]{40}$/.test(value.sourceSha)
  ) fail('release receipt identity is invalid');
  return value.sourceSha;
}

function normalizedContract(input, expectedAdminUid, validateCanonicalPaths = true, requireKeychainHost = true) {
  const ownerUid = positiveId(input.ownerUid, 'owner UID');
  const serviceUid = positiveId(input.serviceUid, 'service UID');
  const serviceGid = positiveId(input.serviceGid, 'service GID');
  if (ownerUid === serviceUid) fail('service identity overlaps the target owner');
  const installRoot = validateCanonicalPaths
    ? exactAbsolutePath(input.installRoot, `/Library/Application Support/HappyHerd/${ownerUid}`, 'install root')
    : absolutePath(input.installRoot, 'install root');
  const stateRoot = validateCanonicalPaths
    ? exactAbsolutePath(input.stateRoot, `/Library/Application Support/HappyHerd/Broker/${ownerUid}`, 'state root')
    : absolutePath(input.stateRoot, 'state root');
  const contract = {
    ownerUid,
    serviceUid,
    serviceGid,
    installRoot,
    stateRoot,
    keychainPath: exactAbsolutePath(
      input.keychainPath,
      `${stateRoot}/Library/Keychains/happyherd.keychain-db`,
      'Keychain path',
    ),
    keychainHost: validateCanonicalPaths
      ? exactAbsolutePath(
        input.keychainHost,
        `/Library/PrivilegedHelperTools/dev.happyherd.keychain-broker-${ownerUid}`,
        'Keychain broker host',
      )
      : absolutePath(input.keychainHost, 'Keychain broker host'),
    releasePath: exactAbsolutePath(input.releasePath, `${installRoot}/release.json`, 'release receipt path'),
    receiptPath: exactAbsolutePath(
      input.receiptPath,
      `${installRoot}/uninstall-keychain-pending.json`,
      'uninstall phase receipt path',
    ),
  };
  protectedEntry(contract.installRoot, expectedAdminUid, 'directory');
  if (requireKeychainHost) protectedEntry(contract.keychainHost, expectedAdminUid, 'file', true);
  return contract;
}

export function phaseReceipt(contract, sourceSha, phase = KEYCHAIN_PHASE) {
  if (!PHASES.has(phase)) fail('uninstall phase is invalid');
  return {
    schemaVersion: 1,
    product: 'HappyHerd',
    phase,
    ownerUid: contract.ownerUid,
    serviceUid: contract.serviceUid,
    serviceGid: contract.serviceGid,
    installRoot: contract.installRoot,
    stateRoot: contract.stateRoot,
    keychainPath: contract.keychainPath,
    keychainHost: contract.keychainHost,
    sourceSha,
  };
}

function readReceipt(contract, sourceSha, expectedAdminUid) {
  const stat = protectedEntry(contract.receiptPath, expectedAdminUid, 'file');
  if ((stat.mode & 0o777) !== 0o600) fail('uninstall phase receipt mode is invalid');
  const bytes = readFileSync(contract.receiptPath);
  if (bytes.length > 65536) fail('uninstall phase receipt is too large');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('uninstall phase receipt is invalid JSON'); }
  if (!PHASES.has(value?.phase)) fail('uninstall phase receipt phase is invalid');
  const expected = phaseReceipt(contract, sourceSha, value.phase);
  exactKeys(value, Object.keys(expected), 'uninstall phase receipt');
  if (JSON.stringify(value) !== JSON.stringify(expected)) fail('uninstall phase receipt does not match this installation');
  return value;
}

function publishReceipt(contract, expected, sourceSha, expectedAdminUid) {
  const text = `${JSON.stringify(expected, null, 2)}\n`;
  const temporary = `${contract.receiptPath}.pending-${process.pid}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeSync(descriptor, text, null, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    protectedEntry(temporary, expectedAdminUid, 'file');
    try {
      linkSync(temporary, contract.receiptPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    unlinkSync(temporary);
    const directory = openSync(dirname(contract.receiptPath), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* retain the original failure */ }
    throw error;
  }
  return readReceipt(contract, sourceSha, expectedAdminUid);
}

function transitionReceipt(contract, sourceSha, expectedAdminUid) {
  const previous = readReceipt(contract, sourceSha, expectedAdminUid);
  if (previous.phase !== KEYCHAIN_PHASE) fail('uninstall phase transition is invalid');
  const expected = phaseReceipt(contract, sourceSha, FINAL_PHASE);
  const temporary = `${contract.receiptPath}.transition-${process.pid}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeSync(descriptor, `${JSON.stringify(expected, null, 2)}\n`, null, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    protectedEntry(temporary, expectedAdminUid, 'file');
    renameSync(temporary, contract.receiptPath);
    const directory = openSync(dirname(contract.receiptPath), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* retain the original failure */ }
    throw error;
  }
  return readReceipt(contract, sourceSha, expectedAdminUid);
}

export function verifyMacosKeychainPhase(input, dependencies = {}) {
  const expectedAdminUid = dependencies.expectedAdminUid ?? 0;
  const contract = normalizedContract(input, expectedAdminUid, dependencies.validateCanonicalPaths !== false, false);
  const sourceSha = releaseSource(contract, expectedAdminUid);
  const receipt = readReceipt(contract, sourceSha, expectedAdminUid);
  if (receipt.phase === KEYCHAIN_PHASE) protectedEntry(contract.keychainHost, expectedAdminUid, 'file', true);
  return { contract, receipt };
}

export function runMacosKeychainDestroyPhase(input, dependencies = {}) {
  const expectedAdminUid = dependencies.expectedAdminUid ?? 0;
  const contract = normalizedContract(input, expectedAdminUid, dependencies.validateCanonicalPaths !== false, false);
  const sourceSha = releaseSource(contract, expectedAdminUid);
  const pending = phaseReceipt(contract, sourceSha);
  const resumed = existsSync(contract.receiptPath);
  let current;
  if (resumed) current = readReceipt(contract, sourceSha, expectedAdminUid);
  else {
    protectedEntry(contract.keychainHost, expectedAdminUid, 'file', true);
    current = publishReceipt(contract, pending, sourceSha, expectedAdminUid);
  }
  if (current.phase === FINAL_PHASE) return { resumed, receipt: current };
  protectedEntry(contract.keychainHost, expectedAdminUid, 'file', true);

  const invokeDestroy = dependencies.invokeDestroy ?? ((value) => {
    const result = spawnSync(value.keychainHost, [
      '--destroy',
      String(value.ownerUid),
      String(value.serviceUid),
      String(value.serviceGid),
      value.stateRoot,
      value.keychainPath,
    ], {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 65536,
    });
    return {
      ok: !result.error && result.status === 0,
      detail: result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`,
    };
  });
  const result = invokeDestroy(contract);
  if (!result?.ok) fail(`durable macOS service Keychain could not be destroyed (${result?.detail ?? 'unknown failure'})`);
  const receipt = transitionReceipt(contract, sourceSha, expectedAdminUid);
  return { resumed, receipt };
}

function contractFromArguments(values) {
  if (values.length !== 9) fail('invalid arguments');
  const [ownerUid, serviceUid, serviceGid, stateRoot, keychainPath, keychainHost, installRoot, releasePath, receiptPath] = values;
  return { ownerUid, serviceUid, serviceGid, stateRoot, keychainPath, keychainHost, installRoot, releasePath, receiptPath };
}

function main() {
  if (!process.getuid || !process.geteuid || process.getuid() !== 0 || process.geteuid() !== 0) {
    fail('the uninstall phase helper must run as root');
  }
  const [operation, ...values] = process.argv.slice(2);
  const contract = contractFromArguments(values);
  if (operation === '--verify') process.stdout.write(`${verifyMacosKeychainPhase(contract).receipt.phase}\n`);
  else if (operation === '--destroy') process.stdout.write(`${runMacosKeychainDestroyPhase(contract).receipt.phase}\n`);
  else fail('unsupported operation');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
