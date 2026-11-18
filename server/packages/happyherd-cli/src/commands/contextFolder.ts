/** Machine-local Google Drive context folder, accessed through the user's gog. */
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { z } from 'zod';
import { readSettings, updateSettings } from '@/persistence';

const execFileAsync = promisify(execFile);
const folderMimeType = 'application/vnd.google-apps.folder';
const folderSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const nextStep = 'Sign in to Google Workspace with gog, then run: happyherd context-folder ensure';

async function gog(args: string[], account?: string): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('gog', ['--json', '--no-input', ...(account ? ['--account', account] : []), 'drive', ...args]));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    const detail = failure.code === 'ENOENT' ? 'gog was not found on PATH.' : failure.stderr?.trim() || 'gog failed.';
    const step = detail.includes('missing --account')
      ? 'Select a Google account, then run: happyherd context-folder ensure --account EMAIL'
      : nextStep;
    throw new Error(`${detail}\n${step}`);
  }
  return JSON.parse(stdout);
}

async function getFolder(id: string, account?: string): Promise<z.infer<typeof folderSchema>> {
  const { file } = z.object({ file: folderSchema.extend({ mimeType: z.string() }) })
    .parse(await gog(['get', id, '--fields', 'id,name,mimeType'], account));
  if (file.mimeType !== folderMimeType) throw new Error('The selected Drive item is not a folder.');
  return { id: file.id, name: file.name };
}

function folderReceipt(folder: { name: string; id?: string; account?: string }) {
  return {
    name: folder.name,
    id: folder.id ?? null,
    link: folder.id ? `https://drive.google.com/drive/folders/${folder.id}` : null,
    account: folder.account ?? null,
  };
}

function help(): string {
  return `happyherd context-folder - Manage this machine's Google Drive context folder

Usage:
  happyherd context-folder show [--json]
  happyherd context-folder ensure [--account EMAIL] [--json]
  happyherd context-folder set --id ID [--account EMAIL] [--json]

show reads the saved name, ID, link and account without contacting Google.
ensure confirms the saved folder, or finds it by name at the top of My Drive.
It creates a folder only when none matches. Multiple matches require set --id.
set confirms that the account can open the folder and saves its ID and name.
ensure and set accept --account EMAIL and save it only after success.
The saved account is used for later gog calls; otherwise gog chooses the account.
The default name is MyContext; install.sh --context-folder NAME chooses a name.
Google access uses your own gog on PATH. HappyHerd stores no Google token.
${nextStep}`;
}

export async function handleContextFolderCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
      console.log(help());
      return;
    }
    const [action, ...options] = args.filter((arg) => arg !== '--json');
    if (!['show', 'ensure', 'set'].includes(action)) throw new Error(`Unknown context-folder command: ${action}`);
    const { values } = parseArgs({ args: options, options: { id: { type: 'string' }, account: { type: 'string' } } });
    if ((action === 'set' ? !values.id?.trim() : values.id !== undefined)
      || (values.account !== undefined && (action === 'show' || !values.account.trim()))) {
      throw new Error(`Usage: happyherd context-folder ${action}${action === 'set' ? ' --id ID' : ''}${action === 'show' ? '' : ' [--account EMAIL]'} [--json]`);
    }

    const settings = await readSettings();
    let folder = {
      name: settings.contextFolder?.name?.trim() || 'MyContext',
      id: settings.contextFolder?.id,
      account: values.account?.trim() ?? settings.contextFolder?.account,
    };
    if (action === 'set') {
      folder = { ...await getFolder(values.id!, folder.account), account: folder.account };
      await updateSettings((current) => ({ ...current, contextFolder: folder }));
    } else if (action === 'ensure') {
      if (folder.id) {
        await getFolder(folder.id, folder.account);
        if (values.account !== undefined) await updateSettings((current) => ({ ...current, contextFolder: folder }));
      } else {
        // Drive query literals escape backslashes and apostrophes, independently of argv.
        const name = folder.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const matches: z.infer<typeof folderSchema>[] = [];
        let page = '';
        do {
          const result = z.object({ files: z.array(folderSchema).nullable(), nextPageToken: z.string().optional() })
            .parse(await gog([
              'ls', '--parent', 'root', '--no-all-drives',
              '--query', `name = '${name}' and mimeType = '${folderMimeType}' and trashed = false`,
              '--fields', 'files(id,name),nextPageToken',
              ...(page ? ['--page', page] : []),
            ], folder.account));
          matches.push(...(result.files ?? []));
          page = result.nextPageToken ?? '';
        } while (page);
        if (matches.length > 1) {
          const error = 'Several folders match. Choose one with: happyherd context-folder set --id ID';
          console.log(json ? JSON.stringify({ error, matches: matches.map(folderReceipt) })
            : [error, ...matches.map((match) => `${match.name}\t${match.id}\t${folderReceipt(match).link}`)].join('\n'));
          process.exitCode = 1;
          return;
        }
        const selected = matches[0] ?? z.object({ folder: folderSchema })
          .parse(await gog(['mkdir', '--parent', 'root', '--', folder.name], folder.account)).folder;
        folder = { ...selected, account: folder.account };
        await updateSettings((current) => ({ ...current, contextFolder: folder }));
      }
    }
    const receipt = folderReceipt(folder);
    const display = receipt.id
      ? `${receipt.name}\nID: ${receipt.id}\n${receipt.link}`
      : `${receipt.name}: no folder is recorded yet. Run: happyherd context-folder ensure`;
    console.log(json ? JSON.stringify(receipt) : `${display}\nAccount: ${receipt.account ?? 'not recorded'}`);
  } catch (error) {
    if (!json) throw error;
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
