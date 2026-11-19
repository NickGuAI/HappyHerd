import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CredentialProvider, CredentialPoolSelection } from '@/credentialPool/types';

export type ProviderAccountWait = {
  sessionId: string;
  provider: CredentialProvider;
  accountId?: string;
  account: string;
  incidentId: string;
  limitedUntil: number;
};

/** Durable quota waits; the daemon owns all mutations and serializes each look. */
export class ProviderAccountWaits {
  private readonly waits = new Map<string, ProviderAccountWait>();
  private readonly checking = new Set<string>();
  private readonly stopping = new Set<string>();
  private readonly changedWhileChecking = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly file: string, private readonly dependencies: {
    select: (provider: CredentialProvider) => Promise<CredentialPoolSelection>;
    recover: (wait: ProviderAccountWait, current: () => boolean) => Promise<'accepted' | 'archived' | 'failed'>;
    onError: (error: unknown) => void;
  }) {
    try {
      const entries = JSON.parse(readFileSync(file, 'utf8')) as ProviderAccountWait[];
      for (const entry of entries) this.waits.set(entry.sessionId, entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private save(): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.waits.values()]), { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  add(wait: ProviderAccountWait): void {
    this.waits.set(wait.sessionId, wait);
    this.stopping.add(wait.sessionId);
    this.save();
  }

  cancel(sessionId: string): boolean {
    if (!this.waits.delete(sessionId)) return false;
    this.stopping.delete(sessionId);
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
    this.save();
    return true;
  }

  has(sessionId: string): boolean {
    return this.waits.has(sessionId);
  }

  start(): void {
    for (const wait of this.waits.values()) void this.look(wait.sessionId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  changed(provider: CredentialProvider): void {
    for (const wait of this.waits.values()) {
      if (wait.provider === provider) void this.look(wait.sessionId);
    }
  }

  arm(sessionId: string, timestamp: number): void {
    if (!this.waits.has(sessionId)) return;
    const previous = this.timers.get(sessionId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => void this.look(sessionId), Math.min(2_147_483_647, Math.max(0, timestamp - Date.now())));
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  async look(sessionId: string): Promise<void> {
    const wait = this.waits.get(sessionId);
    if (!wait) return;
    if (this.stopping.has(sessionId)) return;
    if (this.checking.has(sessionId)) {
      this.changedWhileChecking.add(sessionId);
      return;
    }
    this.checking.add(sessionId);
    const current = () => this.waits.get(sessionId) === wait;
    try {
      const selection = await this.dependencies.select(wait.provider);
      if (!current()) return;
      if (selection.type === 'all-limited') {
        this.arm(sessionId, selection.limitedUntil);
      } else if (selection.type === 'available') {
        const result = await this.dependencies.recover(wait, current);
        if (current()) {
          if (result === 'failed') this.arm(sessionId, Date.now() + 60_000);
          else this.cancel(sessionId);
        }
      } else {
        this.cancel(sessionId);
      }
    } catch (error) {
      if (current()) this.arm(sessionId, Date.now() + 60_000);
      this.dependencies.onError(error);
    } finally {
      this.checking.delete(sessionId);
      if (this.changedWhileChecking.delete(sessionId)) void this.look(sessionId);
    }
  }

  stopped(sessionId: string): void {
    this.stopping.delete(sessionId);
    if (!this.waits.has(sessionId)) return;
    const timer = setTimeout(() => void this.look(sessionId), 0);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }
}
