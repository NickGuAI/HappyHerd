import { describe, expect, it, vi } from 'vitest';
import type { DecryptedProject } from 'happyherd-control-agent/control';
import { handleProjectCommand } from './project';

const projects: DecryptedProject[] = [
  { id: 'project-z', name: 'Example Project B', kind: null },
  { id: 'project-a', name: 'Example Project A', kind: 'work' },
];

function makeClient() {
  return {
    listProjects: vi.fn(async () => projects),
    createProject: vi.fn(async (name: string) => ({ id: 'project-new', name, kind: 'personal' })),
    renameProject: vi.fn(async (id: string, name: string) => ({ id, name, kind: 'work' })),
  };
}

describe('account Project command', () => {
  it('shows help without authenticating', async () => {
    const createClient = vi.fn();
    const output = vi.fn();
    await handleProjectCommand(['--help'], { createClient, output });
    expect(createClient).not.toHaveBeenCalled();
    expect(output.mock.calls[0][0]).toContain('happyherd machine auth login');
    expect(output.mock.calls[0][0]).toContain('happyherd project create --name NAME [--json]');
    expect(output.mock.calls[0][0]).toContain('happyherd project rename PROJECT_ID --name NAME [--json]');
  });

  it('lists decrypted Project IDs, names, and kinds as JSON', async () => {
    const output = vi.fn();
    await handleProjectCommand(['list', '--json'], {
      createClient: async () => makeClient(),
      output,
    });
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({
      schemaVersion: 1,
      type: 'project-list',
      projects: [
        { id: 'project-a', name: 'Example Project A', kind: 'work' },
        { id: 'project-z', name: 'Example Project B', kind: null },
      ],
    });
  });

  it('renders names without exposing encrypted Project fields', async () => {
    const output = vi.fn();
    await handleProjectCommand(['list'], {
      createClient: async () => makeClient(),
      output,
    });
    expect(output.mock.calls[0][0]).toBe(
      'ID\tNAME\tKIND\nproject-a\tExample Project A\twork\nproject-z\tExample Project B\t-',
    );
  });

  it.each(['create', 'rename'] as const)('returns the %s Project ID and name as JSON', async (action) => {
    const client = makeClient();
    const output = vi.fn();
    const args = action === 'create'
      ? ['create', '--name', 'New Project', '--json']
      : ['rename', 'project-a', '--name', 'New Project', '--json'];
    await handleProjectCommand(args, { createClient: async () => client, output });
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({
      schemaVersion: 1,
      type: `project-${action}`,
      project: { id: action === 'create' ? 'project-new' : 'project-a', name: 'New Project', kind: action === 'create' ? 'personal' : 'work' },
    });
    if (action === 'create') expect(client.createProject).toHaveBeenCalledWith('New Project');
    else expect(client.renameProject).toHaveBeenCalledWith('project-a', 'New Project');
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it('prints the renamed Project ID and name as text', async () => {
    const output = vi.fn();
    await handleProjectCommand(['rename', 'project-a', '--name', 'New Project'], {
      createClient: async () => makeClient(), output,
    });
    expect(output.mock.calls[0][0]).toBe('project-a\tNew Project');
  });

  it.each([
    ['create'], ['create', '--name'], ['create', '--name', ' '],
    ['rename'], ['rename', '--name', 'New'], ['rename', 'project-a'],
  ])('rejects incomplete arguments before authentication: %s', async (...args) => {
    const createClient = vi.fn();
    await expect(handleProjectCommand(args, { createClient })).rejects.toThrow(/required/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['list'], ['create', '--name', 'New Project'], ['rename', 'project-a', '--name', 'New Project'],
  ])('explains missing or expired account-control authentication for %s', async (...args) => {
    const expired = vi.fn(async () => {
      throw new Error('Authentication expired. Run `happyherd-control-agent auth login`.');
    });
    await expect(handleProjectCommand(args, {
      createClient: async () => ({ listProjects: expired, createProject: expired, renameProject: expired }),
      output: vi.fn(),
    })).rejects.toThrow('Run `happyherd machine auth login`');
    await expect(handleProjectCommand(args, {
      createClient: async () => { throw new Error('Account-level machine control is not linked. Run `happyherd machine auth login`.'); },
      output: vi.fn(),
    })).rejects.toThrow('Account-level machine control is not linked');
  });
});
