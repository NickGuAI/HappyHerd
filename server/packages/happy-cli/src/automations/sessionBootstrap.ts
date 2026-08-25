import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  HAPPYHERD_AUTOMATION_DEFAULT_TIMEOUT_MINUTES,
  HappyHerdAutomationKindSchema,
  HappyHerdAutomationTimeoutMinutesSchema,
} from '@slopus/happy-wire';
import * as z from 'zod';

import { configuration } from '@/configuration';

const BootstrapSchema = z.object({
  schemaVersion: z.literal(1),
  automationId: z.string().uuid(),
  runId: z.string().uuid(),
  kind: HappyHerdAutomationKindSchema,
  instruction: z.string().trim().min(1).max(100_000),
  timeoutMinutes: HappyHerdAutomationTimeoutMinutesSchema.default(
    HAPPYHERD_AUTOMATION_DEFAULT_TIMEOUT_MINUTES,
  ),
}).strict();

export type HappyHerdAutomationBootstrap = z.infer<typeof BootstrapSchema>;
type HappyHerdAutomationBootstrapInput = z.input<typeof BootstrapSchema>;

export interface AutomationBootstrapReference {
  automationId: string;
  runId: string;
  kind: HappyHerdAutomationBootstrap['kind'];
  timeoutMinutes: number;
  path: string;
  hash: string;
}

function bootstrapRoot(): string {
  return path.join(configuration.happyHomeDir, 'automations', 'bootstrap');
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

export async function prepareAutomationBootstrap(
  value: HappyHerdAutomationBootstrapInput,
): Promise<AutomationBootstrapReference> {
  const bootstrap = BootstrapSchema.parse(value);
  const serialized = `${JSON.stringify(bootstrap, null, 2)}\n`;
  const hash = createHash('sha256').update(serialized).digest('hex');
  const filePath = path.join(bootstrapRoot(), `${hash}.json`);
  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeJsonAtomic(filePath, bootstrap);
  }
  return {
    automationId: bootstrap.automationId,
    runId: bootstrap.runId,
    kind: bootstrap.kind,
    timeoutMinutes: bootstrap.timeoutMinutes,
    path: filePath,
    hash,
  };
}

export function automationBootstrapEnvironment(reference: AutomationBootstrapReference): Record<string, string> {
  return {
    HAPPYHERD_AUTOMATION_ID: reference.automationId,
    HAPPYHERD_AUTOMATION_RUN_ID: reference.runId,
    HAPPYHERD_AUTOMATION_KIND: reference.kind,
    HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES: String(reference.timeoutMinutes),
    HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH: reference.path,
    HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH: reference.hash,
  };
}

export async function readAutomationBootstrapFromEnvironment(): Promise<HappyHerdAutomationBootstrap | null> {
  const filePath = process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH;
  const expectedHash = process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH;
  if (!filePath && !expectedHash) return null;
  if (!filePath || !expectedHash) throw new Error('HappyHerd automation bootstrap reference is incomplete');
  const serialized = await readFile(filePath, 'utf8');
  const actualHash = createHash('sha256').update(serialized).digest('hex');
  if (actualHash !== expectedHash) throw new Error('HappyHerd automation bootstrap failed integrity validation');
  const bootstrap = BootstrapSchema.parse(JSON.parse(serialized));
  if (process.env.HAPPYHERD_AUTOMATION_ID !== bootstrap.automationId) {
    throw new Error('HappyHerd automation bootstrap id does not match the session environment');
  }
  if (process.env.HAPPYHERD_AUTOMATION_RUN_ID !== bootstrap.runId) {
    throw new Error('HappyHerd automation bootstrap run id does not match the session environment');
  }
  if (process.env.HAPPYHERD_AUTOMATION_KIND !== bootstrap.kind) {
    throw new Error('HappyHerd automation bootstrap kind does not match the session environment');
  }
  const timeoutValue = process.env.HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES;
  if (timeoutValue !== undefined) {
    const timeout = /^\d+$/.test(timeoutValue)
      ? HappyHerdAutomationTimeoutMinutesSchema.safeParse(Number(timeoutValue))
      : { success: false as const };
    if (!timeout.success || timeout.data !== bootstrap.timeoutMinutes) {
      throw new Error('HappyHerd automation bootstrap timeout does not match the session environment');
    }
  } else if (bootstrap.timeoutMinutes !== HAPPYHERD_AUTOMATION_DEFAULT_TIMEOUT_MINUTES) {
    throw new Error('HappyHerd automation bootstrap timeout reference is incomplete');
  }
  return bootstrap;
}

export function automationMetadataFromEnvironment(): {
  automationId?: string;
  automationRunId?: string;
  automationKind?: HappyHerdAutomationBootstrap['kind'];
  automationTimeoutMinutes?: number;
} {
  const id = z.string().uuid().safeParse(process.env.HAPPYHERD_AUTOMATION_ID);
  const runId = z.string().uuid().safeParse(process.env.HAPPYHERD_AUTOMATION_RUN_ID);
  const kind = HappyHerdAutomationKindSchema.safeParse(process.env.HAPPYHERD_AUTOMATION_KIND);
  const timeoutValue = process.env.HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES;
  const timeout = timeoutValue && /^\d+$/.test(timeoutValue)
    ? HappyHerdAutomationTimeoutMinutesSchema.safeParse(Number(timeoutValue))
    : { success: false as const };
  return {
    ...(id.success ? { automationId: id.data } : {}),
    ...(runId.success ? { automationRunId: runId.data } : {}),
    ...(kind.success ? { automationKind: kind.data } : {}),
    ...(timeout.success ? { automationTimeoutMinutes: timeout.data } : {}),
  };
}
