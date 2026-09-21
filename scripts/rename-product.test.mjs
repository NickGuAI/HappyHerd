import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { planProductRename, applyProductRename } from './rename-product.mjs';

const root = resolve(import.meta.dirname, '..');
const scope = JSON.parse(readFileSync(join(root, 'scripts/product-rename-scope.json'), 'utf8'));

test('full repository: Happy → HappyHerd → Meadow, retaining CLI ownership, identity and opaque bytes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'product-rename-'));
  try {
    const archive = join(temp, 'baseline.tar');
    const renameIntroduction = execFileSync('git', ['log', '-1', '--diff-filter=A', '--format=%H', '--', 'scripts/rename-product.mjs'], { cwd: root, encoding: 'utf8' }).trim();
    execFileSync('git', ['archive', '--output', archive, `${renameIntroduction}^`], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', temp]);
    rmSync(archive);
    execFileSync('git', ['init', '-q'], { cwd: temp });
    // The archive contains tracked files even when ignore rules match their paths.
    execFileSync('git', ['add', '--force', '.'], { cwd: temp });
    const read = path => readFileSync(join(temp, path));
    const original = new Map([
      'LICENSE',
      'server/packages/happy-app/CHANGELOG.md',
      'server/packages/happy-app/sources/sync/__testdata__/trace_0.json',
      'server/packages/happy-app/sources/sync/__testdata__/trace_1.json',
      'server/packages/happy-app/sources/auth/tokenStorage.ts',
      'server/packages/happy-app/google-services.json',
      'server/packages/happy-agent/src/encryption.ts',
      'server/packages/happy-server/sources/modules/encrypt.ts',
      'server/packages/happy-server/sources/app/auth/auth.ts',
      'server/packages/happyherd-cli/src/legacyCompatibility.ts',
    ].map(path => [path, read(path)]));
    const first = planProductRename(temp, 'Happy', 'HappyHerd', scope);
    const destination = path => first.find(change => change.path === path)?.destination ?? path;
    const ignoredTracked = execFileSync('git', ['ls-files', '--cached', '--ignored', '--exclude-standard', 'server/packages/happy-app', 'server/packages/happy-server'], { cwd: temp, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assert(ignoredTracked.includes('server/packages/happy-app/CLAUDE.md'));
    assert(ignoredTracked.includes('server/packages/happy-server/.env.dev'));
    const binaryBytes = first.filter(change => change.before.includes(0));
    applyProductRename(temp, first);
    assert.match(read('server/packages/happyherd-app/sources/sync/apiSocket.ts').toString(), /\bhappyClient:/);
    assert.match(read('server/packages/happyherd-server/sources/app/api/socket.ts').toString(), /handshake\.auth\.happyClient\b/);
    assert.match(read('server/packages/happyherd-server/sources/app/api/socket.ts').toString(), /socket\.data\.happyherdClient\b/);
    assert.match(read('server/packages/codium/sources/happyherd/client.ts').toString(), /export const happyherdClient\b/);
    for (const [path, bytes] of original) assert.deepEqual(read(destination(path)), bytes, path);
    for (const change of binaryBytes) assert.deepEqual(read(change.destination), change.before, change.path);
    assert.equal(JSON.parse(read('server/packages/happyherd-cli/package.json')).name, '@happyherd/cli');
    assert.match(read('.github/workflows/quality-gates.yml').toString(), /--filter @happyherd\/cli/);
    assert.match(read('server/packages/happyherd-app/app.config.js').toString(), /\.\.\/happyherd-cli\/package\.json/);
    assert.equal(JSON.parse(read('server/packages/happyherd-wire/package.json')).name, '@happyherd/wire');
    assert(existsSync(join(temp, 'server/packages/happyherd-control-agent/src/control.ts')));
    assert(existsSync(join(temp, 'server/packages/happyherd-agent/src/index.ts')));
    assert.match(read('server/packages/happyherd-app/app.config.js').toString(), /com\.ex3ndr\.happy/);
    assert.match(read('server/packages/codium/sources/boot/main/app-storage.ts').toString(), /function happyherdHomeDir/);
    assert.match(read('server/packages/codium/sources/boot/main/app-storage.test.ts').toString(), /\/home\/alice\/happy'/);
    execFileSync('git', ['add', '-A'], { cwd: temp });
    const firstTracked = new Set(execFileSync('git', ['ls-files'], { cwd: temp, encoding: 'utf8' }).split('\n'));
    for (const path of ignoredTracked) {
      assert(firstTracked.has(destination(path)), path);
      assert(existsSync(join(temp, destination(path))), path);
    }
    assert.equal(planProductRename(temp, 'Happy', 'HappyHerd', scope).length, 0);
    const second = planProductRename(temp, 'HappyHerd', 'Meadow', scope);
    applyProductRename(temp, second);
    assert.match(read('server/packages/meadow-app/sources/sync/apiSocket.ts').toString(), /\bhappyClient:/);
    assert.match(read('server/packages/meadow-server/sources/app/api/socket.ts').toString(), /handshake\.auth\.happyClient\b/);
    assert.match(read('server/packages/meadow-server/sources/app/api/socket.ts').toString(), /socket\.data\.meadowClient\b/);
    assert.match(read('server/packages/codium/sources/meadow/client.ts').toString(), /export const meadowClient\b/);
    const nextDestination = path => second.find(change => change.path === destination(path))?.destination ?? destination(path);
    for (const [path, bytes] of original) assert.deepEqual(read(nextDestination(path)), bytes, path);
    for (const change of binaryBytes) {
      const path = second.find(next => next.path === change.destination)?.destination ?? change.destination;
      assert.deepEqual(read(path), change.before);
    }
    assert.equal(JSON.parse(read('server/packages/meadow-app/package.json')).name, 'meadow-app');
    assert.equal(JSON.parse(read('server/packages/meadow-wire/package.json')).name, '@meadow/wire');
    assert.equal(JSON.parse(read('server/packages/happyherd-cli/package.json')).name, '@happyherd/cli');
    assert.match(read('.github/workflows/quality-gates.yml').toString(), /--filter @happyherd\/cli/);
    assert.doesNotMatch(read('.github/workflows/quality-gates.yml').toString(), /@meadow\/cli/);
    assert.match(read('server/packages/meadow-app/app.config.js').toString(), /\.\.\/happyherd-cli\/package\.json/);
    assert.match(read('scripts/install-agent-runtime.sh').toString(), /bin\/happyherd\.mjs/);
    assert.match(JSON.parse(read('server/packages/meadow-app/sources/text/locales/en.json')).upstreamSync.cliOffline, /happyherd daemon start/);
    assert.match(read('server/packages/meadow-control-agent/src/config.ts').toString(), /process\.env\.HAPPYHERD_SERVER_URL/);
    assert.match(read('server/packages/meadow-control-agent/src/config.ts').toString(), /process\.env\.HAPPYHERD_HOME_DIR/);
    assert.match(read('server/packages/happyherd-cli/src/configuration.ts').toString(), /process\.env\.HAPPYHERD_SERVER_URL/);
    assert.match(read('server/packages/codium/sources/boot/main/app-storage.ts').toString(), /function meadowHomeDir/);
    assert.match(read('server/packages/codium/sources/boot/main/app-storage.test.ts').toString(), /meadowHomeDir\('linux'/);
    execFileSync('git', ['add', '-A'], { cwd: temp });
    const secondTracked = new Set(execFileSync('git', ['ls-files'], { cwd: temp, encoding: 'utf8' }).split('\n'));
    for (const path of ignoredTracked) {
      assert(secondTracked.has(nextDestination(path)), path);
      assert(existsSync(join(temp, nextDestination(path))), path);
      assert(!existsSync(join(temp, destination(path))), path);
    }
    assert.equal(planProductRename(temp, 'HappyHerd', 'Meadow', scope).length, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('both product passes retain current CLI consumers and persisted automation identities', () => {
  const temp = mkdtempSync(join(tmpdir(), 'product-cli-title-'));
  try {
    for (const path of [
      'server/packages/happyherd-app/sources/sync/reducer/messageToEvent.ts',
      'server/packages/happyherd-control-agent/src/config.ts',
      'server/packages/happyherd-cli/src/configuration.ts',
      'server/packages/happyherd-cli/src/legacyCompatibility.ts',
      'server/packages/happyherd-wire/src/automation.ts',
      'server/packages/happyherd-wire/src/automation.test.ts',
      'server/environments/environments.ts',
    ]) {
      mkdirSync(dirname(join(temp, path)), { recursive: true });
      writeFileSync(join(temp, path), readFileSync(join(root, path)));
    }
    execFileSync('git', ['init', '-q'], { cwd: temp });
    execFileSync('git', ['add', '.'], { cwd: temp });
    const read = path => readFileSync(join(temp, path), 'utf8');
    for (const [from, to] of [['Happy', 'HappyHerd'], ['HappyHerd', 'Meadow']]) {
      applyProductRename(temp, planProductRename(temp, from, to, scope));
      const product = to.toLowerCase();
      const consumer = read(`server/packages/${product}-app/sources/sync/reducer/messageToEvent.ts`);
      assert.match(consumer, /mcp__happyherd__change_title/);
      assert.doesNotMatch(consumer, /mcp__meadow__change_title/);
      const environment = read('server/environments/environments.ts');
      assert.match(environment, /name: "happyherd",/);
      assert.match(environment, /"happyherd-cli", "bin", "happyherd\.mjs"/);
      const cliConfig = read('server/packages/happyherd-cli/src/configuration.ts');
      for (const suffix of ['SERVER_URL', 'WEBAPP_URL', 'VARIANT']) {
        assert(environment.includes(`export HAPPYHERD_${suffix}=`), suffix);
        assert(cliConfig.includes(`process.env.HAPPYHERD_${suffix}`), suffix);
      }
      assert(environment.includes('export HAPPYHERD_HOME_DIR='));
      assert.match(read('server/packages/happyherd-cli/src/legacyCompatibility.ts'), /canonicalEnvironment\(env\)\.HAPPYHERD_HOME_DIR/);
      assert(environment.includes('export HAPPYHERD_PROJECT_DIR='));
      const controlConfig = read(`server/packages/${product}-control-agent/src/config.ts`);
      assert.match(controlConfig, /process\.env\.HAPPYHERD_SERVER_URL/);
      assert.match(controlConfig, /process\.env\.HAPPYHERD_HOME_DIR/);
      assert.match(read(`server/packages/${product}-wire/src/automation.ts`), /runtimeOwner: z\.literal\('happyherd'\)/);
      assert.match(read(`server/packages/${product}-wire/src/automation.test.ts`), /runtimeOwner: 'happyherd'/);
      execFileSync('git', ['add', '-A'], { cwd: temp });
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('destination collisions fail before any writes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'product-collision-'));
  try {
    for (const name of ['happy-app', 'happyherd-app']) {
      mkdirSync(join(temp, 'server/packages', name), { recursive: true });
      writeFileSync(join(temp, 'server/packages', name, 'source.ts'), 'original');
    }
    execFileSync('git', ['init', '-q'], { cwd: temp });
    execFileSync('git', ['add', '.'], { cwd: temp });
    assert.throws(() => planProductRename(temp, 'Happy', 'HappyHerd', scope), /collision/);
    assert.equal(readFileSync(join(temp, 'server/packages/happy-app/source.ts'), 'utf8'), 'original');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
