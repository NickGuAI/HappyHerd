import { access, writeFile } from 'node:fs/promises';

import { upsertCredentialAccount, type CredentialPoolPaths } from '../store';

const [stateFile, accountsDir, name, barrierFile] = process.argv.slice(2);
if (!stateFile || !accountsDir || !name || !barrierFile) {
  throw new Error('Expected state file, accounts directory, account name, and barrier file.');
}

const paths: CredentialPoolPaths = { stateFile, accountsDir };
await writeFile(`${barrierFile}.${name}.ready`, 'ready', { mode: 0o600 });

const deadline = Date.now() + 15_000;
while (true) {
  try {
    await access(barrierFile);
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for concurrent-writer barrier.');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

await upsertCredentialAccount({
  provider: 'claude',
  name,
  credential: { type: 'oauth-token', token: `token-${name}` },
}, { paths });
