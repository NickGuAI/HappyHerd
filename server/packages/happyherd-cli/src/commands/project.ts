import type { DecryptedProject } from 'happyherd-control-agent/control';
import { createDefaultClient, type MachineControlClient } from './machine';

type Output = (value: string) => void;
type ProjectCommandClient = Pick<MachineControlClient, 'listProjects' | 'createProject' | 'renameProject'>;

export type ProjectCommandDependencies = {
  createClient?: () => Promise<ProjectCommandClient>;
  output?: Output;
};

export function projectListReceipt(projects: DecryptedProject[]) {
  return {
    schemaVersion: 1,
    type: 'project-list' as const,
    projects: [...projects]
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(({ id, name, kind }) => ({ id, name, kind })),
  };
}

function projectHelp(): string {
  return `happyherd project - List, create, and rename account Projects

Usage:
  happyherd project list [--json]
  happyherd project create --name NAME [--json]
  happyherd project rename PROJECT_ID --name NAME [--json]

The account Project catalog is encrypted and names are decrypted locally.
Create and rename return the Project ID and name. Rename preserves its sessions
and all other Project metadata.
Project commands require account-level machine control authentication. Run
"happyherd machine auth login" and approve the link in the HappyHerd app.`;
}

export async function handleProjectCommand(
  args: string[],
  dependencies: ProjectCommandDependencies = {},
): Promise<void> {
  const [action, ...rest] = args;
  const output = dependencies.output ?? console.log;
  if (!action || action === 'help' || action === '--help' || action === '-h'
    || rest.includes('--help') || rest.includes('-h')) {
    output(projectHelp());
    return;
  }
  if (action !== 'list' && action !== 'create' && action !== 'rename') {
    throw new Error(`Unknown project command: ${action}`);
  }
  let json = false;
  let name: string | undefined;
  const projectId = action === 'rename' ? rest.shift() : undefined;
  if (action === 'rename' && (!projectId || projectId.startsWith('-'))) {
    throw new Error('Project ID is required');
  }
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index];
    if (option === '--json' && !json) {
      json = true;
    } else if (option === '--name' && action !== 'list' && name === undefined) {
      name = rest[++index];
      if (!name || name.startsWith('--')) throw new Error('Project name is required');
    } else {
      throw new Error(`Unknown project ${action} option: ${option}`);
    }
  }
  if (action !== 'list' && !name?.trim()) throw new Error('Project name is required');
  const client = await (dependencies.createClient ?? (async () => createDefaultClient()))();
  let projects: DecryptedProject[];
  try {
    if (action !== 'list') {
      const project = action === 'create'
        ? await client.createProject(name!)
        : await client.renameProject(projectId!, name!);
      output(json
        ? JSON.stringify({ schemaVersion: 1, type: `project-${action}`, project })
        : `${project.id}\t${project.name}`);
      return;
    }
    projects = await client.listProjects();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('happyherd-control-agent auth login')) {
      throw new Error('Account-level machine authentication expired. Run `happyherd machine auth login` and approve the one-time link in the HappyHerd app.');
    }
    throw error;
  }
  const receipt = projectListReceipt(projects);
  if (json) {
    output(JSON.stringify(receipt));
    return;
  }
  output([
    'ID\tNAME\tKIND',
    ...receipt.projects.map((project) => `${project.id}\t${project.name}\t${project.kind ?? '-'}`),
  ].join('\n'));
}
