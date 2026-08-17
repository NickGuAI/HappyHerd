import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  descriptorFromCredential,
  installSkillBundle,
  UNIVERSAL_SKILL_EXCLUSION_PATTERNS,
  type SkillBundleFile,
} from './skills';
import type { IssuerCredentialRecord } from './secretStore';

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

async function fixture(extraEntries: Array<{ path: string; bytes: Buffer }> = []): Promise<{
  zipBytes: Buffer;
  manifestBytes: Buffer;
  files: SkillBundleFile[];
}> {
  const skillBytes = Buffer.from('# Generic Guide\n');
  const scriptBytes = Buffer.from('export const ready = true;\n');
  const files: SkillBundleFile[] = [
    { path: 'generic-guide/SKILL.md', sizeBytes: skillBytes.length, mode: 0o644, sha256: sha256(skillBytes) },
    { path: 'generic-guide/scripts/check.mjs', sizeBytes: scriptBytes.length, mode: 0o644, sha256: sha256(scriptBytes) },
  ];
  const manifest = {
    schemaVersion: 1,
    product: {
      name: 'Example Product',
      baseUrl: 'https://issuer.example/api/v1',
      docsUrl: 'https://issuer.example/docs',
    },
    artifact: {
      id: 'example-skill-bundle',
      version: '2026.08.17',
      format: 'zip',
      minHappyHerdVersion: '1.2.1-beta.1',
      skills: ['generic-guide'],
      contentSha256: contentDigest(files),
    },
    source: { sha: 'a'.repeat(40) },
    permissions: { scopes: ['records.read'] },
    exclusions: { policy: 'example-allowlist', patterns: [...UNIVERSAL_SKILL_EXCLUSION_PATTERNS] },
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return {
    zipBytes: await zip([
      { path: 'manifest.json', bytes: manifestBytes },
      { path: files[0].path, bytes: skillBytes },
      { path: files[1].path, bytes: scriptBytes },
      ...extraEntries,
    ]),
    manifestBytes,
    files,
  };
}

describe('verified Skill bundle installation', () => {
  it('verifies sidecars, manifest inventory, content digest, and publishes atomically', async () => {
    const bundle = await fixture();
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-skills-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'bundle.zip');
    writeFileSync(source, bundle.zipBytes);
    const result = await installSkillBundle({
      source,
      expectedSha256: sha256(bundle.zipBytes),
      expectedManifestSha256: sha256(bundle.manifestBytes),
      currentHappyHerdVersion: '1.2.1-beta.1',
      root: join(directory, 'installed'),
      now: () => new Date('2026-08-17T00:00:00Z'),
    });
    expect(result.skills).toEqual(['generic-guide']);
    expect(readFileSync(join(result.path, 'generic-guide/SKILL.md'), 'utf8')).toBe('# Generic Guide\n');
    expect(lstatSync(join(result.path, 'generic-guide/SKILL.md')).mode & 0o777).toBe(0o644);
    expect(existsSync(join(result.path, '.happyherd-bundle.json'))).toBe(true);
    expect(existsSync(join(directory, 'installed', 'example-skill-bundle', 'current.json'))).toBe(false);
  });

  it('uses a bearer header for a same-origin issuer bundle and never mutates its URL', async () => {
    const bundle = await fixture();
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-skills-'));
    temporaryDirectories.push(directory);
    const observed: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImplementation = (async (input: URL | RequestInfo, init?: RequestInit) => {
      observed.push({ input: String(input), init });
      return new Response(new Uint8Array(bundle.zipBytes), {
        status: 200,
        headers: { 'content-type': 'application/zip', 'content-length': String(bundle.zipBytes.length) },
      });
    }) as typeof fetch;
    const credential: IssuerCredentialRecord = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: 'secret-access-token',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['records.read'],
      connectedAt: '2026-08-17T00:00:00Z',
      skillBundle: {
        url: 'https://issuer.example/api/bundles/current',
        sha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
      },
    };
    await installSkillBundle({
      source: 'https://issuer.example/api/bundles/current',
      expectedSha256: sha256(bundle.zipBytes),
      expectedManifestSha256: sha256(bundle.manifestBytes),
      currentHappyHerdVersion: '1.2.1-beta.1',
      root: join(directory, 'installed'),
      credential,
      fetch: fetchImplementation,
    });
    const request = observed[0];
    if (!request) throw new Error('expected the bundle request to be observed');
    expect(request.input).toBe('https://issuer.example/api/bundles/current');
    expect(request.init?.headers).toEqual({
      Accept: 'application/zip',
      Authorization: 'Bearer secret-access-token',
    });
    expect(request.init?.redirect).toBe('error');
  });

  it('rejects undeclared and case-confusable archive entries before publication', async () => {
    const bundle = await fixture([{ path: 'GENERIC-GUIDE/skill.md', bytes: Buffer.from('collision') }]);
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-skills-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'bundle.zip');
    writeFileSync(source, bundle.zipBytes);
    await expect(installSkillBundle({
      source,
      expectedSha256: sha256(bundle.zipBytes),
      expectedManifestSha256: sha256(bundle.manifestBytes),
      currentHappyHerdVersion: '1.2.1-beta.1',
      root: join(directory, 'installed'),
    })).rejects.toThrow('duplicate or confusable');
    expect(existsSync(join(directory, 'installed'))).toBe(false);
  });

  it('rejects non-ASCII archive names before filesystem normalization can vary', async () => {
    const bundle = await fixture([{ path: 'generic-guide/café.md', bytes: Buffer.from('look-alike') }]);
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-skills-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'bundle.zip');
    writeFileSync(source, bundle.zipBytes);
    await expect(installSkillBundle({
      source,
      expectedSha256: sha256(bundle.zipBytes),
      expectedManifestSha256: sha256(bundle.manifestBytes),
      currentHappyHerdVersion: '1.2.1-beta.1',
      root: join(directory, 'installed'),
    })).rejects.toThrow('safe relative POSIX path');
  });

  it.each(['generic-guide/./bad.md', 'generic-guide//bad.md', '.'])(
    'rejects dot or empty archive path segments: %s',
    async (path) => {
      const bundle = await fixture([{ path, bytes: Buffer.from('unsafe path') }]);
      const directory = mkdtempSync(join(tmpdir(), 'happyherd-skills-'));
      temporaryDirectories.push(directory);
      const source = join(directory, 'bundle.zip');
      writeFileSync(source, bundle.zipBytes);
      await expect(installSkillBundle({
        source,
        expectedSha256: sha256(bundle.zipBytes),
        expectedManifestSha256: sha256(bundle.manifestBytes),
        currentHappyHerdVersion: '1.2.1-beta.1',
        root: join(directory, 'installed'),
      })).rejects.toThrow('safe relative POSIX path');
    },
  );

  it('rejects a mismatched ZIP sidecar before reading the manifest', async () => {
    const bundle = await fixture();
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-skills-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'bundle.zip');
    writeFileSync(source, bundle.zipBytes);
    await expect(installSkillBundle({
      source,
      expectedSha256: '0'.repeat(64),
      expectedManifestSha256: sha256(bundle.manifestBytes),
      currentHappyHerdVersion: '1.2.1-beta.1',
      root: join(directory, 'installed'),
    })).rejects.toThrow('ZIP digest');
  });

  it('explains when an issuer is connected but Skill distribution is paused', () => {
    const withoutBundle: IssuerCredentialRecord = {
      schemaVersion: 1 as const,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer' as const,
      accessToken: 'connected-token-that-is-long-enough',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
    };
    expect(() => descriptorFromCredential(withoutBundle)).toThrow(
      'no active Skill bundle; reconnect after distribution resumes',
    );
  });
});
