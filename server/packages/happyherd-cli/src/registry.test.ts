import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  installSkillBundle,
  UNIVERSAL_SKILL_EXCLUSION_PATTERNS,
  type InstalledSkillBundle,
  type SkillBundleFile,
} from './skills';
import {
  removeVerifiedManagedSkillsForUninstall,
  registerInstalledSkillBundle,
  validateManagedSkillRegistry,
  type ProviderRoots,
} from './registry';
import type { IssuerCredentialRecord, SecretStore } from './secretStore';
import { resolvePythonRuntime, runManagedTool } from './toolRunner';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function contentDigest(files: SkillBundleFile[]): string {
  const records = [...files]
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
    .map((file) => ({ mode: file.mode, path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes }));
  return sha256(Buffer.from(JSON.stringify(records)));
}

function zip(entries: Array<{ path: string; bytes: Buffer }>): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const entry of entries) archive.addBuffer(entry.bytes, entry.path, { mode: 0o100644 });
  archive.end();
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once('error', reject);
    archive.outputStream.once('end', () => resolvePromise(Buffer.concat(chunks)));
  });
}

async function installedFixture(
  directory: string,
  options: { version?: string; skills?: string[]; issuerOrigin?: string; artifactId?: string } = {},
): Promise<InstalledSkillBundle> {
  const version = options.version ?? '2026.08.17';
  const skills = options.skills ?? ['generic-guide'];
  const issuerOrigin = options.issuerOrigin ?? 'https://issuer.example';
  const artifactId = options.artifactId ?? 'example-skill-bundle';
  const scriptBytes = Buffer.from('print("generic tool")\n');
  const skillPayloads = skills.map((skill) => ({
    skill,
    bytes: Buffer.from(skill === 'generic-guide' ? '# Generic Guide\n' : `# ${skill}\n`),
  }));
  const files: SkillBundleFile[] = skillPayloads.map(({ skill, bytes }) => ({
    path: `${skill}/SKILL.md`,
    sizeBytes: bytes.length,
    mode: 0o644,
    sha256: sha256(bytes),
  }));
  if (skills.includes('generic-guide')) {
    files.push({
      path: 'generic-guide/scripts/check.py',
      sizeBytes: scriptBytes.length,
      mode: 0o755,
      sha256: sha256(scriptBytes),
    });
  }
  const manifest = {
    schemaVersion: 1,
    product: {
      name: 'Example Product',
      baseUrl: `${issuerOrigin}/api`,
      docsUrl: `${issuerOrigin}/docs`,
    },
    artifact: {
      id: artifactId,
      version,
      format: 'zip',
      minHappyHerdVersion: '1.2.1-beta.1',
      skills,
      contentSha256: contentDigest(files),
    },
    source: { sha: 'a'.repeat(40) },
    permissions: { scopes: ['guide.read'] },
    exclusions: { policy: 'example-allowlist', patterns: [...UNIVERSAL_SKILL_EXCLUSION_PATTERNS] },
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const zipBytes = await zip([
    { path: 'manifest.json', bytes: manifestBytes },
    ...skillPayloads.map(({ skill, bytes }) => ({ path: `${skill}/SKILL.md`, bytes })),
    ...(skills.includes('generic-guide')
      ? [{ path: 'generic-guide/scripts/check.py', bytes: scriptBytes }]
      : []),
  ]);
  const source = join(directory, `bundle-${artifactId}-${version}.zip`);
  writeFileSync(source, zipBytes);
  return installSkillBundle({
    source,
    expectedSha256: sha256(zipBytes),
    expectedManifestSha256: sha256(manifestBytes),
    currentHappyHerdVersion: '1.2.1-beta.1',
    root: join(directory, 'bundles'),
    now: () => new Date('2026-08-17T00:00:00Z'),
  });
}

function testPaths(directory: string): { providerRoots: ProviderRoots; registryRoot: string } {
  return {
    providerRoots: {
      claude: join(directory, 'claude-skills'),
      codex: join(directory, 'codex-skills'),
    },
    registryRoot: join(directory, 'registry'),
  };
}

function fileText(directory: string): string {
  if (!existsSync(directory)) return '';
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? fileText(path) : readFileSync(path, 'utf8');
  }).join('\n');
}

function trustedPythonFixture(directory: string): string {
  const path = join(directory, 'trusted-python3');
  writeFileSync(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

describe('Claude and Codex Skill registry bridge', () => {
  it('publishes one verified generic Skill to both provider discovery roots', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    const report = registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    expect(report.registeredSkills).toBe(1);
    expect(readFileSync(join(paths.providerRoots.claude, 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
    expect(readFileSync(join(paths.providerRoots.codex, 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
    expect(validateManagedSkillRegistry(paths).registeredSkills).toBe(1);
    expect(registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' }).registeredSkills).toBe(1);
  });

  it('keeps the committed registry intact when backup cleanup fails partway', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    let cleanupCalls = 0;
    const report = registerInstalledSkillBundle(bundle, {
      ...paths,
      issuer: 'https://issuer.example',
      cleanupRemove: ((path: Parameters<typeof rmSync>[0], options?: Parameters<typeof rmSync>[1]) => {
        cleanupCalls += 1;
        if (cleanupCalls === 2) throw new Error('injected backup cleanup failure');
        rmSync(path, options as never);
      }) as typeof rmSync,
    });
    expect(cleanupCalls).toBeGreaterThanOrEqual(2);
    expect(report.registeredSkills).toBe(1);
    expect(validateManagedSkillRegistry(paths).registeredSkills).toBe(1);
    expect(readFileSync(join(paths.providerRoots.claude, 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
    expect(readFileSync(join(paths.providerRoots.codex, 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
  });

  it('retires Skills removed by a later version from both provider roots', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const paths = testPaths(directory);
    const first = await installedFixture(directory, {
      version: '2026.08.17',
      skills: ['generic-guide', 'retired-guide'],
    });
    registerInstalledSkillBundle(first, { ...paths, issuer: 'https://issuer.example' });
    const second = await installedFixture(directory, {
      version: '2026.08.18',
      skills: ['generic-guide'],
    });
    const report = registerInstalledSkillBundle(second, { ...paths, issuer: 'https://issuer.example' });
    expect(report.registeredSkills).toBe(1);
    expect(existsSync(join(paths.providerRoots.claude, 'retired-guide'))).toBe(false);
    expect(existsSync(join(paths.providerRoots.codex, 'retired-guide'))).toBe(false);
    expect(readFileSync(join(paths.providerRoots.claude, 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
    expect(validateManagedSkillRegistry(paths).registeredSkills).toBe(1);
  });

  it('restores every v1 provider copy when a v2 retirement fails during publication', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const paths = testPaths(directory);
    const first = await installedFixture(directory, {
      version: '2026.08.17',
      skills: ['generic-guide', 'retired-guide'],
    });
    registerInstalledSkillBundle(first, { ...paths, issuer: 'https://issuer.example' });
    const second = await installedFixture(directory, {
      version: '2026.08.18',
      skills: ['generic-guide'],
    });
    let renameCalls = 0;
    expect(() => registerInstalledSkillBundle(second, {
      ...paths,
      issuer: 'https://issuer.example',
      publicationRename: ((source: string, destination: string) => {
        renameCalls += 1;
        if (renameCalls === 6) throw new Error('injected provider retirement failure');
        renameSync(source, destination);
      }) as typeof renameSync,
    })).toThrow('injected provider retirement failure');
    expect(validateManagedSkillRegistry(paths).registeredSkills).toBe(2);
    for (const provider of ['claude', 'codex'] as const) {
      expect(readFileSync(join(paths.providerRoots[provider], 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
      expect(readFileSync(join(paths.providerRoots[provider], 'retired-guide', 'SKILL.md'), 'utf8')).toContain('retired-guide');
    }
  });

  it('never overwrites an existing provider Skill without a HappyHerd receipt', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    const collision = join(paths.providerRoots.claude, 'generic-guide');
    mkdirSync(collision, { recursive: true });
    writeFileSync(join(collision, 'user-owned.txt'), 'preserve\n');
    expect(() => registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' })).toThrow(
      'refusing to overwrite non-HappyHerd',
    );
    expect(readFileSync(join(collision, 'user-owned.txt'), 'utf8')).toBe('preserve\n');
    expect(existsSync(join(paths.providerRoots.codex, 'generic-guide'))).toBe(false);
  });

  it('preserves a user-modified managed Skill instead of overwriting it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    const modified = join(paths.providerRoots.claude, 'generic-guide', 'SKILL.md');
    writeFileSync(modified, 'user modification to preserve\n');
    expect(() => registerInstalledSkillBundle(bundle, {
      ...paths,
      issuer: 'https://issuer.example',
    })).toThrow('stale');
    expect(readFileSync(modified, 'utf8')).toBe('user modification to preserve\n');
  });

  it('rejects the same Skill name from a different issuer without replacing either copy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const paths = testPaths(directory);
    const first = await installedFixture(directory);
    registerInstalledSkillBundle(first, { ...paths, issuer: 'https://issuer.example' });
    const second = await installedFixture(directory, {
      artifactId: 'other-skill-bundle',
      issuerOrigin: 'https://other.example',
    });
    expect(() => registerInstalledSkillBundle(second, {
      ...paths,
      issuer: 'https://other.example',
    })).toThrow('already managed for a different issuer');
    expect(validateManagedSkillRegistry(paths).registeredSkills).toBe(1);
    expect(readFileSync(join(paths.providerRoots.claude, 'generic-guide', 'SKILL.md'), 'utf8')).toContain('Generic Guide');
  });

  it('preflights and removes only fully verified managed copies during uninstall', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    const unrelated = join(paths.providerRoots.claude, 'user-skill');
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, 'SKILL.md'), '# User Skill\n');
    const preflight = removeVerifiedManagedSkillsForUninstall(paths);
    expect(preflight).toMatchObject({ removed: [], preserved: [] });
    expect(preflight.verified).toHaveLength(2);
    expect(existsSync(join(paths.providerRoots.claude, 'generic-guide'))).toBe(true);
    const applied = removeVerifiedManagedSkillsForUninstall(paths, true);
    expect(applied.removed).toHaveLength(2);
    expect(applied.preserved).toEqual([]);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('reports modified managed copies for preservation without mutating any target', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    const modified = join(paths.providerRoots.codex, 'generic-guide', 'SKILL.md');
    writeFileSync(modified, 'modified\n');
    const preflight = removeVerifiedManagedSkillsForUninstall(paths);
    expect(preflight.removed).toEqual([]);
    expect(preflight.preserved).toHaveLength(1);
    expect(preflight.preserved[0]?.path).toBe(join(paths.providerRoots.codex, 'generic-guide'));
    expect(existsSync(join(paths.providerRoots.claude, 'generic-guide'))).toBe(true);
    expect(readFileSync(modified, 'utf8')).toBe('modified\n');
  });

  it('injects the issuer token only into the verified child tool process', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    const trustedPython = trustedPythonFixture(directory);
    registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    const accessToken = 'child-only-access-token-value';
    const credential: IssuerCredentialRecord = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken,
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
    };
    const secretStore: SecretStore = {
      set: () => undefined,
      get: () => credential,
      delete: () => false,
      deleteAll: () => 0,
      diagnostic: () => 'memory',
    };
    const observedCalls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const parentEnv = {
      PATH: '/usr/bin',
      HOME: join(directory, 'malicious-home'),
      HTTPS_PROXY: 'https://token-capture.invalid',
      ALL_PROXY: 'socks5://token-capture.invalid',
      SSL_CERT_FILE: join(directory, 'malicious-ca.pem'),
      SSL_CERT_DIR: join(directory, 'malicious-ca-dir'),
      PYTHONPATH: join(directory, 'malicious-python'),
      NODE_OPTIONS: '--require malicious-token-capture.js',
      UNRELATED_SECRET: 'must-not-pass',
      HAPPYHERD_ACCESS_TOKEN: 'stale-parent-value',
    };
    const status = await runManagedTool({
      issuer: credential.issuer,
      skill: 'generic-guide',
      script: 'scripts/check.py',
      args: ['--read'],
      secretStore,
      ...paths,
      parentEnv,
      platform: 'linux',
      launcher: {
        command: trustedPython,
        configPath: join(directory, 'tool-launcher.conf'),
        pythonRuntime: trustedPython,
        nodeRuntime: trustedPython,
      },
      spawn: ((command: string, args: readonly string[], options: Parameters<typeof spawn>[2]) => {
        observedCalls.push({ command, args, env: options.env ?? {} });
        return spawn(command, [...args], options);
      }) as typeof spawn,
    });
    expect(status).toBe(0);
    const observed = observedCalls[0];
    if (!observed) throw new Error('expected the verified child process to be observed');
    expect(observed.command).toBe(realpathSync(trustedPython));
    expect(isAbsolute(observed.command)).toBe(true);
    expect(observed.args).toEqual([
      '--config', join(directory, 'tool-launcher.conf'),
      '--runtime', 'python',
      '--script', join(bundle.path, 'generic-guide', 'scripts', 'check.py'),
      '--cwd', join(bundle.path, 'generic-guide'),
      '--', '--read',
    ]);
    expect(observed.args.join(' ')).not.toContain(accessToken);
    expect(observed.env.HAPPYHERD_ACCESS_TOKEN).toBe(accessToken);
    expect(observed.env.HAPPYHERD_ISSUER).toBe('https://issuer.example');
    expect(observed.env.HAPPYHERD_API_BASE_URL).toBe('https://issuer.example/api');
    expect(Object.keys(observed.env).sort()).toEqual([
      'HAPPYHERD_ACCESS_TOKEN',
      'HAPPYHERD_API_BASE_URL',
      'HAPPYHERD_ISSUER',
    ]);
    expect(parentEnv.HAPPYHERD_ACCESS_TOKEN).toBe('stale-parent-value');
    expect(fileText(paths.registryRoot)).not.toContain(accessToken);
    expect(fileText(paths.providerRoots.claude)).not.toContain(accessToken);
    expect(fileText(paths.providerRoots.codex)).not.toContain(accessToken);
  });

  it('rejects relative or writable Python interpreter candidates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-runtime-'));
    temporaryDirectories.push(directory);
    const writable = trustedPythonFixture(directory);
    chmodSync(writable, 0o777);
    expect(() => resolvePythonRuntime('linux', ['python3'])).toThrow('absolute path');
    expect(() => resolvePythonRuntime('linux', [writable])).toThrow('group- or world-writable');
  });

  it('detects a stale provider copy before launch or tool execution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-registry-'));
    temporaryDirectories.push(directory);
    const bundle = await installedFixture(directory);
    const paths = testPaths(directory);
    registerInstalledSkillBundle(bundle, { ...paths, issuer: 'https://issuer.example' });
    writeFileSync(join(paths.providerRoots.codex, 'generic-guide', 'SKILL.md'), 'tampered\n');
    expect(() => validateManagedSkillRegistry(paths)).toThrow('Codex'.toLowerCase());
  });

});
