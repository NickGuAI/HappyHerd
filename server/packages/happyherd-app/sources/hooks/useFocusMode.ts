import * as React from 'react';
import { AppState } from 'react-native';
import { useSetting } from '@/sync/storage';
import { getActiveFocusMode } from '@/sync/focusMode';

/** The stored end time is authoritative; expiry never writes over another device's timer. */
export function useFocusMode() {
    const stored = useSetting('focusMode') ?? null;
    const [, refresh] = React.useReducer((value: number) => value + 1, 0);

    React.useEffect(() => {
        if (!stored || stored.endsAt <= Date.now()) return;
        const timeout = setTimeout(refresh, Math.min(stored.endsAt - Date.now(), 2_147_483_647));
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') refresh();
        });
        return () => {
            clearTimeout(timeout);
            subscription.remove();
        };
    }, [stored]);

    return getActiveFocusMode(stored);
}
