/**
 * Verified Skill bundle download and atomic installation. The installer trusts
 * only the bundle's generic manifest: no organization or Skill name is built
 * into core code.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, posix, relative, resolve, sep } from 'node:path';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { normalizeIssuer, type SkillBundleDescriptor } from './contracts';
import type { IssuerCredentialRecord } from './secretStore';
import { readBoundedBytes } from './boundedResponse';

const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const BUNDLE_RECEIPT = '.happyherd-bundle.json';
const FORBIDDEN_SUFFIXES = new Set([
  '.a', '.class', '.dll', '.dylib', '.exe', '.lib', '.node', '.o', '.obj', '.pyd', '.so', '.wasm',
]);
export const UNIVERSAL_SKILL_EXCLUSION_PATTERNS = [
  '**/tests/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
  '**/*.py[cod]',
  '**/*.pyd',
  '**/*.so',
  '**/*.dylib',
  '**/*.dll',
  '**/*.exe',
  '**/*.node',
  '**/*.wasm',
  '**/*.{a,o,obj,lib,class}',
  '**/.env',
  '**/.env.*',
  '**/*.env',
  '**/*credential*',
  '**/*credential*/**',
  '**/*secret*',
  '**/*secret*/**',
  '**/*.log',
  '**/logs/**',
  'content scan: ELF, PE, Mach-O, WebAssembly, and Java bytecode magic',
] as const;
const FORBIDDEN_MAGICS = [
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from([0x4d, 0x5a]), // DOS/PE
  Buffer.from([0x00, 0x61, 0x73, 0x6d]), // WebAssembly
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // Mach-O fat / Java
  Buffer.from([0xbe, 0xba, 0xfe, 0xca]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbf]),
  Buffer.from([0xbf, 0xba, 0xfe, 0xca]),
];

export interface SkillBundleProduct {
  name: string;
  baseUrl: string;
  docsUrl: string;
}

export interface SkillBundleFile {
  path: string;
  sizeBytes: number;
  mode: number;
  sha256: string;
}

export interface SkillBundleManifest {
  schemaVersion: 1;
  product: SkillBundleProduct;
  artifact: {
    id: string;
    version: string;
    format: 'zip';
    minHappyHerdVersion: string;
    skills: string[];
    contentSha256: string;
  };
  source: Record<string, unknown> & { sha: string };
  permissions: Record<string, unknown>;
  exclusions: Record<string, unknown>;
  files: SkillBundleFile[];
}

export interface InstallSkillBundleOptions {
  source: string;
  expectedSha256: string;
  expectedManifestSha256: string;
  currentHappyHerdVersion: string;
  root?: string;
  credential?: IssuerCredentialRecord;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface InstalledSkillBundle {
  id: string;
  version: string;
  skills: string[];
  path: string;
  sha256: string;
  manifestSha256: string;
  manifest: SkillBundleManifest;
}

interface ArchiveFile {
  path: string;
  bytes: Buffer;
  directory: boolean;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} keys must be exactly: ${[...keys].sort().join(', ')}`);
  }
}

function stringValue(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value: unknown, label: string): string {
  const normalized = stringValue(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function safeArchivePath(value: string, label: string): string {
  const segments = value.split('/');
  const pathSegments = value.endsWith('/') ? segments.slice(0, -1) : segments;
  if (
    !value
    || value.includes('\\')
    || value.includes('\0')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || posix.normalize(value) !== value
    || pathSegments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || value.normalize('NFC') !== value
    // Protocol v1 keeps archive names ASCII. This closes the full class of
    // Unicode look-alike and normalization collisions across filesystems.
    || !/^[A-Za-z0-9._+@/-]+$/.test(value)
  ) {
    throw new Error(`${label} is not a safe relative POSIX path`);
  }
  return value;
}

function collisionKey(value: string): string {
  return value.replace(/\/$/, '').normalize('NFKC').toLocaleLowerCase('en-US');
}

function validateExclusions(value: Record<string, unknown>): Record<string, unknown> {
  exactKeys(value, ['policy', 'patterns'], 'manifest.exclusions');
  stringValue(value.policy, 'manifest.exclusions.policy', /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/);
  if (!Array.isArray(value.patterns) || value.patterns.length > 256) {
    throw new Error('manifest.exclusions.patterns must be a bounded ordered array');
  }
  const patterns = value.patterns.map((pattern, index) => stringValue(
    pattern,
    `manifest.exclusions.patterns[${index}]`,
  ));
  if (new Set(patterns).size !== patterns.length) throw new Error('manifest.exclusions.patterns contains duplicates');
  for (const required of UNIVERSAL_SKILL_EXCLUSION_PATTERNS) {
    if (!patterns.includes(required)) throw new Error(`manifest.exclusions.patterns is missing: ${required}`);
  }
  return { policy: value.policy, patterns };
}

function validateSkillPayload(path: string, bytes: Buffer): void {
  const lower = path.toLowerCase();
  const suffix = [...FORBIDDEN_SUFFIXES].find((candidate) => lower.endsWith(candidate));
  if (suffix) throw new Error(`Skill bundle contains a forbidden binary suffix: ${path}`);
  if (FORBIDDEN_MAGICS.some((magic) => bytes.subarray(0, magic.length).equals(magic))) {
    throw new Error(`Skill bundle contains forbidden executable bytecode: ${path}`);
  }
  const text = bytes.toString('utf8');
  if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(text)) {
    throw new Error(`Skill bundle contains private key material: ${path}`);
  }
  if (/(?:^|\n)\s*[A-Z0-9_]*(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|BOT_?TOKEN|CLIENT_?SECRET|PRIVATE_?KEY)\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(text)) {
    throw new Error(`Skill bundle contains a provider credential assignment: ${path}`);
  }
}

function fileMode(value: unknown, label: string): number {
  const mode = typeof value === 'string' && /^[0-7]{3,4}$/.test(value)
    ? Number.parseInt(value, 8)
    : value;
  if (!Number.isInteger(mode) || Number(mode) < 0 || Number(mode) > 0o777) {
    throw new Error(`${label} must be an octal string or integer permission mode`);
  }
  if ((Number(mode) & 0o022) !== 0) throw new Error(`${label} must not be group- or world-writable`);
  return Number(mode);
}

function httpsUrl(value: unknown, label: string): string {
  const url = new URL(stringValue(value, label));
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} must be an HTTPS URL without credentials or fragment`);
  }
  return url.toString();
}

export function parseSkillBundleManifest(value: unknown): SkillBundleManifest {
  const manifest = objectValue(value, 'manifest');
  exactKeys(
    manifest,
    ['schemaVersion', 'product', 'artifact', 'source', 'permissions', 'exclusions', 'files'],
    'manifest',
  );
  if (manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion must equal 1');
  const product = objectValue(manifest.product, 'manifest.product');
  exactKeys(product, ['name', 'baseUrl', 'docsUrl'], 'manifest.product');
  const artifact = objectValue(manifest.artifact, 'manifest.artifact');
  exactKeys(
    artifact,
    ['id', 'version', 'format', 'minHappyHerdVersion', 'skills', 'contentSha256'],
    'manifest.artifact',
  );
  if (artifact.format !== 'zip') throw new Error('manifest.artifact.format must equal zip');
  if (!Array.isArray(artifact.skills) || artifact.skills.length === 0) {
    throw new Error('manifest.artifact.skills must be a non-empty ordered array');
  }
  const skills = artifact.skills.map((skill, index) => stringValue(
    skill,
    `manifest.artifact.skills[${index}]`,
    /^[a-z0-9][a-z0-9._-]{0,127}$/,
  ));
  if (new Set(skills).size !== skills.length) throw new Error('manifest.artifact.skills contains duplicates');
  const source = objectValue(manifest.source, 'manifest.source');
  stringValue(source.sha, 'manifest.source.sha', /^[0-9a-f]{40}$/);
  const permissions = objectValue(manifest.permissions, 'manifest.permissions');
  const exclusions = validateExclusions(objectValue(manifest.exclusions, 'manifest.exclusions'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('manifest.files must be a non-empty array');
  }
  const seen = new Set<string>();
  const files = manifest.files.map((entry, index): SkillBundleFile => {
    const file = objectValue(entry, `manifest.files[${index}]`);
    exactKeys(file, ['path', 'sizeBytes', 'mode', 'sha256'], `manifest.files[${index}]`);
    const path = safeArchivePath(stringValue(file.path, `manifest.files[${index}].path`), `manifest.files[${index}].path`);
    if (path === 'manifest.json' || !skills.some((skill) => path.startsWith(`${skill}/`))) {
      throw new Error(`manifest file is outside the declared Skill allowlist: ${path}`);
    }
    const key = collisionKey(path);
    if (seen.has(key)) throw new Error(`manifest contains a duplicate or confusable file path: ${path}`);
    seen.add(key);
    if (!Number.isInteger(file.sizeBytes) || Number(file.sizeBytes) < 0 || Number(file.sizeBytes) > MAX_FILE_BYTES) {
      throw new Error(`manifest file size is invalid: ${path}`);
    }
    return {
      path,
      sizeBytes: Number(file.sizeBytes),
      mode: fileMode(file.mode, `manifest.files[${index}].mode`),
      sha256: digest(file.sha256, `manifest.files[${index}].sha256`),
    };
  });
  for (const skill of skills) {
    if (!seen.has(collisionKey(`${skill}/SKILL.md`))) throw new Error(`declared Skill is missing SKILL.md: ${skill}`);
  }
  return {
    schemaVersion: 1,
    product: {
      name: stringValue(product.name, 'manifest.product.name'),
      baseUrl: httpsUrl(product.baseUrl, 'manifest.product.baseUrl'),
      docsUrl: httpsUrl(product.docsUrl, 'manifest.product.docsUrl'),
    },
    artifact: {
      id: stringValue(artifact.id, 'manifest.artifact.id', /^[a-z0-9][a-z0-9._-]{0,127}$/),
      version: stringValue(artifact.version, 'manifest.artifact.version', /^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/),
      format: 'zip',
      minHappyHerdVersion: stringValue(
        artifact.minHappyHerdVersion,
        'manifest.artifact.minHappyHerdVersion',
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      ),
      skills,
      contentSha256: digest(artifact.contentSha256, 'manifest.artifact.contentSha256'),
    },
    source: source as Record<string, unknown> & { sha: string },
    permissions,
    exclusions,
    files,
  };
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('ZIP could not be opened'));
      else resolvePromise(zip);
    });
  });
}

function entryBytes(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`ZIP entry could not be read: ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_FILE_BYTES) stream.destroy(new Error(`ZIP entry is too large: ${entry.fileName}`));
        else chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolvePromise(Buffer.concat(chunks)));
    });
  });
}

async function archiveFiles(bytes: Buffer): Promise<ArchiveFile[]> {
  const zip = await openZip(bytes);
  return new Promise((resolvePromise, reject) => {
    const files: ArchiveFile[] = [];
    const paths = new Set<string>();
    let total = 0;
    zip.once('error', reject);
    zip.once('end', () => resolvePromise(files));
    zip.on('entry', async (entry: Entry) => {
      try {
        const path = safeArchivePath(entry.fileName, 'ZIP entry path');
        const key = collisionKey(path);
        if (paths.has(key)) throw new Error(`ZIP contains a duplicate or confusable path: ${path}`);
        paths.add(key);
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) throw new Error(`ZIP symlinks are not allowed: ${path}`);
        if (path.endsWith('/')) {
          files.push({ path, bytes: Buffer.alloc(0), directory: true });
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_FILE_BYTES) throw new Error(`ZIP entry is too large: ${path}`);
        const content = await entryBytes(zip, entry);
        total += content.length;
        if (total > MAX_BUNDLE_BYTES) throw new Error('ZIP uncompressed content exceeds the bundle limit');
        files.push({ path, bytes: content, directory: false });
        zip.readEntry();
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.readEntry();
  });
}

function semverParts(version: string): [number, number, number, string[]] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`invalid semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.split('.') ?? []];
}

export function compareVersions(left: string, right: string): number {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Number(a[index]) < Number(b[index]) ? -1 : 1;
  }
  if (a[3].length === 0 || b[3].length === 0) return a[3].length === b[3].length ? 0 : a[3].length === 0 ? 1 : -1;
  const length = Math.max(a[3].length, b[3].length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[3][index];
    const rightPart = b[3][index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1;
    if (leftNumber !== null || rightNumber !== null) return leftNumber !== null ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function aggregateContentDigest(files: SkillBundleFile[]): string {
  const canonicalRecords = [...files]
    .sort((left, right) => Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')))
    // Keys are deliberately inserted in Unicode sort order. This matches
    // recursive sort_keys JSON with UTF-8 output and no whitespace.
    .map((file) => ({
      mode: file.mode,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    }));
  return sha256(Buffer.from(JSON.stringify(canonicalRecords), 'utf8'));
}

async function bundleBytes(options: InstallSkillBundleOptions): Promise<Buffer> {
  if (!/^https?:\/\//.test(options.source)) {
    const bytes = readFileSync(resolve(options.source));
    if (bytes.length > MAX_BUNDLE_BYTES) throw new Error('Skill bundle exceeds the download limit');
    return bytes;
  }
  const source = new URL(options.source);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname);
  if (
    (source.protocol !== 'https:' && !(source.protocol === 'http:' && loopback))
    || source.username
    || source.password
    || source.search
    || source.hash
  ) {
    throw new Error('remote Skill bundle URL must use HTTPS and contain no credentials, query, or fragment');
  }
  const headers: Record<string, string> = { Accept: 'application/zip' };
  if (options.credential) {
    if (source.origin !== normalizeIssuer(options.credential.issuer)) {
      throw new Error('refusing to send an issuer credential to a different origin');
    }
    headers.Authorization = `Bearer ${options.credential.accessToken}`;
  }
  const response = await (options.fetch ?? fetch)(source, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Skill bundle download failed with HTTP ${response.status}`);
  return readBoundedBytes(response, MAX_BUNDLE_BYTES, 'Skill bundle');
}

function noSymlinkComponents(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`installation path contains a symlink: ${current}`);
    }
  }
}

function installedPaths(root: string, directory = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`installed bundle contains a symlink: ${absolute}`);
    if (entry.isDirectory()) paths.push(...installedPaths(root, absolute));
    else if (entry.isFile()) paths.push(relative(root, absolute).split(sep).join('/'));
    else throw new Error(`installed bundle contains an unsupported filesystem entry: ${absolute}`);
  }
  return paths;
}

function existingBundleMatches(destination: string, files: SkillBundleFile[], manifestBytes: Buffer): boolean {
  if (!existsSync(destination)) return false;
  try {
    const verified = verifyInstalledBundleDirectory(destination, {
      manifestSha256: sha256(manifestBytes),
    });
    return JSON.stringify(verified.manifest.files) === JSON.stringify(files);
  } catch {
    return false;
  }
}

function modeMatches(actual: number, expected: number): boolean {
  return process.platform === 'win32' || (actual & 0o777) === expected;
}

export interface InstalledBundleExpectation {
  id?: string;
  version?: string;
  manifestSha256?: string;
  sourceSha?: string;
  zipSha256?: string;
}

export interface VerifiedInstalledBundle {
  manifest: SkillBundleManifest;
  manifestSha256: string;
}

export function verifyInstalledBundleDirectory(
  destinationInput: string,
  expected: InstalledBundleExpectation = {},
): VerifiedInstalledBundle {
  const destination = resolve(destinationInput);
  if (!existsSync(destination) || lstatSync(destination).isSymbolicLink() || !lstatSync(destination).isDirectory()) {
    throw new Error('installed Skill bundle directory is missing or unsafe');
  }
  noSymlinkComponents(destination);
  const manifestPath = join(destination, 'manifest.json');
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
    throw new Error('installed Skill bundle manifest is missing');
  }
  const manifestStat = lstatSync(manifestPath);
  if (!modeMatches(manifestStat.mode, 0o600)) throw new Error('installed Skill bundle manifest mode is invalid');
  const manifestBytes = readFileSync(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  if (expected.manifestSha256 && manifestSha256 !== expected.manifestSha256) {
    throw new Error('installed Skill bundle manifest digest is stale');
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('installed Skill bundle manifest is invalid JSON');
  }
  const manifest = parseSkillBundleManifest(manifestValue);
  if (
    (expected.id && manifest.artifact.id !== expected.id)
    || (expected.version && manifest.artifact.version !== expected.version)
    || (expected.sourceSha && manifest.source.sha !== expected.sourceSha)
  ) {
    throw new Error('installed Skill bundle identity or source is stale');
  }
  const receiptPath = join(destination, BUNDLE_RECEIPT);
  if (!existsSync(receiptPath) || lstatSync(receiptPath).isSymbolicLink() || !lstatSync(receiptPath).isFile()) {
    throw new Error('installed Skill bundle immutable receipt is missing');
  }
  if (!modeMatches(lstatSync(receiptPath).mode, 0o600)) throw new Error('installed Skill bundle receipt mode is invalid');
  let receipt: Record<string, unknown>;
  try { receipt = objectValue(JSON.parse(readFileSync(receiptPath, 'utf8')), 'installed bundle receipt'); }
  catch { throw new Error('installed Skill bundle receipt is invalid JSON'); }
  exactKeys(receipt, ['schemaVersion', 'id', 'version', 'path', 'skills', 'sha256', 'manifestSha256', 'sourceSha', 'installedAt'], 'installed bundle receipt');
  if (
    receipt.schemaVersion !== 1
    || receipt.id !== manifest.artifact.id
    || receipt.version !== manifest.artifact.version
    || receipt.path !== destination
    || JSON.stringify(receipt.skills) !== JSON.stringify(manifest.artifact.skills)
    || receipt.manifestSha256 !== manifestSha256
    || receipt.sourceSha !== manifest.source.sha
    || typeof receipt.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(receipt.sha256)
    || (expected.zipSha256 && receipt.sha256 !== expected.zipSha256)
    || typeof receipt.installedAt !== 'string'
    || !Number.isFinite(Date.parse(receipt.installedAt))
  ) throw new Error('installed Skill bundle immutable receipt is stale');
  const actualPaths = installedPaths(destination).sort();
  const expectedPaths = [...manifest.files.map((file) => file.path), 'manifest.json', BUNDLE_RECEIPT].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('installed Skill bundle file inventory is stale');
  }
  for (const file of manifest.files) {
    const path = join(destination, ...file.path.split('/'));
    const stat = lstatSync(path);
    const bytes = stat.isFile() ? readFileSync(path) : Buffer.alloc(0);
    if (
      !stat.isFile()
      || !modeMatches(stat.mode, file.mode)
      || stat.size !== file.sizeBytes
      || sha256(bytes) !== file.sha256
    ) {
      throw new Error(`installed Skill bundle file is stale: ${file.path}`);
    }
    validateSkillPayload(file.path, bytes);
  }
  if (aggregateContentDigest(manifest.files) !== manifest.artifact.contentSha256) {
    throw new Error('installed Skill bundle canonical content digest is stale');
  }
  return { manifest, manifestSha256 };
}

export async function installSkillBundle(options: InstallSkillBundleOptions): Promise<InstalledSkillBundle> {
  const expectedSha256 = digest(options.expectedSha256, 'expected ZIP digest');
  const expectedManifestSha256 = digest(options.expectedManifestSha256, 'expected manifest digest');
  const zipBytes = await bundleBytes(options);
  if (sha256(zipBytes) !== expectedSha256) throw new Error('Skill bundle ZIP digest does not match the trusted sidecar');
  const archive = await archiveFiles(zipBytes);
  const manifestFile = archive.find((file) => file.path === 'manifest.json' && !file.directory);
  if (!manifestFile) throw new Error('Skill bundle root manifest.json is missing');
  if (sha256(manifestFile.bytes) !== expectedManifestSha256) {
    throw new Error('Skill bundle manifest digest does not match the trusted sidecar');
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestFile.bytes.toString('utf8'));
  } catch {
    throw new Error('Skill bundle manifest.json is not valid JSON');
  }
  const manifest = parseSkillBundleManifest(manifestJson);
  if (compareVersions(options.currentHappyHerdVersion, manifest.artifact.minHappyHerdVersion) < 0) {
    throw new Error(`HappyHerd ${manifest.artifact.minHappyHerdVersion} or newer is required`);
  }
  const declared = new Map(manifest.files.map((file) => [file.path, file]));
  const directories = archive.filter((file) => file.directory);
  for (const directory of directories) {
    if (!manifest.artifact.skills.some((skill) => directory.path === `${skill}/` || directory.path.startsWith(`${skill}/`))) {
      throw new Error(`ZIP contains a directory outside the declared Skill allowlist: ${directory.path}`);
    }
  }
  const payload = archive.filter((file) => !file.directory && file.path !== 'manifest.json');
  if (payload.length !== declared.size) throw new Error('ZIP entries do not match manifest.files');
  for (const file of payload) {
    const declaration = declared.get(file.path);
    if (!declaration) throw new Error(`ZIP contains an undeclared file: ${file.path}`);
    if (file.bytes.length !== declaration.sizeBytes || sha256(file.bytes) !== declaration.sha256) {
      throw new Error(`ZIP file failed size or digest validation: ${file.path}`);
    }
    validateSkillPayload(file.path, file.bytes);
  }
  if (aggregateContentDigest(manifest.files) !== manifest.artifact.contentSha256) {
    throw new Error('manifest.artifact.contentSha256 does not match the canonical file inventory');
  }

  const root = resolve(options.root ?? join(homedir(), '.happyherd', 'skill-bundles'));
  mkdirSync(root, { recursive: true, mode: 0o750 });
  chmodSync(root, 0o750);
  noSymlinkComponents(root);
  const artifactRoot = join(root, manifest.artifact.id);
  mkdirSync(artifactRoot, { recursive: true, mode: 0o750 });
  chmodSync(artifactRoot, 0o750);
  noSymlinkComponents(artifactRoot);
  const destination = join(artifactRoot, manifest.artifact.version);
  const receipt = {
    schemaVersion: 1,
    id: manifest.artifact.id,
    version: manifest.artifact.version,
    path: destination,
    skills: manifest.artifact.skills,
    sha256: expectedSha256,
    manifestSha256: expectedManifestSha256,
    sourceSha: manifest.source.sha,
    installedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  if (existsSync(destination)) {
    try {
      const existing = verifyInstalledBundleDirectory(destination, {
        id: manifest.artifact.id,
        version: manifest.artifact.version,
        manifestSha256: expectedManifestSha256,
        sourceSha: manifest.source.sha,
        zipSha256: expectedSha256,
      });
      if (JSON.stringify(existing.manifest.files) !== JSON.stringify(manifest.files)) throw new Error('file declaration mismatch');
    } catch {
      throw new Error('installed bundle version exists but does not match the verified manifest');
    }
  } else {
    const stage = join(artifactRoot, `.staging-${process.pid}-${randomBytes(8).toString('hex')}`);
    mkdirSync(stage, { mode: 0o750 });
    chmodSync(stage, 0o750);
    try {
      for (const file of payload) {
        const declaration = declared.get(file.path);
        if (!declaration) throw new Error(`missing declaration for ${file.path}`);
        const output = join(stage, ...file.path.split('/'));
        const relative = output.slice(stage.length + 1);
        if (relative.startsWith('..') || output === stage) throw new Error(`unsafe installation path: ${file.path}`);
        mkdirSync(dirname(output), { recursive: true, mode: 0o750 });
        chmodSync(dirname(output), 0o750);
        writeFileSync(output, file.bytes, { mode: declaration.mode, flag: 'wx' });
        chmodSync(output, declaration.mode);
      }
      writeFileSync(join(stage, 'manifest.json'), manifestFile.bytes, { mode: 0o600, flag: 'wx' });
      writeFileSync(join(stage, BUNDLE_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(stage, destination);
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    id: manifest.artifact.id,
    version: manifest.artifact.version,
    skills: manifest.artifact.skills,
    path: destination,
    sha256: expectedSha256,
    manifestSha256: expectedManifestSha256,
    manifest,
  };
}

export function descriptorFromCredential(record: IssuerCredentialRecord): SkillBundleDescriptor {
  if (Date.parse(record.expiresAt) <= Date.now()) throw new Error('issuer credential is expired; reconnect before installing Skills');
  if (!record.skillBundle) {
    throw new Error('issuer has no active Skill bundle; reconnect after distribution resumes');
  }
  return record.skillBundle;
}
