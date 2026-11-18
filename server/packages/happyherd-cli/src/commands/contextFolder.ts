/** Machine-local Google Drive context folder, accessed through the user's gog. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readSettings, updateSettings } from '@/persistence';

const execFileAsync = promisify(execFile);
const folderMimeType = 'application/vnd.google-apps.folder';
const folderSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const nextStep = 'Sign in to Google Workspace with gog, then run: happyherd context-folder ensure';

async function gog(args: string[]): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('gog', ['--json', '--no-input', 'drive', ...args]));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    const detail = failure.code === 'ENOENT' ? 'gog was not found on PATH.' : failure.stderr?.trim() || 'gog failed.';
    throw new Error(`${detail}\n${nextStep}`);
  }
  return JSON.parse(stdout);
}

async function getFolder(id: string): Promise<z.infer<typeof folderSchema>> {
  const { file } = z.object({ file: folderSchema.extend({ mimeType: z.string() }) })
    .parse(await gog(['get', id, '--fields', 'id,name,mimeType']));
  if (file.mimeType !== folderMimeType) throw new Error('The selected Drive item is not a folder.');
  return { id: file.id, name: file.name };
}

function folderReceipt(folder: { name: string; id?: string }) {
  return {
    name: folder.name,
    id: folder.id ?? null,
    link: folder.id ? `https://drive.google.com/drive/folders/${folder.id}` : null,
  };
}

function help(): string {
  return `happyherd context-folder - Manage this machine's Google Drive context folder

Usage:
  happyherd context-folder show [--json]
  happyherd context-folder ensure [--json]
  happyherd context-folder set --id ID [--json]

show reads the saved name, ID and link without contacting Google.
ensure confirms the saved folder, or finds it by name at the top of My Drive.
It creates a folder only when none matches. Multiple matches require set --id.
set confirms that the account can open the folder and saves its ID and name.
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
    if (action === 'set' ? options.length !== 2 || options[0] !== '--id' || !options[1].trim() : options.length !== 0) {
      throw new Error(`Usage: happyherd context-folder ${action}${action === 'set' ? ' --id ID' : ''} [--json]`);
    }

    const settings = await readSettings();
    let folder = { name: settings.contextFolder?.name?.trim() || 'MyContext', id: settings.contextFolder?.id };
    if (action === 'set') {
      folder = await getFolder(options[1]);
      await updateSettings((current) => ({ ...current, contextFolder: folder }));
    } else if (action === 'ensure') {
      if (folder.id) {
        await getFolder(folder.id);
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
            ]));
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
        folder = matches[0] ?? z.object({ folder: folderSchema })
          .parse(await gog(['mkdir', '--parent', 'root', '--', folder.name])).folder;
        await updateSettings((current) => ({ ...current, contextFolder: folder }));
      }
    }
    const receipt = folderReceipt(folder);
    console.log(json ? JSON.stringify(receipt) : receipt.id
      ? `${receipt.name}\nID: ${receipt.id}\n${receipt.link}`
      : `${receipt.name}: no folder is recorded yet. Run: happyherd context-folder ensure`);
  } catch (error) {
    if (!json) throw error;
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
