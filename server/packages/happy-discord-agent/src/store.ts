import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BridgeState,
  InboundRecord,
  NormalizedDiscordMessage,
  SurfaceBinding,
} from './types';

const EMPTY_STATE: BridgeState = {
  schemaVersion: 1,
  surfaces: {},
  inbound: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseState(raw: string): BridgeState {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error('Unsupported or corrupt PMAI Discord bridge state');
  }
  if (!isRecord(parsed.surfaces) || !isRecord(parsed.inbound)) {
    throw new Error('Corrupt PMAI Discord bridge state collections');
  }
  return parsed as BridgeState;
}

async function persistAtomic(stateFile: string, stateDir: string, state: BridgeState): Promise<void> {
  const tempFile = join(stateDir, `.state-${process.pid}-${randomUUID()}.tmp`);
  const handle = await open(tempFile, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempFile, stateFile);
  await chmod(stateFile, 0o600);
  const directory = await open(stateDir, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

type InboundPatch = Partial<Omit<
  InboundRecord,
  'sourceMessageId' | 'surfaceKey' | 'channelId' | 'authorDiscordId' | 'happyLocalId' | 'createdAt'
>>;

export class BridgeStore {
  private readonly stateDir: string;
  private readonly stateFile: string;
  private state: BridgeState;
  private lock: Promise<void> = Promise.resolve();

  private constructor(stateDir: string, state: BridgeState) {
    this.stateDir = stateDir;
    this.stateFile = join(stateDir, 'bridge-state.json');
    this.state = state;
  }

  static async open(stateDir: string): Promise<BridgeStore> {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const directoryStats = await stat(stateDir);
    if (!directoryStats.isDirectory() || (directoryStats.mode & 0o077) !== 0) {
      throw new Error('PMAI bridge state directory must be a mode-0700 directory');
    }
    const stateFile = join(stateDir, 'bridge-state.json');
    let state: BridgeState;
    try {
      state = parseState(await readFile(stateFile, 'utf8'));
      const fileStats = await stat(stateFile);
      if ((fileStats.mode & 0o077) !== 0) {
        throw new Error('PMAI bridge state file must be mode 0600');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      state = structuredClone(EMPTY_STATE);
      await persistAtomic(stateFile, stateDir, state);
    }
    return new BridgeStore(stateDir, state);
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    let release: () => void = () => {};
    const previous = this.lock;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const result = operation();
      await persistAtomic(this.stateFile, this.stateDir, this.state);
      return structuredClone(result);
    } finally {
      release();
    }
  }

  getInbound(sourceMessageId: string): InboundRecord | null {
    const record = this.state.inbound[sourceMessageId];
    return record ? structuredClone(record) : null;
  }

  getSurface(surfaceKey: string): SurfaceBinding | null {
    const binding = this.state.surfaces[surfaceKey];
    return binding ? structuredClone(binding) : null;
  }

  hasChannelBinding(channelId: string): boolean {
    return Object.values(this.state.surfaces).some((binding) => binding.channelId === channelId);
  }

  listRecoverable(): InboundRecord[] {
    return Object.values(this.state.inbound)
      .filter((record) => ['claimed', 'turn-pending', 'answer-ready', 'delivering'].includes(record.status))
      .map((record) => structuredClone(record));
  }

  async claimInbound(message: NormalizedDiscordMessage): Promise<{
    duplicate: boolean;
    record: InboundRecord;
  }> {
    const existing = this.state.inbound[message.sourceMessageId];
    if (existing) {
      return { duplicate: true, record: structuredClone(existing) };
    }
    return this.mutate(() => {
      const raced = this.state.inbound[message.sourceMessageId];
      if (raced) {
        return { duplicate: true, record: raced };
      }
      const now = Date.now();
      const record: InboundRecord = {
        sourceMessageId: message.sourceMessageId,
        surfaceKey: message.surfaceKey,
        channelId: message.channelId,
        authorDiscordId: message.authorDiscordId,
        status: 'claimed',
        happySessionId: null,
        happyLocalId: `discord:${message.sourceMessageId}`,
        baselineSequence: null,
        turnId: null,
        answerHash: null,
        replyMessageIds: [],
        failureReference: null,
        createdAt: now,
        updatedAt: now,
      };
      this.state.inbound[message.sourceMessageId] = record;
      return { duplicate: false, record };
    });
  }

  async updateInbound(sourceMessageId: string, patch: InboundPatch): Promise<InboundRecord> {
    return this.mutate(() => {
      const current = this.state.inbound[sourceMessageId];
      if (!current) {
        throw new Error(`Inbound record ${sourceMessageId} does not exist`);
      }
      const next: InboundRecord = {
        ...current,
        ...patch,
        updatedAt: Date.now(),
      };
      this.state.inbound[sourceMessageId] = next;
      return next;
    });
  }

  async bindSurface(binding: SurfaceBinding): Promise<SurfaceBinding> {
    return this.mutate(() => {
      const current = this.state.surfaces[binding.surfaceKey];
      if (current) {
        if (
          current.surfaceKind === 'dm'
          && current.pmaiUserId !== null
          && binding.pmaiUserId !== current.pmaiUserId
        ) {
          throw new Error('A Discord DM surface cannot change its linked PMAI actor');
        }
        const merged: SurfaceBinding = {
          ...current,
          ...binding,
          capabilityId: current.capabilityId,
          createdAt: current.createdAt,
          updatedAt: Date.now(),
        };
        this.state.surfaces[binding.surfaceKey] = merged;
        return merged;
      }
      this.state.surfaces[binding.surfaceKey] = binding;
      return binding;
    });
  }
}
