/** Public launcher release manifest parsing and upgrade guidance. */

import { compareVersions } from './skills';
import { readBoundedJson } from './boundedResponse';

const RELEASE_TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'] as const;

export interface PublicReleaseAsset {
  target: string;
  filename: string;
  format: 'tar.gz' | 'zip';
  sha256: string;
  sizeBytes: number;
  sourceSha: string;
}

export interface PublicReleaseManifest {
  schemaVersion: 1;
  product: 'HappyHerd';
  version: string;
  sourceSha: string;
  publishedAt: string;
  assets: PublicReleaseAsset[];
  installers: Array<{
    shell: 'sh' | 'powershell';
    filename: string;
    sha256: string;
  }>;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

export function parsePublicReleaseManifest(value: unknown): PublicReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('release manifest must be an object');
  const manifest = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'product', 'version', 'sourceSha', 'publishedAt', 'assets', 'installers'];
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error('release manifest keys are invalid');
  }
  if (manifest.schemaVersion !== 1 || manifest.product !== 'HappyHerd') {
    throw new Error('release manifest identity is invalid');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error('release manifest version is invalid');
  }
  if (typeof manifest.sourceSha !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.sourceSha)) {
    throw new Error('release manifest sourceSha is invalid');
  }
  if (typeof manifest.publishedAt !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt))) {
    throw new Error('release manifest publishedAt is invalid');
  }
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.installers)) {
    throw new Error('release manifest assets and installers must be arrays');
  }
  const assets = manifest.assets.map((value, index): PublicReleaseAsset => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`release asset ${index} is invalid`);
    const asset = value as Record<string, unknown>;
    const assetKeys = ['target', 'filename', 'format', 'sha256', 'sizeBytes', 'sourceSha'];
    if (JSON.stringify(Object.keys(asset).sort()) !== JSON.stringify(assetKeys.sort())) {
      throw new Error(`release asset ${index} keys are invalid`);
    }
    if (
      typeof asset.target !== 'string'
      || typeof asset.filename !== 'string'
      || (asset.format !== 'tar.gz' && asset.format !== 'zip')
      || !Number.isInteger(asset.sizeBytes)
      || Number(asset.sizeBytes) < 1
      || typeof asset.sourceSha !== 'string'
      || asset.sourceSha !== manifest.sourceSha
    ) {
      throw new Error(`release asset ${index} contract is invalid`);
    }
    return {
      target: asset.target,
      filename: asset.filename,
      format: asset.format,
      sha256: digest(asset.sha256, `release asset ${index} sha256`),
      sizeBytes: Number(asset.sizeBytes),
      sourceSha: asset.sourceSha,
    };
  });
  const targets = [...assets.map((asset) => asset.target)].sort();
  if (JSON.stringify(targets) !== JSON.stringify([...RELEASE_TARGETS].sort())) {
    throw new Error('release manifest must contain exactly the five supported targets');
  }
  for (const asset of assets) {
    const format = asset.target === 'win32-x64' ? 'zip' : 'tar.gz';
    if (
      asset.format !== format
      || asset.filename !== `happyherd-v${manifest.version}-${asset.target}.${format}`
    ) {
      throw new Error(`release asset filename or format is invalid for ${asset.target}`);
    }
  }
  const installers = manifest.installers.map((value, index): PublicReleaseManifest['installers'][number] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`installer ${index} is invalid`);
    const installer = value as Record<string, unknown>;
    const installerKeys = ['shell', 'filename', 'sha256'];
    if (JSON.stringify(Object.keys(installer).sort()) !== JSON.stringify(installerKeys.sort())) {
      throw new Error(`installer ${index} keys are invalid`);
    }
    if (
      (installer.shell !== 'sh' && installer.shell !== 'powershell')
      || typeof installer.filename !== 'string'
    ) {
      throw new Error(`installer ${index} contract is invalid`);
    }
    return {
      shell: installer.shell,
      filename: installer.filename,
      sha256: digest(installer.sha256, `installer ${index} sha256`),
    };
  });
  const expectedInstallers = new Map([['sh', 'install.sh'], ['powershell', 'install.ps1']]);
  const installerShells = installers.map((installer) => installer.shell).sort();
  if (
    JSON.stringify(installerShells) !== JSON.stringify(['powershell', 'sh'])
    || installers.some((installer) => expectedInstallers.get(installer.shell) !== installer.filename)
  ) {
    throw new Error('release manifest must contain exactly the sh and PowerShell installers');
  }
  return {
    schemaVersion: 1,
    product: 'HappyHerd',
    version: manifest.version,
    sourceSha: manifest.sourceSha,
    publishedAt: manifest.publishedAt,
    assets,
    installers,
  };
}

export async function checkUpgrade(
  currentVersion: string,
  manifestUrl: string,
  target: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ current: boolean; manifest: PublicReleaseManifest; asset: PublicReleaseAsset; installerUrl: string }> {
  const url = new URL(manifestUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('release manifest URL must use HTTPS and contain no credentials, query, or fragment');
  }
  const response = await fetchImplementation(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`release manifest request failed with HTTP ${response.status}`);
  const manifest = parsePublicReleaseManifest(await readBoundedJson(response, 1024 * 1024, 'release manifest'));
  const asset = manifest.assets.find((candidate) => candidate.target === target);
  if (!asset) throw new Error(`release has no asset for ${target}`);
  const shell = process.platform === 'win32' ? 'powershell' : 'sh';
  const installer = manifest.installers.find((candidate) => candidate.shell === shell);
  if (!installer) throw new Error(`release has no ${shell} installer`);
  return {
    current: compareVersions(currentVersion, manifest.version) >= 0,
    manifest,
    asset,
    installerUrl: new URL(installer.filename, url).toString(),
  };
}
