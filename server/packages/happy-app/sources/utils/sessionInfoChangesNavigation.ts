type SessionInfoStackRoute = {
    key: string;
    name: string;
    params?: Readonly<object>;
};

export type MountedSessionRouteTarget = {
    routeKey: string;
    popCount: number;
};

export function findMountedSessionRouteTarget(
    state: { index: number; routes: readonly SessionInfoStackRoute[] } | undefined,
    sessionId: string,
): MountedSessionRouteTarget | null {
    if (!state) return null;
    for (let index = state.index - 1; index >= 0; index -= 1) {
        const route = state.routes[index];
        const routeSessionId = (route?.params as { id?: unknown } | undefined)?.id;
        if (route?.name === 'session/[id]' && routeSessionId === sessionId) {
            return {
                routeKey: route.key,
                popCount: state.index - index,
            };
        }
    }
    return null;
}
