import os from 'node:os';
import type { HappyHerdCommanderSummary } from '@slopus/happy-wire';
import { listCommanders } from './commanderContext';
import { createCommanderFromManifest } from '@/commands/commander';
import { defaultAssistantCommanderMarkdown, DEFAULT_ASSISTANT_ROLE } from './defaultAssistantTemplate';

export const DEFAULT_ASSISTANT_COMMANDER_ID = 'happyherd-assistant';
export const DEFAULT_ASSISTANT_COMMANDER_NAME = 'HappyHerd Assistant';

export async function ensureDefaultAssistantCommander(): Promise<HappyHerdCommanderSummary> {
  const { commanders } = await listCommanders();
  const existing = commanders.find(item => item.id === DEFAULT_ASSISTANT_COMMANDER_ID)
    ?? commanders.find(item => item.name === DEFAULT_ASSISTANT_COMMANDER_NAME);
  if (existing) return existing;

  const identity = {
    id: DEFAULT_ASSISTANT_COMMANDER_ID,
    name: DEFAULT_ASSISTANT_COMMANDER_NAME,
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
