import { readFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, platform, totalmem } from 'node:os';

import {
  SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS,
  type SideChatResourceUsage,
} from '@/commands/sideChat';

type CpuSnapshot = {
  idle: number;
  total: number;
};

type MemorySnapshot = SideChatResourceUsage['memory'];

type HostResourceSamplerDependencies = {
  readCpuSnapshot: () => CpuSnapshot | null;
  sleep: (milliseconds: number) => Promise<void>;
  readLoadAverage: () => number[];
  readMemory: () => Promise<MemorySnapshot>;
  now: () => Date;
};

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readCpuSnapshot(): CpuSnapshot | null {
  const cores = cpus();
  if (cores.length === 0) return null;
  return cores.reduce<CpuSnapshot>((aggregate, core) => {
    const values = Object.values(core.times);
    return {
      idle: aggregate.idle + core.times.idle,
      total: aggregate.total + values.reduce((sum, value) => sum + value, 0),
    };
  }, { idle: 0, total: 0 });
}

function cpuBusyPercent(start: CpuSnapshot | null, end: CpuSnapshot | null): number | null {
  if (!start || !end) return null;
  const totalDelta = end.total - start.total;
  const idleDelta = end.idle - start.idle;
  if (totalDelta <= 0 || idleDelta < 0) return null;
  const busy = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.round(Math.max(0, Math.min(100, busy)) * 100) / 100;
}

function parseLinuxMemory(source: string): Partial<{
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}> {
  const values = new Map<string, number>();
  for (const line of source.split('\n')) {
    const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  return {
    ...(values.has('MemTotal') ? { totalBytes: values.get('MemTotal')! } : {}),
    ...(values.has('MemAvailable') ? { availableBytes: values.get('MemAvailable')! } : {}),
    ...(values.has('SwapTotal') ? { swapTotalBytes: values.get('SwapTotal')! } : {}),
    ...(values.has('SwapFree') ? { swapFreeBytes: values.get('SwapFree')! } : {}),
  };
}

async function readMemory(): Promise<MemorySnapshot> {
  let totalBytes = finiteNonNegative(totalmem());
  let availableBytes = finiteNonNegative(freemem());
  let swapUsedBytes: number | null = null;

  if (platform() === 'linux') {
    try {
      const linux = parseLinuxMemory(await readFile('/proc/meminfo', 'utf8'));
      totalBytes = finiteNonNegative(linux.totalBytes) ?? totalBytes;
      availableBytes = finiteNonNegative(linux.availableBytes) ?? availableBytes;
      const swapTotalBytes = finiteNonNegative(linux.swapTotalBytes);
      const swapFreeBytes = finiteNonNegative(linux.swapFreeBytes);
      if (swapTotalBytes !== null && swapFreeBytes !== null) {
        swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
      }
    } catch {
      // Node still provides portable total/free memory. Swap remains explicit
      // as unavailable when the host does not expose Linux procfs.
    }
  }

  if (totalBytes !== null && availableBytes !== null) {
    availableBytes = Math.min(totalBytes, availableBytes);
  }
  return {
    usedBytes: totalBytes === null || availableBytes === null
      ? null
      : Math.max(0, totalBytes - availableBytes),
    totalBytes,
    availableBytes,
    swapUsedBytes,
  };
}

const defaults: HostResourceSamplerDependencies = {
  readCpuSnapshot,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  // Node returns zero-filled load averages on Windows even though the metric
  // is unavailable there. Preserve the receipt contract by emitting nulls.
  readLoadAverage: () => platform() === 'win32' ? [] : loadavg(),
  readMemory,
  now: () => new Date(),
};

export function failedHostResourceUsage(sampledAt = new Date()): SideChatResourceUsage {
  return {
    status: 'failed',
    sampledAt: sampledAt.toISOString(),
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
  };
}

export async function sampleHostResourceUsage(
  overrides: Partial<HostResourceSamplerDependencies> = {},
): Promise<SideChatResourceUsage> {
  const dependencies = { ...defaults, ...overrides };
  let cpu: number | null = null;
  let load: [number | null, number | null, number | null] = [null, null, null];
  let memory: MemorySnapshot = failedHostResourceUsage().memory;

  try {
    const start = dependencies.readCpuSnapshot();
    await dependencies.sleep(SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS);
    cpu = cpuBusyPercent(start, dependencies.readCpuSnapshot());
  } catch {
    cpu = null;
  }

  try {
    const observed = dependencies.readLoadAverage();
    load = [
      finiteNonNegative(observed[0]),
      finiteNonNegative(observed[1]),
      finiteNonNegative(observed[2]),
    ];
  } catch {
    load = [null, null, null];
  }

  try {
    const observed = await dependencies.readMemory();
    memory = {
      usedBytes: finiteNonNegative(observed.usedBytes),
      totalBytes: finiteNonNegative(observed.totalBytes),
      availableBytes: finiteNonNegative(observed.availableBytes),
      swapUsedBytes: finiteNonNegative(observed.swapUsedBytes),
    };
  } catch {
    memory = failedHostResourceUsage().memory;
  }

  const values = [cpu, ...load, ...Object.values(memory)];
  const available = values.filter((value) => value !== null).length;
  const status = available === values.length
    ? 'ok'
    : available === 0 ? 'failed' : 'partial';
  return {
    status,
    sampledAt: dependencies.now().toISOString(),
    cpu: {
      busyPercent: cpu,
      sampleWindowMs: SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS,
    },
    loadAverage: {
      oneMinute: load[0],
      fiveMinutes: load[1],
      fifteenMinutes: load[2],
    },
    memory,
  };
}
