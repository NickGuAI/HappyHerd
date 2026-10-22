import { describe, expect, it, vi } from 'vitest';
import type { DecryptedProject } from 'happyherd-control-agent/control';
import { handleProjectCommand } from './project';

const projects: DecryptedProject[] = [
  { id: 'project-z', name: 'Example Project B', kind: null },
  { id: 'project-a', name: 'Example Project A', kind: 'work' },
];

describe('account Project command', () => {
  it('shows help without authenticating', async () => {
    const createClient = vi.fn();
    const output = vi.fn();
    await handleProjectCommand(['--help'], { createClient, output });
    expect(createClient).not.toHaveBeenCalled();
    expect(output.mock.calls[0][0]).toContain('happyherd machine auth login');
  });

  it('lists decrypted Project IDs, names, and kinds as JSON', async () => {
    const output = vi.fn();
    await handleProjectCommand(['list', '--json'], {
      createClient: async () => ({ listProjects: async () => projects }),
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
      createClient: async () => ({ listProjects: async () => projects }),
      output,
    });
    expect(output.mock.calls[0][0]).toBe(
      'ID\tNAME\tKIND\nproject-a\tExample Project A\twork\nproject-z\tExample Project B\t-',
    );
  });

  it('explains how to renew expired account-control authentication', async () => {
    await expect(handleProjectCommand(['list'], {
      createClient: async () => ({
        listProjects: async () => { throw new Error('Authentication expired. Run `happyherd-control-agent auth login`.'); },
      }),
      output: vi.fn(),
    })).rejects.toThrow('Run `happyherd machine auth login`');
  });
});
