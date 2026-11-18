import os from 'node:os';
import { readSettings } from '@/persistence';
import type { HappyHerdCommanderSummary } from '@happyherd/wire';
import { agentContextRoot, listCommanders } from './commanderContext';
import { ensureSharedKnowledge } from './sharedKnowledge';
import { createCommanderFromManifest } from '@/commands/commander';
import { defaultAssistantCommanderMarkdown, DEFAULT_ASSISTANT_ROLE } from './defaultAssistantTemplate';

export const DEFAULT_ASSISTANT_COMMANDER_ID = 'happyherd-assistant';
export const DEFAULT_ASSISTANT_COMMANDER_NAME = 'OldBlue';

export async function ensureDefaultAssistantCommander(): Promise<HappyHerdCommanderSummary> {
  await ensureSharedKnowledge(agentContextRoot());
  const name = (await readSettings()).assistantName?.trim() || DEFAULT_ASSISTANT_COMMANDER_NAME;
  const { commanders } = await listCommanders();
  const existing = commanders.find(item => item.id === DEFAULT_ASSISTANT_COMMANDER_ID)
    ?? commanders.find(item => item.name === name)
    ?? commanders.find(item => item.name === 'HappyHerd Assistant');
  if (existing) return existing;

  const identity = {
    id: DEFAULT_ASSISTANT_COMMANDER_ID,
    name,
    workspace: os.homedir(),
    role: DEFAULT_ASSISTANT_ROLE,
  };
  await createCommanderFromManifest({
    ...identity,
    commanderMarkdown: defaultAssistantCommanderMarkdown(identity),
  });
  const created = (await listCommanders()).commanders.find(item => item.id === identity.id);
  if (!created) throw new Error('Default Assistant Commander was not registered');
  return created;
}
