import { createContext, useContext, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/** Native commands are advertised before UIKit handles a key, never cancelled after a JS round trip. */
export type NativeShortcut = {
    id: string;
    key: string;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
    scope?: 'global' | 'composer' | 'permission' | 'overlay';
    target?: string;
    allowEditable?: boolean;
    host?: string;
    requireText?: boolean;
};
export type NativeShortcutEvent = { id: string; key: string; meta: boolean; alt: boolean; shift: boolean };
export const NativeKeyboardScopeContext = createContext('');
type Registration = { commands: NativeShortcut[]; run: (id: string, event: NativeShortcutEvent) => void };
const registrations: Registration[] = [];
const listeners = new Set<() => void>();
let snapshot: NativeShortcut[] = [];
function publish() {
    // UIKit chooses the first eligible chord synchronously. Permission cards
    // keep oldest-first order; overlays keep newest-first order.
    snapshot = [
        ...registrations.slice().reverse().flatMap(({ commands }) => commands).filter(command => command.scope !== 'permission'),
        ...registrations.flatMap(({ commands }) => commands).filter(command => command.scope === 'permission'),
    ];
    listeners.forEach(listener => listener());
}
export function subscribeNativeShortcuts(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function getNativeShortcuts() { return snapshot; }
export function dispatchNativeShortcut(event: NativeShortcutEvent) {
    const { id } = event;
    const owner = registrations.slice().reverse().find(registration => registration.commands.some(command => command.id === id));
    owner?.run(id, event);
}
export function registerNativeShortcuts(commands: NativeShortcut[], run: (id: string, event: NativeShortcutEvent) => void) {
    const registration = { commands, run };
    registrations.push(registration);
    publish();
    const remove = () => {
        const index = registrations.indexOf(registration);
        if (index >= 0) registrations.splice(index, 1);
        publish();
    };
    return Object.assign(remove, {
        update(next: NativeShortcut[]) {
            // Re-rendering a pending card must not make it younger than another
            // request. A genuinely different request gets a new queue position.
            if (registration.commands[0]?.id !== next[0]?.id) {
                const index = registrations.indexOf(registration);
                if (index >= 0) registrations.splice(index, 1);
                registrations.push(registration);
            }
            registration.commands = next;
            publish();
        },
    });
}

export function useNativeShortcuts(commands: NativeShortcut[], run: (id: string, event: NativeShortcutEvent) => void) {
    const host = useContext(NativeKeyboardScopeContext);
    const runRef = useRef(run);
    runRef.current = run;
    const serialized = JSON.stringify(commands.map(command => ({ ...command, host: command.host ?? host })));
    const registration = useRef<ReturnType<typeof registerNativeShortcuts> | null>(null);
    useEffect(() => () => { registration.current?.(); registration.current = null; }, []);
    useEffect(() => {
        if (Platform.OS !== 'ios' || commands.length === 0) {
            registration.current?.();
            registration.current = null;
            return;
        }
        const next = JSON.parse(serialized) as NativeShortcut[];
        if (registration.current) registration.current.update(next);
        else registration.current = registerNativeShortcuts(next, (id, event) => runRef.current(id, event));
    }, [serialized]);
}
