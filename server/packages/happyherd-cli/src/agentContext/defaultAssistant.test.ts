import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'happyherd-default-commander-'));
  vi.stubEnv('HAPPYHERD_HOME_DIR', directory);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

async function installAssistantName(name: string) {
  const installer = await readFile(new URL('../../../../../install.sh', import.meta.url), 'utf8');
  // Exercise the real argument parser and settings writer without installing a runtime.
  const argumentsScript = installer.slice(0, installer.indexOf('[ "$(id -u)"'));
  const settingsStart = installer.indexOf('"$node_bin" - "$settings_path" "$server_url"');
  const settingsScript = installer.slice(settingsStart, installer.indexOf('\nNODE', settingsStart) + 5);
  return spawnSync('sh', ['-s', '--', '--assistant-name', name], {
    input: `${argumentsScript}\nnode_bin=node\nsettings_path="$HAPPYHERD_HOME_DIR/settings.json"\n${settingsScript}`,
    encoding: 'utf8',
    env: process.env,
  });
}

describe('default Assistant Commander', () => {
  it.each([undefined, '', '  '])('creates OldBlue with the BigBoss definition when the name is %s', async (assistantName) => {
    if (assistantName !== undefined) await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ assistantName }));
    const { ensureDefaultAssistantCommander } = await import('./defaultAssistant');
    const first = await ensureDefaultAssistantCommander();
    const original = await readFile(first.commanderPath, 'utf8');
    expect(first).toMatchObject({ id: 'happyherd-assistant', name: 'OldBlue', workspace: os.homedir() });
    expect(original).toContain('# OldBlue\n');
    expect(original).toContain("BigBoss: the User's entry point and default manager");
    expect(original).toContain('You route work and keep the overview. You do not build.');
    expect(original).toContain('bounded, read-only inventory of temporary work directories on each reachable machine');
    expect(original).toContain("Route project-owned leftovers to that Project's PM; you own unassigned ones.");
    expect(original).toContain('Mark unreachable machines as unchecked.');
    expect(original).toContain('only after reading its report back from the destination');
    expect(await ensureDefaultAssistantCommander()).toEqual(first);
    expect(await readFile(first.commanderPath, 'utf8')).toBe(original);
    expect(await readFile(path.join(first.agentContextPath, 'memory', '1-working-memory.md'), 'utf8')).toBe('');
  });

  it.each(['River Blue', '蓝蓝'])('uses the installed name %s unchanged for the identity and definition heading', async (name) => {
    expect((await installAssistantName(name)).status).toBe(0);
    expect(JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')).assistantName).toBe(name);
    const { ensureDefaultAssistantCommander } = await import('./defaultAssistant');
    const created = await ensureDefaultAssistantCommander();
    expect(created).toMatchObject({ id: 'happyherd-assistant', name });
    expect(await readFile(created.commanderPath, 'utf8')).toContain(`# ${name}\n`);
  });

  it.each(['River "Blue"', 'River \\ Blue', 'River\nBlue', 'River\u0085Blue'])('refuses the installer name %j before writing settings', async (name) => {
    vi.stubEnv('LC_ALL', 'C');
    const result = await installAssistantName(name);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--assistant-name must not contain double quotes, backslashes, or control characters');
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    { id: 'happyherd-assistant', name: 'Owner assistant' },
    { id: 'configured-assistant', name: 'River' },
    { id: 'earlier-assistant', name: 'HappyHerd Assistant' },
  ])('preserves an existing definition and settings ($id)', async ({ id, name }) => {
    const settings = JSON.stringify({ assistantName: 'River', schemaVersion: 2 });
    await writeFile(path.join(directory, 'settings.json'), settings);
    const { createCommanderFromManifest } = await import('@/commands/commander');
    const identity = { id, name, role: 'Custom owner role', workspace: os.homedir() };
    // A pre-existing definition must not acquire the new template instructions.
    const markdown = [
      '---',
      'identity_and_scope:',
      `  commander_id: ${JSON.stringify(id)}`,
      `  name: ${JSON.stringify(name)}`,
      `  role: ${JSON.stringify(identity.role)}`,
      `  workspace: ${JSON.stringify(identity.workspace)}`,
      '---',
      `# ${name}`,
      'Owner-authored instructions remain byte-faithful.',
      '',
    ].join('\n');
    await createCommanderFromManifest({ ...identity, commanderMarkdown: markdown, workingMemoryMarkdown: 'Existing memory' });
    const { ensureDefaultAssistantCommander } = await import('./defaultAssistant');
    const { listCommanders } = await import('./commanderContext');
    const reused = await ensureDefaultAssistantCommander();
    expect(reused.id).toBe(id);
    expect((await listCommanders()).commanders).toHaveLength(1);
    expect(await readFile(reused.commanderPath, 'utf8')).toBe(markdown);
    expect(await readFile(path.join(reused.agentContextPath, 'memory', '1-working-memory.md'), 'utf8')).toBe('Existing memory');
    expect(await readFile(path.join(directory, 'settings.json'), 'utf8')).toBe(settings);
  });

  it('prefers the reserved id, then the configured name, then the earlier default name', async () => {
    await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ assistantName: 'River' }));
    const { createCommanderFromManifest } = await import('@/commands/commander');
    const { ensureDefaultAssistantCommander } = await import('./defaultAssistant');
    const { defaultAssistantCommanderMarkdown } = await import('./defaultAssistantTemplate');
    for (const identity of [
      { id: 'earlier-assistant', name: 'HappyHerd Assistant' },
      { id: 'configured-assistant', name: 'River' },
      { id: 'happyherd-assistant', name: 'Owner assistant' },
    ]) {
      const manifest = { ...identity, workspace: os.homedir(), role: 'Custom owner role' };
      await createCommanderFromManifest({ ...manifest, commanderMarkdown: defaultAssistantCommanderMarkdown(manifest) });
      expect((await ensureDefaultAssistantCommander()).id).toBe(identity.id);
    }
  });
});
