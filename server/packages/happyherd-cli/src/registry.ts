/**
 * Provider Skill registration owned by HappyHerd. Verified bundle contents are
 * copied into Claude and Codex discovery roots; ownership receipts make every
 * replacement explicit and keep unrelated user Skills untouched.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { normalizeIssuer } from './contracts';
import {
  verifyInstalledBundleDirectory,
  type InstalledSkillBundle,
  type SkillBundleFile,
  type SkillBundleManifest,
} from './skills';

export type SkillProvider = 'claude' | 'codex';

export interface ProviderRoots {
  claude: string;
  codex: string;
}

export interface RegistryOptions {
  providerRoots?: ProviderRoots;
  registryRoot?: string;
}

interface ProviderReceipt {
  schemaVersion: 1;
  product: 'HappyHerd';
  provider: SkillProvider;
  skill: string;
  artifactId: string;
  version: string;
  manifestSha256: string;
  sourceSha: string;
}

export interface ManagedSkillEntry {
  skill: string;
  artifactId: string;
  version: string;
  bundlePath: string;
  zipSha256: string;
  manifestSha256: string;
  sourceSha: string;
  issuer?: string;
  providers: ProviderRoots;
}

interface ManagedSkillRegistry {
  schemaVersion: 1;
  product: 'HappyHerd';
  entries: ManagedSkillEntry[];
}

export interface RegistryReport {
  registeredSkills: number;
  detail: string;
}

export interface ManagedSkillRemovalReport {
  verified: string[];
  removed: string[];
  preserved: Array<{ path: string; reason: string }>;
}

export interface ResolvedManagedTool {
  entry: ManagedSkillEntry;
  manifest: SkillBundleManifest;
  scriptPath: string;
  declaration: SkillBundleFile;
}

const PROVIDERS: SkillProvider[] = ['claude', 'codex'];
const OWNER_RECEIPT = '.happyherd-owner.json';
const REGISTRY_FILE = 'registry.json';

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function modeMatches(actual: number, expected: number): boolean {
  return process.platform === 'win32' || (actual & 0o777) === expected;
}

function resolvedOptions(options: RegistryOptions = {}): { providerRoots: ProviderRoots; registryRoot: string } {
  const providerRoots = options.providerRoots ?? {
    claude: join(homedir(), '.claude', 'skills'),
    codex: join(homedir(), '.codex', 'skills'),
  };
  return {
    providerRoots: {
      claude: resolve(providerRoots.claude),
      codex: resolve(providerRoots.codex),
    },
    registryRoot: resolve(options.registryRoot ?? join(homedir(), '.happyherd', 'skill-registry')),
  };
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`managed directory is unsafe: ${path}`);
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`managed path contains a symbolic link: ${current}`);
    }
  }
}

function strictString(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function parseProviderReceipt(value: unknown, provider: SkillProvider, skill: string): ProviderReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('provider ownership receipt is invalid');
  const receipt = value as Record<string, unknown>;
  exactKeys(
    receipt,
    ['schemaVersion', 'product', 'provider', 'skill', 'artifactId', 'version', 'manifestSha256', 'sourceSha'],
    'provider ownership receipt',
  );
  if (
    receipt.schemaVersion !== 1
    || receipt.product !== 'HappyHerd'
    || receipt.provider !== provider
    || receipt.skill !== skill
  ) throw new Error('provider ownership receipt identity is invalid');
  return {
    schemaVersion: 1,
    product: 'HappyHerd',
    provider,
    skill,
    artifactId: strictString(receipt.artifactId, 'receipt artifactId', /^[a-z0-9][a-z0-9._-]{0,127}$/),
    version: strictString(receipt.version, 'receipt version', /^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/),
    manifestSha256: strictString(receipt.manifestSha256, 'receipt manifestSha256', /^[0-9a-f]{64}$/),
    sourceSha: strictString(receipt.sourceSha, 'receipt sourceSha', /^[0-9a-f]{40}$/),
  };
}

function readProviderReceipt(path: string, provider: SkillProvider, skill: string): ProviderReceipt {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) {
    throw new Error(`provider Skill target is not an owned directory: ${path}`);
  }
  const receiptPath = join(path, OWNER_RECEIPT);
  if (!existsSync(receiptPath) || !lstatSync(receiptPath).isFile()) {
    throw new Error(`refusing to overwrite non-HappyHerd ${provider} Skill: ${skill}`);
  }
  try {
    return parseProviderReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')), provider, skill);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('refusing to overwrite')) throw error;
    throw new Error(`refusing to overwrite ${provider} Skill with an invalid ownership receipt: ${skill}`);
  }
}

function parseEntry(value: unknown, roots: ProviderRoots, index: number): ManagedSkillEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`registry entry ${index} is invalid`);
  const entry = value as Record<string, unknown>;
  const keys = ['skill', 'artifactId', 'version', 'bundlePath', 'zipSha256', 'manifestSha256', 'sourceSha', 'providers'];
  if (Object.hasOwn(entry, 'issuer')) keys.push('issuer');
  exactKeys(entry, keys, `registry entry ${index}`);
  const skill = strictString(entry.skill, `registry entry ${index} skill`, /^[a-z0-9][a-z0-9._-]{0,127}$/);
  const providers = entry.providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error(`registry entry ${index} providers are invalid`);
  }
  const providerPaths = providers as Record<string, unknown>;
  exactKeys(providerPaths, PROVIDERS, `registry entry ${index} providers`);
  const expectedProviderPaths: ProviderRoots = {
    claude: join(roots.claude, skill),
    codex: join(roots.codex, skill),
  };
  if (providerPaths.claude !== expectedProviderPaths.claude || providerPaths.codex !== expectedProviderPaths.codex) {
    throw new Error(`registry entry ${index} provider paths are stale`);
  }
  if (typeof entry.bundlePath !== 'string' || !entry.bundlePath || entry.bundlePath.length > 4096) {
    throw new Error(`registry entry ${index} bundlePath is invalid`);
  }
  const bundlePath = entry.bundlePath;
  if (resolve(bundlePath) !== bundlePath) throw new Error(`registry entry ${index} bundlePath is not absolute`);
  const parsed: ManagedSkillEntry = {
    skill,
    artifactId: strictString(entry.artifactId, `registry entry ${index} artifactId`, /^[a-z0-9][a-z0-9._-]{0,127}$/),
    version: strictString(entry.version, `registry entry ${index} version`, /^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/),
    bundlePath,
    zipSha256: strictString(entry.zipSha256, `registry entry ${index} zipSha256`, /^[0-9a-f]{64}$/),
    manifestSha256: strictString(entry.manifestSha256, `registry entry ${index} manifestSha256`, /^[0-9a-f]{64}$/),
    sourceSha: strictString(entry.sourceSha, `registry entry ${index} sourceSha`, /^[0-9a-f]{40}$/),
    providers: expectedProviderPaths,
  };
  if (entry.issuer !== undefined) parsed.issuer = normalizeIssuer(strictString(entry.issuer, 'registry issuer', /^https?:\/\//));
  return parsed;
}

function readRegistry(options: RegistryOptions = {}): ManagedSkillRegistry {
  const { providerRoots, registryRoot } = resolvedOptions(options);
  const path = join(registryRoot, REGISTRY_FILE);
  if (!existsSync(path)) return { schemaVersion: 1, product: 'HappyHerd', entries: [] };
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('managed Skill registry file is unsafe');
  if (!modeMatches(lstatSync(path).mode, 0o600)) throw new Error('managed Skill registry mode is unsafe');
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('managed Skill registry is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('managed Skill registry is invalid');
  const registry = value as Record<string, unknown>;
  exactKeys(registry, ['schemaVersion', 'product', 'entries'], 'managed Skill registry');
  if (registry.schemaVersion !== 1 || registry.product !== 'HappyHerd' || !Array.isArray(registry.entries)) {
    throw new Error('managed Skill registry identity is invalid');
  }
  const entries = registry.entries.map((entry, index) => parseEntry(entry, providerRoots, index));
  if (new Set(entries.map((entry) => entry.skill)).size !== entries.length) {
    throw new Error('managed Skill registry contains duplicate Skills');
  }
  return { schemaVersion: 1, product: 'HappyHerd', entries };
}

function recursiveFiles(root: string, directory = root): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`managed Skill contains a symbolic link: ${path}`);
    if (entry.isDirectory()) output.push(...recursiveFiles(root, path));
    else if (entry.isFile()) output.push(relative(root, path).split(sep).join('/'));
    else throw new Error(`managed Skill contains an unsupported filesystem entry: ${path}`);
  }
  return output;
}

function skillDeclarations(manifest: SkillBundleManifest, skill: string): Array<SkillBundleFile & { relativePath: string }> {
  return manifest.files
    .filter((file) => file.path.startsWith(`${skill}/`))
    .map((file) => ({ ...file, relativePath: file.path.slice(skill.length + 1) }));
}

function expectedReceipt(entry: ManagedSkillEntry, provider: SkillProvider): ProviderReceipt {
  return {
    schemaVersion: 1,
    product: 'HappyHerd',
    provider,
    skill: entry.skill,
    artifactId: entry.artifactId,
    version: entry.version,
    manifestSha256: entry.manifestSha256,
    sourceSha: entry.sourceSha,
  };
}

function verifyProviderTarget(
  entry: ManagedSkillEntry,
  provider: SkillProvider,
  manifest: SkillBundleManifest,
): void {
  const target = entry.providers[provider];
  const receipt = readProviderReceipt(target, provider, entry.skill);
  if (JSON.stringify(receipt) !== JSON.stringify(expectedReceipt(entry, provider))) {
    throw new Error(`${provider} Skill ownership receipt is stale: ${entry.skill}`);
  }
  const declarations = skillDeclarations(manifest, entry.skill);
  const expectedPaths = [...declarations.map((file) => file.relativePath), OWNER_RECEIPT].sort();
  if (JSON.stringify(recursiveFiles(target).sort()) !== JSON.stringify(expectedPaths)) {
    throw new Error(`${provider} Skill file inventory is stale: ${entry.skill}`);
  }
  const receiptStat = lstatSync(join(target, OWNER_RECEIPT));
  if (!modeMatches(receiptStat.mode, 0o644)) throw new Error(`${provider} Skill receipt mode is stale: ${entry.skill}`);
  for (const file of declarations) {
    const path = join(target, ...file.relativePath.split('/'));
    const stat = lstatSync(path);
    if (
      !stat.isFile()
      || !modeMatches(stat.mode, file.mode)
      || stat.size !== file.sizeBytes
      || sha256(readFileSync(path)) !== file.sha256
    ) throw new Error(`${provider} Skill file is stale: ${entry.skill}/${file.relativePath}`);
  }
}

function verifyBundleReceipt(entry: ManagedSkillEntry): void {
  const path = join(entry.bundlePath, '.happyherd-bundle.json');
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
    throw new Error(`bundle publication receipt is missing: ${entry.skill}`);
  }
  const receipt = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  exactKeys(
    receipt,
    ['schemaVersion', 'id', 'version', 'path', 'skills', 'sha256', 'manifestSha256', 'sourceSha', 'installedAt'],
    'bundle publication receipt',
  );
  if (
    receipt.schemaVersion !== 1
    || receipt.id !== entry.artifactId
    || receipt.version !== entry.version
    || receipt.path !== entry.bundlePath
    || receipt.sha256 !== entry.zipSha256
    || receipt.manifestSha256 !== entry.manifestSha256
    || receipt.sourceSha !== entry.sourceSha
    || !Array.isArray(receipt.skills)
    || !receipt.skills.includes(entry.skill)
    || typeof receipt.installedAt !== 'string'
    || !Number.isFinite(Date.parse(receipt.installedAt))
  ) throw new Error(`bundle publication receipt is stale: ${entry.skill}`);
}

function ownedSkills(root: string, provider: SkillProvider): string[] {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error(`${provider} Skill root is unsafe`);
  const skills: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const receipt = join(root, entry.name, OWNER_RECEIPT);
    if (existsSync(receipt)) {
      readProviderReceipt(join(root, entry.name), provider, entry.name);
      skills.push(entry.name);
    }
  }
  return skills.sort();
}

export function validateManagedSkillRegistry(options: RegistryOptions = {}): RegistryReport {
  const resolved = resolvedOptions(options);
  const registry = readRegistry(options);
  const expectedSkills = registry.entries.map((entry) => entry.skill).sort();
  for (const provider of PROVIDERS) {
    const actual = ownedSkills(resolved.providerRoots[provider], provider);
    if (JSON.stringify(actual) !== JSON.stringify(expectedSkills)) {
      throw new Error(`${provider} managed Skill discovery is out of sync with the registry`);
    }
  }
  const bundleCache = new Map<string, SkillBundleManifest>();
  for (const entry of registry.entries) {
    const key = `${entry.bundlePath}\0${entry.manifestSha256}`;
    let manifest = bundleCache.get(key);
    if (!manifest) {
      const verified = verifyInstalledBundleDirectory(entry.bundlePath, {
        id: entry.artifactId,
        version: entry.version,
        manifestSha256: entry.manifestSha256,
        sourceSha: entry.sourceSha,
      });
      manifest = verified.manifest;
      bundleCache.set(key, manifest);
    }
    if (!manifest.artifact.skills.includes(entry.skill)) throw new Error(`registry references an undeclared Skill: ${entry.skill}`);
    verifyBundleReceipt(entry);
    for (const provider of PROVIDERS) verifyProviderTarget(entry, provider, manifest);
  }
  return {
    registeredSkills: registry.entries.length,
    detail: registry.entries.length === 0
      ? 'ready; no HappyHerd-managed Skills installed'
      : `ready; ${registry.entries.length} Skill${registry.entries.length === 1 ? '' : 's'} visible to Claude and Codex`,
  };
}

/**
 * Remove only provider copies whose protected registry entry, immutable bundle,
 * manifest, ownership receipt, inventory, modes, sizes, and digests still
 * agree. Ambiguous or modified targets are deliberately preserved for manual
 * review; unrelated provider entries are never considered.
 */
export function removeVerifiedManagedSkillsForUninstall(
  options: RegistryOptions = {},
  apply = false,
): ManagedSkillRemovalReport {
  const report: ManagedSkillRemovalReport = { verified: [], removed: [], preserved: [] };
  const candidates: Array<{
    entry: ManagedSkillEntry;
    provider: SkillProvider;
    manifest: SkillBundleManifest;
    path: string;
    dev: number;
    ino: number;
  }> = [];
  let registry: ManagedSkillRegistry;
  try {
    registry = readRegistry(options);
  } catch (error) {
    report.preserved.push({
      path: resolvedOptions(options).registryRoot,
      reason: `protected registry unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
    return report;
  }
  for (const entry of registry.entries) {
    let manifest: SkillBundleManifest;
    try {
      verifyBundleReceipt(entry);
      manifest = verifyInstalledBundleDirectory(entry.bundlePath, {
        id: entry.artifactId,
        version: entry.version,
        manifestSha256: entry.manifestSha256,
        sourceSha: entry.sourceSha,
      }).manifest;
      if (!manifest.artifact.skills.includes(entry.skill)) {
        throw new Error('bundle no longer declares the registered Skill');
      }
    } catch (error) {
      for (const provider of PROVIDERS) {
        const path = entry.providers[provider];
        if (existsSync(path)) report.preserved.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    for (const provider of PROVIDERS) {
      const path = entry.providers[provider];
      if (!existsSync(path)) {
        report.preserved.push({ path, reason: 'registered provider Skill target is missing' });
        continue;
      }
      try {
        verifyProviderTarget(entry, provider, manifest);
        const stat = lstatSync(path);
        report.verified.push(path);
        candidates.push({ entry, provider, manifest, path, dev: stat.dev, ino: stat.ino });
      } catch (error) {
        report.preserved.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  // Application is deliberately two-pass. Nothing is removed unless every
  // registered provider copy passed the first pass, and every candidate still
  // has the same inode and verified contents immediately before mutation.
  if (!apply || report.preserved.length > 0) return report;
  for (const candidate of candidates) {
    try {
      const stat = lstatSync(candidate.path);
      if (stat.dev !== candidate.dev || stat.ino !== candidate.ino) {
        throw new Error('provider Skill target changed after uninstall preflight');
      }
      verifyProviderTarget(candidate.entry, candidate.provider, candidate.manifest);
    } catch (error) {
      report.preserved.push({
        path: candidate.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (report.preserved.length > 0) return report;
  for (const candidate of candidates) {
    try {
      const stat = lstatSync(candidate.path);
      if (stat.dev !== candidate.dev || stat.ino !== candidate.ino) {
        throw new Error('provider Skill target changed before verified removal');
      }
      rmSync(candidate.path, { recursive: true, force: false });
      report.removed.push(candidate.path);
    } catch (error) {
      report.preserved.push({
        path: candidate.path,
        reason: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  return report;
}

function writeSkillStage(
  stage: string,
  bundle: InstalledSkillBundle,
  skill: string,
  receipt: ProviderReceipt,
): void {
  // Provider copies are owned and writable only by the broker identity, but
  // the target user's Claude/Codex process must be able to traverse and read
  // them. Canonical bundles and credentials remain in service-only state.
  // launchd services inherit a restrictive umask. Narrow it only across this
  // synchronous, non-secret provider publication block so every newly-created
  // directory is traversable by the employee without recursively following
  // paths that an employee-owned namespace could swap underneath the broker.
  const previousUmask = process.umask(0o022);
  try {
    mkdirSync(stage, { mode: 0o755 });
    for (const file of skillDeclarations(bundle.manifest, skill)) {
      const source = join(bundle.path, ...file.path.split('/'));
      const destination = join(stage, ...file.relativePath.split('/'));
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
      writeFileSync(destination, readFileSync(source), { mode: file.mode, flag: 'wx' });
      chmodSync(destination, file.mode);
    }
    const receiptPath = join(stage, OWNER_RECEIPT);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    chmodSync(receiptPath, 0o644);
  } finally {
    process.umask(previousUmask);
  }
}

export function registerInstalledSkillBundle(
  bundle: InstalledSkillBundle,
  registration: RegistryOptions & {
    issuer?: string;
    cleanupRemove?: typeof rmSync;
    publicationRename?: typeof renameSync;
  } = {},
): RegistryReport {
  const resolved = resolvedOptions(registration);
  const verified = verifyInstalledBundleDirectory(bundle.path, {
    id: bundle.id,
    version: bundle.version,
    manifestSha256: bundle.manifestSha256,
    sourceSha: bundle.manifest.source.sha,
  });
  if (JSON.stringify(verified.manifest) !== JSON.stringify(bundle.manifest)) {
    throw new Error('installed Skill bundle changed before provider registration');
  }
  const issuer = registration.issuer === undefined ? undefined : normalizeIssuer(registration.issuer);
  if (issuer && new URL(bundle.manifest.product.baseUrl).origin !== issuer) {
    throw new Error('verified Skill bundle API base is not on the connected issuer origin');
  }
  ensureDirectory(resolved.registryRoot);
  for (const provider of PROVIDERS) ensureDirectory(resolved.providerRoots[provider]);
  const registry = readRegistry(registration);
  // Replacement and retirement are destructive. Verify the complete current
  // registry, immutable bundles, provider receipts, inventories, modes, sizes,
  // and digests before staging or renaming anything. A user-modified managed
  // copy is evidence to preserve, never permission to overwrite it.
  validateManagedSkillRegistry(registration);
  const newEntries: ManagedSkillEntry[] = bundle.skills.map((skill) => ({
    skill,
    artifactId: bundle.id,
    version: bundle.version,
    bundlePath: resolve(bundle.path),
    zipSha256: bundle.sha256,
    manifestSha256: bundle.manifestSha256,
    sourceSha: bundle.manifest.source.sha,
    ...(issuer ? { issuer } : {}),
    providers: {
      claude: join(resolved.providerRoots.claude, skill),
      codex: join(resolved.providerRoots.codex, skill),
    },
  }));

  for (const entry of newEntries) {
    const existing = registry.entries.find((candidate) => candidate.skill === entry.skill);
    if (existing && existing.issuer !== entry.issuer) {
      throw new Error(`Skill name is already managed for a different issuer: ${entry.skill}`);
    }
  }

  const transactions: Array<{
    provider: SkillProvider;
    skill: string;
    target: string;
    stage?: string;
    backup: string;
    retire: boolean;
    published: boolean;
    preserved: boolean;
  }> = [];
  for (const entry of newEntries) {
    for (const provider of PROVIDERS) {
      const target = entry.providers[provider];
      if (existsSync(target)) readProviderReceipt(target, provider, entry.skill);
      const nonce = randomBytes(8).toString('hex');
      const stage = join(resolved.providerRoots[provider], `.${entry.skill}.happyherd-stage-${nonce}`);
      const backup = join(resolved.providerRoots[provider], `.${entry.skill}.happyherd-backup-${nonce}`);
      transactions.push({
        provider,
        skill: entry.skill,
        target,
        stage,
        backup,
        retire: false,
        published: false,
        preserved: false,
      });
    }
  }
  const newSkillNames = new Set(newEntries.map((entry) => entry.skill));
  const retiredEntries = registry.entries.filter(
    (entry) => entry.artifactId === bundle.id && !newSkillNames.has(entry.skill),
  );
  for (const entry of retiredEntries) {
    for (const provider of PROVIDERS) {
      const target = entry.providers[provider];
      // A retirement is destructive only after the existing protected
      // registry and provider receipt agree that HappyHerd owns the target.
      readProviderReceipt(target, provider, entry.skill);
      const nonce = randomBytes(8).toString('hex');
      transactions.push({
        provider,
        skill: entry.skill,
        target,
        backup: join(resolved.providerRoots[provider], `.${entry.skill}.happyherd-backup-${nonce}`),
        retire: true,
        published: false,
        preserved: false,
      });
    }
  }
  try {
    for (const transaction of transactions) {
      if (transaction.retire) continue;
      const entry = newEntries.find((candidate) => candidate.skill === transaction.skill);
      if (!entry) throw new Error(`missing registry entry for ${transaction.skill}`);
      if (!transaction.stage) throw new Error(`missing provider stage for ${transaction.skill}`);
      writeSkillStage(
        transaction.stage,
        bundle,
        transaction.skill,
        expectedReceipt(entry, transaction.provider),
      );
    }
  } catch (error) {
    for (const transaction of transactions) {
      if (transaction.stage) rmSync(transaction.stage, { recursive: true, force: true });
    }
    throw error;
  }

  const registryPath = join(resolved.registryRoot, REGISTRY_FILE);
  const registryTemp = join(resolved.registryRoot, `.registry-${randomBytes(8).toString('hex')}.json`);
  const registryBackup = join(resolved.registryRoot, `.registry-previous-${randomBytes(8).toString('hex')}.json`);
  const replacedSkills = new Set(newEntries.map((entry) => entry.skill));
  const nextRegistry: ManagedSkillRegistry = {
    schemaVersion: 1,
    product: 'HappyHerd',
    entries: [
      ...registry.entries.filter(
        (entry) => entry.artifactId !== bundle.id && !replacedSkills.has(entry.skill),
      ),
      ...newEntries,
    ]
      .sort((left, right) => left.skill.localeCompare(right.skill)),
  };
  try {
    writeFileSync(registryTemp, `${JSON.stringify(nextRegistry, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    for (const transaction of transactions) {
      if (transaction.stage) rmSync(transaction.stage, { recursive: true, force: true });
    }
    throw error;
  }
  let registryPreserved = false;
  let registryPublished = false;
  let report: RegistryReport | null = null;
  const publicationRename = registration.publicationRename ?? renameSync;
  try {
    for (const transaction of transactions) {
      if (existsSync(transaction.target)) {
        publicationRename(transaction.target, transaction.backup);
        transaction.preserved = true;
      }
      if (!transaction.retire) {
        if (!transaction.stage) throw new Error(`missing provider stage for ${transaction.skill}`);
        publicationRename(transaction.stage, transaction.target);
      }
      transaction.published = true;
    }
    if (existsSync(registryPath)) {
      publicationRename(registryPath, registryBackup);
      registryPreserved = true;
    }
    publicationRename(registryTemp, registryPath);
    registryPublished = true;
    report = validateManagedSkillRegistry(registration);
  } catch (error) {
    if (registryPublished) rmSync(registryPath, { force: true });
    if (registryPreserved && existsSync(registryBackup)) publicationRename(registryBackup, registryPath);
    rmSync(registryTemp, { force: true });
    for (const transaction of [...transactions].reverse()) {
      if (transaction.published && !transaction.retire) rmSync(transaction.target, { recursive: true, force: true });
      if (transaction.preserved && existsSync(transaction.backup)) publicationRename(transaction.backup, transaction.target);
      if (transaction.stage) rmSync(transaction.stage, { recursive: true, force: true });
    }
    throw error;
  }
  if (!report) throw new Error('managed Skill registry verification did not complete');
  // Publication and verification are the transaction commit point. Old
  // backups are hidden from discovery and may be removed best-effort; a
  // cleanup failure must never enter rollback after earlier backups are gone.
  const cleanupRemove = registration.cleanupRemove ?? rmSync;
  for (const transaction of transactions) {
    if (!transaction.preserved) continue;
    try { cleanupRemove(transaction.backup, { recursive: true, force: true }); } catch { /* retain rollback artifact */ }
  }
  if (registryPreserved) {
    try { cleanupRemove(registryBackup, { force: true }); } catch { /* retain rollback artifact */ }
  }
  return report;
}

function safeScriptPath(value: string): string {
  if (
    !value
    || value.startsWith('/')
    || value.includes('\\')
    || !/^[A-Za-z0-9._+@/-]+$/.test(value)
  ) throw new Error('tool script must be a verified relative ASCII path');
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('tool script contains an unsafe path segment');
  }
  return value;
}

export function resolveManagedTool(
  issuerInput: string,
  skillInput: string,
  scriptInput: string,
  options: RegistryOptions = {},
): ResolvedManagedTool {
  validateManagedSkillRegistry(options);
  const issuer = normalizeIssuer(issuerInput);
  const skill = strictString(skillInput, 'tool skill', /^[a-z0-9][a-z0-9._-]{0,127}$/);
  const script = safeScriptPath(scriptInput);
  const registry = readRegistry(options);
  const entry = registry.entries.find((candidate) => candidate.skill === skill);
  if (!entry) throw new Error(`Skill is not registered with HappyHerd: ${skill}`);
  if (!entry.issuer) throw new Error(`Skill was installed without an issuer association: ${skill}`);
  if (entry.issuer !== issuer) throw new Error(`Skill is registered to a different issuer: ${skill}`);
  const verified = verifyInstalledBundleDirectory(entry.bundlePath, {
    id: entry.artifactId,
    version: entry.version,
    manifestSha256: entry.manifestSha256,
    sourceSha: entry.sourceSha,
  });
  const manifestPath = `${skill}/${script}`;
  const declaration = verified.manifest.files.find((file) => file.path === manifestPath);
  if (!declaration) throw new Error(`tool script is not declared by the verified Skill: ${manifestPath}`);
  return {
    entry,
    manifest: verified.manifest,
    scriptPath: join(entry.bundlePath, ...manifestPath.split('/')),
    declaration,
  };
}
