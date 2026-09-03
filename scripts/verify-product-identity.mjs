#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appRoot = resolve(repoRoot, 'server/packages/happy-app');
const metadata = JSON.parse(readFileSync(resolve(appRoot, 'product-metadata.json'), 'utf8'));
const cliPackage = JSON.parse(readFileSync(resolve(appRoot, '../happy-cli/package.json'), 'utf8'));
const appConfig = readFileSync(resolve(appRoot, 'app.config.js'), 'utf8');
const settingsView = readFileSync(resolve(appRoot, 'sources/components/SettingsView.tsx'), 'utf8');

const expected = {
  displayName: 'HappyHerd',
};

for (const [key, value] of Object.entries(expected)) {
  if (metadata[key] !== value) {
    throw new Error(`product metadata ${key} must be ${value}`);
  }
}
if (!appConfig.includes("require('./product-metadata.json')") || !appConfig.includes('production: productMetadata.displayName')) {
  throw new Error('Expo/Web display name must be sourced from product-metadata.json');
}
if (typeof cliPackage.version !== 'string' || cliPackage.version.length === 0) {
  throw new Error('HappyHerd CLI package must declare a version');
}
if (!appConfig.includes("require('../happy-cli/package.json')") || !appConfig.includes('version: happyHerdCliPackage.version')) {
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
if (!settingsView.includes('{PRODUCT.repositoryUrl ? (') || !settingsView.includes('{PRODUCT.issueUrl ? (')) {
  throw new Error('About/support UI must hide repository actions when deployment metadata is absent');
}
for (const stale of ["detail=\"slopus/happy\"", "openExternalUrl('https://github.com/slopus/happy')", "openExternalUrl('https://github.com/slopus/happy/issues')"]) {
  if (settingsView.includes(stale)) {
    throw new Error(`stale upstream product support destination found: ${stale}`);
  }
}

console.log('product-identity: ok');
