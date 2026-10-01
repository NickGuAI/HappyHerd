import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { Stack, Slot, useLocalSearchParams, useRouter, useNavigationContainerRef } from 'expo-router';
import { navigateToSession } from '@/hooks/useNavigateToSession';

// Real installed ExpoRoot discovers these modules exactly like a require.context.
// Neither the router, navigation reducers nor browser history is mocked.
const mounted = new Set<object>();
function Probe() {
    const navigation = useNavigationContainerRef();
    React.useEffect(() => { (window as any).__readRealRouterState = () => navigation.getRootState(); }, [navigation]);
    return null;
}
function Layout() { return <><Probe /><Slot /></>; }
function AppLayout() { return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />; }
function OpenButtons() {
    const router = useRouter();
    return <nav>{['A', 'B', 'C'].map(id => <button key={id} onClick={() => navigateToSession(router, id)}>Open {id}</button>)}</nav>;
}
function Home() { return <main data-testid="router-home"><OpenButtons />Home</main>; }
function Session() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const identity = React.useRef({});
    React.useEffect(() => {
        mounted.add(identity.current);
        (window as any).__mountedSessionRoutes = mounted.size;
        return () => { mounted.delete(identity.current); (window as any).__mountedSessionRoutes = mounted.size; };
    }, []);
    return <main data-testid="session-route" data-session-id={id}><OpenButtons />Session {id}</main>;
}
const modules: Record<string, object> = {
    './_layout.tsx': { default: Layout },
    './(app)/_layout.tsx': { default: AppLayout, unstable_settings: { initialRouteName: 'index' } },
    './(app)/index.tsx': { default: Home },
    './(app)/session/[id].tsx': { default: Session },
};
const context = Object.assign((name: string) => modules[name], {
    keys: () => Object.keys(modules), resolve: (name: string) => name, id: 'issue370-real-expo-router',
});
createRoot(document.getElementById('root')!).render(<ExpoRoot context={context as any} />);
