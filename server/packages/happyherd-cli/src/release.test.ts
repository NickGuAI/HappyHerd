import { describe, expect, it } from 'vitest';
import { checkUpgrade, parsePublicReleaseManifest } from './release';

const manifest = {
  schemaVersion: 1,
  product: 'HappyHerd',
  version: '1.2.2',
  sourceSha: 'a'.repeat(40),
  publishedAt: '2026-08-17T00:00:00Z',
  assets: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'].map((target) => {
    const format = target === 'win32-x64' ? 'zip' : 'tar.gz';
    return {
      target,
      filename: `happyherd-v1.2.2-${target}.${format}`,
      format,
      sha256: 'b'.repeat(64),
      sizeBytes: 1024,
      sourceSha: 'a'.repeat(40),
    };
  }),
  installers: [
    { shell: 'sh', filename: 'install.sh', sha256: 'c'.repeat(64) },
    { shell: 'powershell', filename: 'install.ps1', sha256: 'd'.repeat(64) },
  ],
};

describe('public release upgrade contract', () => {
  it('parses immutable source and asset receipts', () => {
    expect(parsePublicReleaseManifest(manifest).sourceSha).toBe('a'.repeat(40));
    expect(() => parsePublicReleaseManifest({ ...manifest, sourceSha: 'short' })).toThrow('sourceSha');
    expect(() => parsePublicReleaseManifest({
      ...manifest,
      installers: [manifest.installers[0], manifest.installers[0]],
    })).toThrow('exactly the sh and PowerShell installers');
  });

  it('selects the current platform and resolves a verified installer', async () => {
    const result = await checkUpgrade(
      '1.2.1-beta.1',
      'https://downloads.example/releases/v1/release-manifest.json',
      'linux-x64',
      (async () => new Response(JSON.stringify(manifest), { status: 200 })) as typeof fetch,
    );
    expect(result.current).toBe(false);
    expect(result.asset.target).toBe('linux-x64');
    expect(result.installerUrl).toBe('https://downloads.example/releases/v1/install.sh');
  });
});
