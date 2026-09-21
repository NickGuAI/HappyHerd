#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appRoot = resolve(repoRoot, 'server/packages/happyherd-app');
const metadata = JSON.parse(readFileSync(resolve(appRoot, 'product-metadata.json'), 'utf8'));
const cliPackage = JSON.parse(readFileSync(resolve(appRoot, '../happyherd-cli/package.json'), 'utf8'));
const appConfig = readFileSync(resolve(appRoot, 'app.config.js'), 'utf8');
const productSource = readFileSync(resolve(appRoot, 'sources/constants/product.ts'), 'utf8');
const settingsView = readFileSync(resolve(appRoot, 'sources/components/SettingsView.tsx'), 'utf8');

if (metadata.displayName !== 'HappyHerd') {
  throw new Error('product metadata displayName must be HappyHerd');
}
if (!appConfig.includes("require('./product-metadata.json')") || !/\bproductMetadata\.displayName\b/.test(appConfig)) {
  throw new Error('Expo/Web display name must be sourced from product-metadata.json');
}
if (typeof cliPackage.version !== 'string' || cliPackage.version.length === 0) {
  throw new Error('HappyHerd CLI package must declare a version');
}
if (!appConfig.includes("require('../happyherd-cli/package.json')") || !/\bhappyHerdCliPackage\.version\b/.test(appConfig)) {
  throw new Error('Expo app version must be sourced from the HappyHerd CLI package');
}
for (const token of ['PRODUCT.displayName', 'PRODUCT.repositoryDisplay', 'PRODUCT.repositoryUrl', 'PRODUCT.issueUrl']) {
  if (!settingsView.includes(token)) {
    throw new Error(`About/support UI must use ${token}`);
  }
}
for (const key of ['repositoryDisplay', 'repositoryUrl', 'issueUrl']) {
  if (Object.hasOwn(metadata, key)) {
    throw new Error(`product metadata must not hard-code repository ownership: ${key}`);
  }
}
for (const envName of [
  'EXPO_PUBLIC_HAPPYHERD_REPOSITORY_DISPLAY',
  'EXPO_PUBLIC_HAPPYHERD_REPOSITORY_URL',
  'EXPO_PUBLIC_HAPPYHERD_ISSUE_URL',
]) {
  if (!productSource.includes(envName)) {
    throw new Error(`HappyHerd repository override env is missing: ${envName}`);
  }
}
if (!/\bPRODUCT\.repositoryUrl\s*\?/.test(settingsView) || !/\bPRODUCT\.issueUrl\s*\?/.test(settingsView)) {
  throw new Error('About/support UI must keep actions gated by their resolved destinations');
}
if (/slopus\/happyherd/.test(productSource) || /slopus\/happyherd/.test(settingsView)) {
  throw new Error('stale upstream product support destination found');
}

console.log('product-identity: ok');
