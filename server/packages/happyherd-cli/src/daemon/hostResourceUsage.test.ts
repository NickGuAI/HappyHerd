import { describe, expect, it, vi } from 'vitest';

import { SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS } from '@/commands/sideChat';
import { sampleHostResourceUsage } from './hostResourceUsage';

describe('sampleHostResourceUsage', () => {
  it('samples CPU over the documented window and reports load, RAM, and swap', async () => {
    const sleep = vi.fn(async () => undefined);
    const readCpuSnapshot = vi.fn()
      .mockReturnValueOnce({ idle: 100, total: 500 })
      .mockReturnValueOnce({ idle: 120, total: 600 });

    await expect(sampleHostResourceUsage({
      readCpuSnapshot,
      sleep,
      readLoadAverage: () => [0.25, 0.5, 0.75],
      readMemory: async () => ({
        usedBytes: 8 * 1024 ** 3,
        totalBytes: 16 * 1024 ** 3,
        availableBytes: 8 * 1024 ** 3,
        swapUsedBytes: 2 * 1024 ** 3,
      }),
      now: () => new Date('2026-09-03T10:00:00.000Z'),
    })).resolves.toEqual({
      status: 'ok',
      sampledAt: '2026-09-03T10:00:00.000Z',
      cpu: {
        busyPercent: 80,
        sampleWindowMs: SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS,
      },
      loadAverage: {
        oneMinute: 0.25,
        fiveMinutes: 0.5,
        fifteenMinutes: 0.75,
      },
      memory: {
        usedBytes: 8 * 1024 ** 3,
        totalBytes: 16 * 1024 ** 3,
        availableBytes: 8 * 1024 ** 3,
        swapUsedBytes: 2 * 1024 ** 3,
      },
    });
    expect(sleep).toHaveBeenCalledWith(SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS);
    expect(readCpuSnapshot).toHaveBeenCalledTimes(2);
  });

  it('marks a partially available host sample without substituting zeroes', async () => {
    await expect(sampleHostResourceUsage({
      readCpuSnapshot: () => null,
      sleep: async () => undefined,
      readLoadAverage: () => [1, 2, 3],
      readMemory: async () => ({
        usedBytes: 4,
        totalBytes: 10,
        availableBytes: 6,
        swapUsedBytes: null,
      }),
      now: () => new Date('2026-09-03T10:01:00.000Z'),
    })).resolves.toMatchObject({
      status: 'partial',
      cpu: { busyPercent: null },
      loadAverage: { oneMinute: 1, fiveMinutes: 2, fifteenMinutes: 3 },
      memory: { usedBytes: 4, totalBytes: 10, availableBytes: 6, swapUsedBytes: null },
    });
  });

  it('keeps unavailable load averages null instead of inventing zeroes', async () => {
    await expect(sampleHostResourceUsage({
      readCpuSnapshot: vi.fn()
        .mockReturnValueOnce({ idle: 100, total: 500 })
        .mockReturnValueOnce({ idle: 120, total: 600 }),
      sleep: async () => undefined,
      readLoadAverage: () => [],
      readMemory: async () => ({
        usedBytes: 4,
        totalBytes: 10,
        availableBytes: 6,
        swapUsedBytes: 1,
      }),
      now: () => new Date('2026-09-03T10:01:30.000Z'),
    })).resolves.toMatchObject({
      status: 'partial',
      loadAverage: { oneMinute: null, fiveMinutes: null, fifteenMinutes: null },
    });
  });

  it('returns an explicit failed sample when no metric source is available', async () => {
    await expect(sampleHostResourceUsage({
      readCpuSnapshot: () => { throw new Error('cpu unavailable'); },
      sleep: async () => undefined,
      readLoadAverage: () => { throw new Error('load unavailable'); },
      readMemory: async () => { throw new Error('memory unavailable'); },
      now: () => new Date('2026-09-03T10:02:00.000Z'),
    })).resolves.toEqual({
      status: 'failed',
      sampledAt: '2026-09-03T10:02:00.000Z',
      cpu: {
        busyPercent: null,
        sampleWindowMs: SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS,
      },
      loadAverage: {
        oneMinute: null,
        fiveMinutes: null,
        fifteenMinutes: null,
      },
      memory: {
        usedBytes: null,
        totalBytes: null,
        availableBytes: null,
        swapUsedBytes: null,
      },
    });
  });
});
