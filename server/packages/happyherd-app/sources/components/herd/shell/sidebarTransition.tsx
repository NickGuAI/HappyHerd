import * as React from 'react';
import { Animated, Platform, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { HERD_MOTION, herdWebClasses } from '../motion';

export type HerdSidebarPhase = 'idle' | 'entering' | 'exiting';

/** How long the panel's content takes to leave before its width snaps shut (`.herd-exit-left`). */
export const HERD_SIDEBAR_EXIT_MS = 180;

/**
 * Sequences the desktop panel's collapse without animating its width.
 *
 * Animating the drawer width re-flows the chat beside it on every frame, so
 * the width still changes in one step. Collapsing lets the content slide out
 * first and then snaps the width; expanding snaps the width open and lets the
 * content slide in. Reduced-motion users get the snap alone.
 */
export function useHerdSidebarTransition(hidden: boolean): { widthHidden: boolean; phase: HerdSidebarPhase } {
    const reduceMotion = useReducedMotion();
    const animate = !reduceMotion;
    const [state, setState] = React.useState<{ widthHidden: boolean; phase: HerdSidebarPhase }>(
        () => ({ widthHidden: hidden, phase: 'idle' }),
    );
    const firstRun = React.useRef(true);

    React.useEffect(() => {
        if (firstRun.current) {
            firstRun.current = false;
            return;
        }
        if (!animate) {
            setState({ widthHidden: hidden, phase: 'idle' });
            return;
        }
        if (hidden) {
            setState((current) => current.widthHidden ? current : { widthHidden: false, phase: 'exiting' });
            const timer = setTimeout(() => setState({ widthHidden: true, phase: 'idle' }), HERD_SIDEBAR_EXIT_MS);
            return () => clearTimeout(timer);
        }
        setState({ widthHidden: false, phase: 'entering' });
        const timer = setTimeout(() => setState({ widthHidden: false, phase: 'idle' }), HERD_MOTION.slow);
        return () => clearTimeout(timer);
    }, [animate, hidden]);

    return state;
}

export const HerdSidebarPhaseContext = React.createContext<HerdSidebarPhase>('idle');

/** Wraps the panel's content so it plays the phase the navigator publishes. */
export function HerdSidebarFrame({ children }: { children: React.ReactNode }) {
    const phase = React.useContext(HerdSidebarPhaseContext);
    return Platform.OS === 'web'
        ? <View style={styles.frame(phase)}>{children}</View>
        : <NativeSidebarFrame phase={phase}>{children}</NativeSidebarFrame>;
}

function NativeSidebarFrame({ phase, children }: { phase: HerdSidebarPhase; children: React.ReactNode }) {
    const reduceMotion = useReducedMotion();
    const progress = React.useRef(new Animated.Value(1)).current;
    React.useEffect(() => {
        if (reduceMotion || phase === 'idle') {
            progress.setValue(1);
            return;
        }
        if (phase === 'entering') progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: phase === 'exiting' ? 0 : 1,
            duration: phase === 'exiting' ? HERD_SIDEBAR_EXIT_MS : HERD_MOTION.slow,
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [phase, progress, reduceMotion]);
    return <Animated.View style={{ flex: 1, opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] }}>{children}</Animated.View>;
}

const styles = StyleSheet.create(() => ({
    frame: (phase: HerdSidebarPhase) => ({
        flex: 1,
        _web: {
            _classNames: herdWebClasses(
                phase === 'exiting' && 'herd-exit-left',
                phase === 'entering' && 'herd-slide-left',
            ),
        },
    }),
}));
