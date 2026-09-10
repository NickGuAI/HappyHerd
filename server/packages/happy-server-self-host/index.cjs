'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const require_ = createRequire(__filename);
const PRISMA_QUERY_ENGINE_FILES = {
  'arm64-darwin': 'libquery_engine-darwin-arm64.dylib.node',
  'x64-darwin': 'libquery_engine-darwin.dylib.node',
  'arm64-linux': 'libquery_engine-linux-arm64-openssl-3.0.x.so.node',
  'x64-linux': 'libquery_engine-debian-openssl-3.0.x.so.node',
};

function packageRoot() {
  return __dirname;
}

function getWebappDirectory() {
  return path.join(packageRoot(), 'webapp');
}

function findTsxCli() {
  return require_.resolve('tsx/cli', { paths: [packageRoot()] });
}

function preparedPrismaEngine() {
  const filename = PRISMA_QUERY_ENGINE_FILES[`${process.arch}-${process.platform}`];
  if (!filename) return undefined;
  let client;
  try {
    client = require_.resolve('.prisma/client/package.json');
  } catch {
    return undefined;
  }
  const engine = path.join(path.dirname(client), filename);
  return fs.existsSync(engine) ? engine : undefined;
}

function resolveServerArtifact() {
  const runtime = path.join(packageRoot(), 'dist', 'standalone.mjs');
  if (fs.existsSync(runtime)) {
    const webappDir = getWebappDirectory();
    return {
      command: process.execPath,
      prefixArgs: [runtime],
      cwd: packageRoot(),
      bundled: false,
      source: 'package',
      platform: `${process.arch}-${process.platform}`,
      // Prepared Linux releases carry a known OpenSSL 3 engine. Prisma's
      // distro-name lookup otherwise rejects that working engine on RHEL hosts.
      prismaQueryEngineLibrary: preparedPrismaEngine(),
      webappDir: fs.existsSync(path.join(webappDir, 'index.html')) ? webappDir : undefined,
    };
  }

  const standalone = path.join(packageRoot(), 'sources', 'standalone.ts');
  if (!fs.existsSync(standalone)) return undefined;

  const webappDir = getWebappDirectory();
  return {
    command: process.execPath,
    prefixArgs: [findTsxCli(), standalone],
    cwd: packageRoot(),
    bundled: false,
    source: 'package',
    platform: `${process.arch}-${process.platform}`,
    webappDir: fs.existsSync(path.join(webappDir, 'index.html')) ? webappDir : undefined,
  };
}

module.exports = {
  packageRoot,
  getWebappDirectory,
  resolveServerArtifact,
};
