import * as React from 'react';
import { machineBash } from './ops';
import { storage, useMachine } from './storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { normalizeMachinePath } from '@/utils/normalizeMachinePath';

export type GithubRepositoryStatus = 'github' | 'git' | 'none' | 'unknown';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DETECTION_TIMEOUT_MS = 6_000;
const cache = new Map<string, { status: GithubRepositoryStatus; expiresAt: number }>();
const pending = new Map<string, Promise<GithubRepositoryStatus>>();

/** Paths travel only as RPC cwd; '/' needs a fixed -C because the handler treats that cwd as its default. */
function detectionCommand(path: string): string {
    return path === '/'
        ? 'git -C / rev-parse --is-inside-work-tree && git -C / remote -v'
        : 'git rev-parse --is-inside-work-tree && git remote -v';
}

function isGithubRemote(remote: string): boolean {
    if (/^(?:[^@/:\s]+@)?github\.com:.+$/i.test(remote)) return true;
    try {
        const url = new URL(remote);
        return ['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)
            && url.hostname.toLowerCase() === 'github.com';
    } catch {
        return false;
    }
}

async function queryRepository(machineId: string, path: string): Promise<GithubRepositoryStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            machineBash(machineId, detectionCommand(path), path),
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DETECTION_TIMEOUT_MS); }),
        ]);
        // The bash handler returns success:false with the command's numeric exit code.
        if (result?.exitCode === 128) return 'none';
        if (!result?.success || result.exitCode !== 0) return 'unknown';
        const [inside, ...remotes] = result.stdout.trim().split(/\r?\n/);
        if (inside === 'false') return 'none';
        if (inside !== 'true') return 'unknown';
        let github = false;
        for (const line of remotes) {
            if (!line) continue;
            const remote = /^\S+\s+(.+?)\s+\((?:fetch|push)\)$/.exec(line)?.[1];
            if (!remote) return 'unknown';
            if (isGithubRemote(remote)) github = true;
        }
        return github ? 'github' : 'git';
    } catch {
        return 'unknown';
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/**
 * Detects local Git state only, without contacting GitHub. Unknown means no
 * automatic worktree. Results and in-flight requests are scoped to exact
 * machine/path identity; an offline target never inherits a cached success.
 */
export async function detectGithubRepository(machineId: string, path: string): Promise<GithubRepositoryStatus> {
    const machine = storage.getState().machines[machineId];
    const normalizedPath = normalizeMachinePath(path, machine?.metadata?.homeDir);
    if (!machine || !isMachineOnline(machine) || !normalizedPath) return 'unknown';
    const key = JSON.stringify([machineId, normalizedPath]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.status;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const request = queryRepository(machineId, normalizedPath).then((status) => {
        const latestMachine = storage.getState().machines[machineId];
        const currentStatus = latestMachine && isMachineOnline(latestMachine) ? status : 'unknown';
        cache.set(key, { status: currentStatus, expiresAt: Date.now() + CACHE_TTL_MS });
        return currentStatus;
    }).finally(() => { pending.delete(key); });
    pending.set(key, request);
    return request;
}

/** Ignores stale RPC replies and immediately clears a prior folder's classification. */
export function useGithubRepository(machineId: string | null | undefined, path: string | null | undefined): {
    status: GithubRepositoryStatus;
    loading: boolean;
} {
    const machine = useMachine(machineId ?? '');
    const normalizedPath = path ? normalizeMachinePath(path, machine?.metadata?.homeDir) : null;
    const online = Boolean(machine && isMachineOnline(machine));
    const target = online && machineId && normalizedPath ? JSON.stringify([machineId, normalizedPath]) : null;
    const [result, setResult] = React.useState<{ target: string | null; status: GithubRepositoryStatus }>({ target: null, status: 'unknown' });

    React.useEffect(() => {
        if (!target || !machineId || !normalizedPath) {
            setResult({ target: null, status: 'unknown' });
            return;
        }
        let cancelled = false;
        detectGithubRepository(machineId, normalizedPath).then((status) => {
            if (!cancelled) setResult({ target, status });
        });
        return () => { cancelled = true; };
    }, [target, machineId, normalizedPath]);

    return {
        status: target && result.target === target ? result.status : 'unknown',
        loading: target !== null && result.target !== target,
    };
}
