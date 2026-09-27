import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/**
 * Resize grip of a panel divider (UI overhaul, mock `.rpanel-grip` and
 * `.split-grip`): a hairline pill centred on the border of the pane to its
 * right, which lengthens and turns molten while hovered or dragged. The
 * divider around it keeps its hit area and pointer handling.
 */
export function HerdPanelGrip(props: {
    active: boolean;
    /** The border is the divider's own last pixel rather than the next pane's first. */
    lineInside?: boolean;
}) {
    return (
        <View
            pointerEvents="none"
            style={[styles.pill, props.lineInside && styles.pillInside, props.active && styles.pillActive]}
            testID="herd-panel-grip"
            aria-hidden
        />
    );
}

const styles = StyleSheet.create((theme) => ({
    pill: {
        position: 'absolute',
        top: '50%',
        // Centred on the 1 px border at the divider's right edge.
        right: -2,
        width: 3,
        height: 48,
        marginTop: -24,
        borderRadius: 2,
        backgroundColor: theme.colors.divider,
        _web: {
            transition: `height ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}, margin-top ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}, background-color ${theme.kilv.motionFast}ms ${theme.kilv.easeOut}`,
        },
    },
    pillInside: {
        right: -1,
    },
    pillActive: {
        height: 80,
        marginTop: -40,
        backgroundColor: theme.colors.kilv.accent,
    },
}));
