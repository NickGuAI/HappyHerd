import type { DecryptedProject } from 'happyherd-control-agent/control';
import { createDefaultClient, type MachineControlClient } from './machine';

type Output = (value: string) => void;
type ProjectCommandClient = Pick<MachineControlClient, 'listProjects'>;

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
  return `happyherd project - List existing account Projects

Usage:
  happyherd project list [--json]

The account Project catalog is encrypted and names are decrypted locally.
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
  if (action !== 'list') throw new Error(`Unknown project command: ${action}`);
  const json = rest.length === 1 && rest[0] === '--json';
  if (rest.length > 0 && !json) throw new Error(`Unknown project list option: ${rest[0]}`);
  const client = await (dependencies.createClient ?? (async () => createDefaultClient()))();
  let projects: DecryptedProject[];
  try {
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
