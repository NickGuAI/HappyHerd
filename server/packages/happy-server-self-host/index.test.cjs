'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve('/prepared/happy-server-self-host');
const client = path.join(root, 'node_modules/.prisma/client/package.json');
const source = readFileSync(path.join(__dirname, 'index.cjs'), 'utf8');

function resolver({ arch = 'x64', platform = 'linux', files = [], missingClient = false } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, __dirname: root, __filename: path.join(root, 'index.cjs'),
    process: { arch, platform, execPath: '/prepared/node/bin/node' },
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return { existsSync: file => files.includes(file) };
      assert.equal(name, 'node:module');
      return { createRequire: () => ({
        resolve(specifier) {
          if (specifier === 'tsx/cli') return '/development/tsx/cli.mjs';
          assert.equal(specifier, '.prisma/client/package.json');
          if (missingClient) throw new Error('MODULE_NOT_FOUND');
          return client;
        },
      }) };
    },
  });
  return module.exports.resolveServerArtifact;
}

for (const [arch, platform, filename] of [
  ['x64', 'linux', 'libquery_engine-debian-openssl-3.0.x.so.node'],
  ['arm64', 'linux', 'libquery_engine-linux-arm64-openssl-3.0.x.so.node'],
  ['x64', 'darwin', 'libquery_engine-darwin.dylib.node'],
  ['arm64', 'darwin', 'libquery_engine-darwin-arm64.dylib.node'],
]) {
  test(`prepared ${platform}-${arch} declares its shipped engine without changing Node mode`, () => {
    const runtime = path.join(root, 'dist/standalone.mjs');
    const engine = path.join(path.dirname(client), filename);
    const artifact = resolver({ arch, platform, files: [runtime, engine] })();
    assert.equal(artifact.command, '/prepared/node/bin/node');
    assert.equal(artifact.prefixArgs[0], runtime);
    assert.equal(artifact.bundled, false);
    assert.equal(artifact.prismaQueryEngineLibrary, engine);
  });
}

test('does not select a missing or wrong-platform engine', () => {
  const files = [path.join(root, 'dist/standalone.mjs'),
    path.join(path.dirname(client), 'libquery_engine-darwin.dylib.node')];
  assert.equal(resolver({ files })().prismaQueryEngineLibrary, undefined);
  assert.equal(resolver({ files, missingClient: true })().prismaQueryEngineLibrary, undefined);
});

test('locally generated RHEL package retains Prisma native discovery', () => {
  const artifact = resolver({ files: [path.join(root, 'dist/standalone.mjs'),
    path.join(path.dirname(client), 'libquery_engine-rhel-openssl-3.0.x.so.node')] })();
  assert.equal(artifact.prismaQueryEngineLibrary, undefined);
  assert.equal(artifact.bundled, false);
});

test('source mode retains normal Prisma engine discovery', () => {
  const artifact = resolver({ files: [path.join(root, 'sources/standalone.ts')] })();
  assert.equal(artifact.prismaQueryEngineLibrary, undefined);
  assert.equal(artifact.bundled, false);
  assert.equal(artifact.prefixArgs[0], '/development/tsx/cli.mjs');
});

for (const override of [undefined, '/operator/explicit-engine.node']) {
  test(`standalone command passes ${override ? 'explicit' : 'artifact-declared'} engine to server`, () => {
    let spawned;
    const artifact = {
      command: '/prepared/node/bin/node', prefixArgs: ['/prepared/standalone.mjs'],
      cwd: root, prismaQueryEngineLibrary: '/prepared/shipped-engine.node',
    };
    vm.runInNewContext(readFileSync(path.join(__dirname, 'bin/happy-server.cjs'), 'utf8'), {
      console,
      process: { argv: ['node', 'happy-server', 'serve'],
        env: override ? { PRISMA_QUERY_ENGINE_LIBRARY: override } : {} },
      require(name) {
        if (name === '../index.cjs') return { resolveServerArtifact: () => artifact };
        assert.equal(name, 'node:child_process');
        return { spawn(command, args, options) {
          spawned = { command, args, options };
          return { on() {} };
        } };
      },
    });
    assert.equal(spawned.options.env.PRISMA_QUERY_ENGINE_LIBRARY,
      override ?? artifact.prismaQueryEngineLibrary);
    assert.equal(spawned.args.at(-1), 'serve');
  });
}
