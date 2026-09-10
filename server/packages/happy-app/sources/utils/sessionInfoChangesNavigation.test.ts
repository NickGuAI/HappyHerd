import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers';
import { describe, expect, it } from 'vitest';

import { findMountedSessionRouteTarget } from './sessionInfoChangesNavigation';

const routeNames = ['session/[id]', 'session/[id]/info'];
const router = StackRouter({ initialRouteName: 'session/[id]' });
const routerOptions = {
    routeNames,
    routeParamList: {},
    routeGetIdList: {},
};

function stackState(routes: Array<{ key: string; name: string; params: Record<string, string> }>) {
    return {
        stale: false as const,
        type: 'stack' as const,
        key: 'app-stack',
        index: routes.length - 1,
        routeNames,
        routes,
        preloadedRoutes: [],
    };
}

function requestChangesAndPop(
    initial: ReturnType<typeof stackState>,
    target: { routeKey: string; popCount: number },
    requestId: string,
) {
    const requested = router.getStateForAction(initial, {
        ...CommonActions.setParams({ openChangesRequestId: requestId }),
        source: target.routeKey,
    }, routerOptions);
    if (!requested || requested.stale !== false) {
        throw new Error('Expected a complete stack state after setting route params');
    }
    const returned = router.getStateForAction(requested, {
        ...StackActions.pop(target.popCount),
        source: initial.routes[initial.index].key,
    }, routerOptions);
    if (!returned || returned.stale !== false) {
        throw new Error('Expected a complete stack state after returning to the session');
    }
    return returned;
}

describe('Session Info Changes navigation', () => {
    it('returns to an adjacent mounted session route without changing its key', () => {
        const initial = stackState([
            { key: 'session-parent-key', name: 'session/[id]', params: { id: 'parent' } },
            { key: 'info-parent-key', name: 'session/[id]/info', params: { id: 'parent' } },
        ]);
        const target = findMountedSessionRouteTarget(initial, 'parent');
        expect(target).toEqual({ routeKey: 'session-parent-key', popCount: 1 });

        const returned = requestChangesAndPop(initial, target!, 'request-one');
        expect(returned.routes).toHaveLength(1);
        expect(returned.routes[0]).toMatchObject({
            key: 'session-parent-key',
            name: 'session/[id]',
            params: { id: 'parent', openChangesRequestId: 'request-one' },
        });
    });

    it('pops directly to a non-adjacent exact-owner route and preserves its key', () => {
        const initial = stackState([
            { key: 'session-child-key', name: 'session/[id]', params: { id: 'child' } },
            { key: 'session-parent-key', name: 'session/[id]', params: { id: 'parent' } },
            { key: 'info-child-key', name: 'session/[id]/info', params: { id: 'child' } },
        ]);
        const target = findMountedSessionRouteTarget(initial, 'child');
        expect(target).toEqual({ routeKey: 'session-child-key', popCount: 2 });

        const returned = requestChangesAndPop(initial, target!, 'request-child');
        expect(returned.routes).toHaveLength(1);
        expect(returned.routes[0]).toMatchObject({
            key: 'session-child-key',
            name: 'session/[id]',
            params: { id: 'child', openChangesRequestId: 'request-child' },
        });
    });

    it('replaces Side chat Info with one exact-owner session route when none is mounted', () => {
        const initial = stackState([
            { key: 'session-parent-key', name: 'session/[id]', params: { id: 'parent' } },
            { key: 'info-side-key', name: 'session/[id]/info', params: { id: 'side-chat' } },
        ]);
        expect(findMountedSessionRouteTarget(initial, 'side-chat')).toBeNull();

        const replaced = router.getStateForAction(initial, {
            ...StackActions.replace('session/[id]', {
                id: 'side-chat',
                openChangesRequestId: 'request-side',
            }),
            source: 'info-side-key',
        }, routerOptions)!;

        expect(replaced.routes).toHaveLength(2);
        expect(replaced.routes[0]).toMatchObject({ key: 'session-parent-key', params: { id: 'parent' } });
        expect(replaced.routes[1]).toMatchObject({
            name: 'session/[id]',
            params: { id: 'side-chat', openChangesRequestId: 'request-side' },
        });
        expect(replaced.routes.some((route) => route.key === 'info-side-key')).toBe(false);
    });
});
