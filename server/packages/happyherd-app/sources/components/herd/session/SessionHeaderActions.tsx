import * as React from 'react';
import { View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { SessionActionsPopover, type SessionActionsAnchor } from '@/components/SessionActionsPopover';
import { t } from '@/text';
import { HerdHeaderButton } from './HeaderButton';

/**
 * Right side of the Web session header (UI overhaul): the Workspace toggle,
 * Side chats with its molten count, and the ⋯ session menu. The menu is the
 * existing SessionActionsPopover (same items, labels and shortcuts as the
 * session rows), anchored under the button.
 */
export function SessionHeaderActions(props: {
    sessionId: string;
    workspace?: { visible: boolean; onToggle: () => void } | null;
    sideChats?: {
        count: number;
        expanded: boolean;
        compact: boolean;
        onToggle: () => void;
    } | null;
}) {
    const menuButtonRef = React.useRef<View>(null);
    const [menuAnchor, setMenuAnchor] = React.useState<SessionActionsAnchor | null>(null);

    const openMenu = React.useCallback(() => {
        const node = menuButtonRef.current;
        if (!node) return;
        node.measureInWindow((x, y, width, height) => {
            setMenuAnchor({ type: 'rect', x, y, width, height });
        });
    }, []);
    const closeMenu = React.useCallback(() => setMenuAnchor(null), []);

    React.useEffect(() => {
        setMenuAnchor(null);
    }, [props.sessionId]);

    const sideChats = props.sideChats;
    return (
        <View style={styles.row} testID="session-header-actions">
            {props.workspace ? (
                <HerdHeaderButton
                    accessibilityLabel={t('workspace.title')}
                    active={props.workspace.visible}
                    expanded={props.workspace.visible}
                    onPress={props.workspace.onToggle}
                    renderIcon={(color) => <Octicons name="columns" size={16} color={color} />}
                    testID="session-header-workspace"
                />
            ) : null}
            {sideChats ? (
                <HerdHeaderButton
                    accessibilityLabel={sideChats.expanded
                        ? t('sideChat.collapse')
                        : sideChats.count > 0
                            ? t('sideChat.openCount', { count: sideChats.count })
                            : t('sideChat.newChat')}
                    label={sideChats.compact ? undefined : t('sideChat.panelTitle')}
                    count={sideChats.count}
                    active={sideChats.expanded}
                    expanded={sideChats.expanded}
                    onPress={sideChats.onToggle}
                    renderIcon={(color) => <Octicons name="comment-discussion" size={16} color={color} />}
                    testID="session-header-side-chats"
                />
            ) : null}
            <HerdHeaderButton
                ref={menuButtonRef}
                accessibilityLabel={t('uiCopy.session')}
                active={menuAnchor !== null}
                expanded={menuAnchor !== null}
                onPress={openMenu}
                renderIcon={(color) => <Octicons name="kebab-horizontal" size={16} color={color} />}
                testID="session-header-menu"
            />
            {/* Always mounted, so the menu can play its exit after it closes. */}
            <SessionActionsPopover
                anchor={menuAnchor}
                onClose={closeMenu}
                sessionId={props.sessionId}
                visible={menuAnchor !== null}
            />
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
}));
