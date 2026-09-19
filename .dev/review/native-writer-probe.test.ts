import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activateCodexCredential, persistActiveCodexCredential } from './codexAuth';
import { activateGrokCredential, persistActiveGrokCredential } from './grokAuth';
import { credentialAccountEnvironment, upsertCredentialAccount } from './store';

// Copied into an ephemeral checkout for review only; never included in a PR.
// These are safety assertions expected to FAIL on the reviewed implementation.
// They use dummy bytes, not provider credentials or a running native session.
describe('Review: unmanaged native writer must not contaminate another account', () => {
  it.each(['codex', 'grok'] as const)('%s retains B after stale native A refreshes the shared auth file', async (provider) => {
    const root = await mkdtemp(join(tmpdir(), 'happyherd-review-native-writer-'));
    try {
      const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
      const runtimeHome = join(root, 'runtime');
      const a = await upsertCredentialAccount({ provider, name: 'review-a', credential: { type: 'auth-file', path: join(root, 'accounts/a/auth.json') } }, { paths, now: 1 });
      const b = await upsertCredentialAccount({ provider, name: 'review-b', credential: { type: 'auth-file', path: join(root, 'accounts/b/auth.json') } }, { paths, now: 2 });
      if (a.provider === 'claude' || b.provider === 'claude') throw new Error('Invalid fixture');
      await mkdir(dirname(a.credential.path), { recursive: true });
      await mkdir(dirname(b.credential.path), { recursive: true });
      await writeFile(a.credential.path, '{"fixture":"a"}');
      await writeFile(b.credential.path, '{"fixture":"b"}');
      if (a.provider === 'codex' && b.provider === 'codex') {
        await activateCodexCredential(a, runtimeHome);
        await activateCodexCredential(b, runtimeHome);
      } else if (a.provider === 'grok' && b.provider === 'grok') {
        await activateGrokCredential(a, runtimeHome);
        await activateGrokCredential(b, runtimeHome);
      } else throw new Error('Mismatched fixture');
      // Simulate native process A's ordinary auth-file refresh. Native writers
      // do not acquire HappyHerd's sidecar lock or rewrite its ownership marker.
      await writeFile(join(runtimeHome, 'auth.json'), '{"fixture":"a-refreshed-by-native"}');
      const env = { ...credentialAccountEnvironment(b), ...(provider === 'codex' ? { CODEX_HOME: runtimeHome } : { GROK_HOME: runtimeHome }) };
      if (provider === 'codex') await persistActiveCodexCredential(env, paths);
      else await persistActiveGrokCredential(env, paths);
      expect(await readFile(b.credential.path, 'utf8')).toBe('{"fixture":"b"}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
