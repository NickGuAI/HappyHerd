import * as React from 'react';
import type { LocalVoiceStatus } from '@happyherd/wire';
import { localVoiceStatus } from '@/sync/localVoice';
import { useMachine } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';

const REFRESH_MS = 1_500;
type Snapshot = { status: LocalVoiceStatus | null; loading: boolean; error: string | null };
type Entry = { snapshot: Snapshot; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null; fetching: boolean; generation: number };
const entries = new Map<string, Entry>();
const EMPTY: Snapshot = Object.freeze({ status: null, loading: false, error: null });

function entryFor(machineId: string): Entry {
    let entry = entries.get(machineId);
    if (!entry) {
        entry = { snapshot: EMPTY, listeners: new Set(), timer: null, fetching: false, generation: 0 };
        entries.set(machineId, entry);
    }
    return entry;
}

function publish(entry: Entry, snapshot: Snapshot) {
    entry.snapshot = snapshot;
    entry.listeners.forEach((listener) => listener());
}

async function refreshEntry(machineId: string, entry: Entry) {
    if (entry.fetching || entry.listeners.size === 0) return;
    entry.fetching = true;
    const generation = ++entry.generation;
    publish(entry, { ...entry.snapshot, loading: entry.snapshot.status === null, error: null });
    try {
        const status = await localVoiceStatus(machineId);
        if (generation === entry.generation) publish(entry, { status, loading: false, error: null });
    } catch (error) {
        if (generation === entry.generation) publish(entry, {
            status: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load local voice status',
        });
    } finally {
        if (generation === entry.generation) entry.fetching = false;
    }
}

function subscribe(machineId: string, listener: () => void) {
    const entry = entryFor(machineId);
    entry.listeners.add(listener);
    if (entry.listeners.size === 1) {
        void refreshEntry(machineId, entry);
        entry.timer = setInterval(() => void refreshEntry(machineId, entry), REFRESH_MS);
    }
    return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
            entry.generation += 1;
            entry.fetching = false;
            if (entry.timer) clearInterval(entry.timer);
            entry.timer = null;
        }
    };
}

export function useLocalVoiceStatus(machineId: string | null) {
    const machine = useMachine(machineId ?? '');
    const online = Boolean(machine && isMachineOnline(machine));
    const currentId = machineId && online ? machineId : null;
    const subscribeCurrent = React.useCallback((listener: () => void) => (
        currentId ? subscribe(currentId, listener) : () => undefined
    ), [currentId]);
    const getSnapshot = React.useCallback(() => (
        currentId ? entryFor(currentId).snapshot : EMPTY
    ), [currentId]);
    const snapshot = React.useSyncExternalStore(subscribeCurrent, getSnapshot, () => EMPTY);
    const refresh = React.useCallback(async () => {
        if (!currentId) return null;
        const entry = entryFor(currentId);
        entry.fetching = false;
        await refreshEntry(currentId, entry);
        return entry.snapshot.status;
    }, [currentId]);

    return { ...snapshot, online, refresh };
}
