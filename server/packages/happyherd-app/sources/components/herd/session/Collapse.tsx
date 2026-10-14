import * as React from 'react';
import { Platform, View } from 'react-native';
import { HerdCollapse as NativeCollapse } from '../pages/HerdCollapse';
import { StyleSheet } from 'react-native-unistyles';

/**
 * Smooth-height disclosure body (UI overhaul). On web the content stays
 * mounted inside a CSS grid whose single row animates between `0fr` and `1fr`,
 * so the height follows the real content without measuring it. The body mounts
 * on first open and is kept afterwards, which keeps collapsed rows cheap and
 * lets a closing body animate out. A collapsed body is `inert`, so keyboard
 * focus cannot enter it. Native reuses the measured-height disclosure used by native pages.
 */
export function HerdCollapse(props: {
    open: boolean;
    children: React.ReactNode;
    testID?: string;
}) {
    const { open } = props;
    const [mounted, setMounted] = React.useState(open);
    const [expanded, setExpanded] = React.useState(open);
    const outerRef = React.useRef<View>(null);

    React.useLayoutEffect(() => {
        const node = outerRef.current as unknown as HTMLElement | null;
        if (Platform.OS !== 'web' || !node?.setAttribute) return;
        if (open) node.removeAttribute('inert');
        else node.setAttribute('inert', '');
    }, [open, mounted]);

    React.useEffect(() => {
        if (!open) {
            setExpanded(false);
            return;
        }
        setMounted(true);
        if (Platform.OS !== 'web' || typeof requestAnimationFrame !== 'function') {
            setExpanded(true);
            return;
        }
        // Paint the collapsed row once so the grid transition has a start state.
        const frame = requestAnimationFrame(() => setExpanded(true));
        return () => cancelAnimationFrame(frame);
    }, [open]);

    if (Platform.OS !== 'web') {
        return (
            <View pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
                <NativeCollapse open={open} testID={props.testID}>{props.children}</NativeCollapse>
            </View>
        );
    }
    if (!mounted) return null;

    return (
        <View
            ref={outerRef}
            testID={props.testID}
            aria-hidden={!expanded}
            style={[styles.outer, expanded && styles.outerOpen]}
        >
            <View style={styles.inner}>
                {props.children}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    outer: {
        _web: {
            display: 'grid',
            gridTemplateRows: '0fr',
            opacity: 0,
            transition: `grid-template-rows ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}, opacity ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
        },
    },
    outerOpen: {
        _web: {
            gridTemplateRows: '1fr',
            opacity: 1,
        },
    },
    inner: {
        minHeight: 0,
        overflow: 'hidden',
    },
}));
