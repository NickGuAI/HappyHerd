#!/usr/bin/env node

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runMacosKeychainDestroyPhase,
  verifyMacosKeychainPhase,
} from '../installers/service/common/happyherd-uninstall-phase.mjs';

const root = mkdtempSync(join(tmpdir(), 'happyherd-uninstall-recovery-'));
try {
  const ownerUid = 501;
  const serviceUid = 402;
  const serviceGid = 402;
  const installRoot = `/Library/Application Support/HappyHerd/${ownerUid}`;
  const stateRoot = `/Library/Application Support/HappyHerd/Broker/${ownerUid}`;
  const contract = {
    ownerUid,
    serviceUid,
    serviceGid,
    installRoot,
    stateRoot,
    keychainPath: `${stateRoot}/Library/Keychains/happyherd.keychain-db`,
    keychainHost: `/Library/PrivilegedHelperTools/dev.happyherd.keychain-broker-${ownerUid}`,
    releasePath: `${installRoot}/release.json`,
    receiptPath: `${installRoot}/uninstall-keychain-pending.json`,
  };
  const translated = new Map([
    [contract.installRoot, join(root, 'install')],
    [contract.keychainHost, join(root, 'keychain-helper')],
    [contract.releasePath, join(root, 'install', 'release.json')],
    [contract.receiptPath, join(root, 'install', 'uninstall-keychain-pending.json')],
  ]);
  mkdirSync(translated.get(contract.installRoot), { recursive: true, mode: 0o755 });
  writeFileSync(translated.get(contract.keychainHost), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(translated.get(contract.keychainHost), 0o755);
  writeFileSync(translated.get(contract.releasePath), `${JSON.stringify({
    schemaVersion: 1,
    product: 'HappyHerd',
    target: 'darwin-arm64',
    sourceSha: 'a'.repeat(40),
  })}\n`, { mode: 0o600 });
  const testContract = {
    ...contract,
    installRoot: translated.get(contract.installRoot),
    keychainHost: translated.get(contract.keychainHost),
    releasePath: translated.get(contract.releasePath),
    receiptPath: translated.get(contract.receiptPath),
  };
  const currentUid = process.getuid?.() ?? 0;
  let customKeychainExists = true;
  let systemMasterExists = true;
  let invocations = 0;
  const dependencies = {
    expectedAdminUid: currentUid,
    validateCanonicalPaths: false,
    invokeDestroy: () => {
      invocations += 1;
      if (customKeychainExists) customKeychainExists = false;
      if (invocations === 1) {
        return { ok: false, detail: 'injected System Keychain master deletion failure' };
      }
      systemMasterExists = false;
      return { ok: true };
    },
  };

  assert.throws(
    () => runMacosKeychainDestroyPhase(testContract, dependencies),
    /injected System Keychain master deletion failure/,
  );
  assert.equal(customKeychainExists, false, 'first attempt must fail after custom Keychain deletion');
  assert.equal(systemMasterExists, true, 'first attempt must preserve the System Keychain master');
  const keychainPendingReceipt = readFileSync(testContract.receiptPath, 'utf8');
  assert.equal(verifyMacosKeychainPhase(testContract, dependencies).receipt.phase, 'macos-keychain-destroy-pending');

  const recovered = runMacosKeychainDestroyPhase(testContract, dependencies);
  assert.equal(recovered.resumed, true, 'second attempt must take the protected resume path');
  assert.equal(systemMasterExists, false, 'second attempt must delete the remaining System Keychain master');
  assert.equal(recovered.receipt.phase, 'macos-final-cleanup-pending');
  const finalCleanupReceipt = readFileSync(testContract.receiptPath, 'utf8');
  assert.notEqual(finalCleanupReceipt, keychainPendingReceipt, 'successful destruction must atomically advance the receipt');
  assert.equal(invocations, 2);

  let cleanupAttempts = 0;
  const simulateFinalCleanup = () => {
    const verified = verifyMacosKeychainPhase(testContract, dependencies);
    assert.equal(verified.receipt.phase, 'macos-final-cleanup-pending');
    cleanupAttempts += 1;
    if (cleanupAttempts === 1) throw new Error('injected post-destroy profile cleanup failure');
  };
  assert.throws(simulateFinalCleanup, /injected post-destroy profile cleanup failure/);
  assert.equal(readFileSync(testContract.receiptPath, 'utf8'), finalCleanupReceipt, 'post-destroy failure must retain exact resume evidence');
  const finalResume = runMacosKeychainDestroyPhase(testContract, dependencies);
  assert.equal(finalResume.receipt.phase, 'macos-final-cleanup-pending');
  assert.equal(invocations, 2, 'final-cleanup resume must not call the already-completed Keychain helper');
  simulateFinalCleanup();
  assert.equal(cleanupAttempts, 2);

  const receipt = JSON.parse(finalCleanupReceipt);
  receipt.ownerUid += 1;
  writeFileSync(testContract.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  assert.throws(() => runMacosKeychainDestroyPhase(testContract, dependencies), /does not match/);
  assert.equal(invocations, 2, 'tampered resume evidence must fail before invoking the Keychain helper');
  unlinkSync(testContract.receiptPath);
  process.stdout.write('macOS uninstall recovery: ok\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
