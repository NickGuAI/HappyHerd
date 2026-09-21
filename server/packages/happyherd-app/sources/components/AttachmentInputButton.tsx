import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, useWindowDimensions, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { BubblePressable } from '@/components/BubblePressable';
import { t } from '@/text';
import { availableAttachmentInputActions } from './attachmentInputActions';
import { AttachmentInputMenu, type AttachmentInputMenuAnchor } from './AttachmentInputMenu';

export function AttachmentInputButton(props: {
    onPickPhotos?: () => void;
    onPickDeviceFiles?: () => void;
    active?: boolean;
    disabled?: boolean;
    color: string;
    activeColor?: string;
    size?: number;
    hitSlop?: PressableProps['hitSlop'];
    style?: StyleProp<ViewStyle> | PressableProps['style'];
}) {
    const { height: windowHeight } = useWindowDimensions();
    const anchorRef = React.useRef<View>(null);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [anchor, setAnchor] = React.useState<AttachmentInputMenuAnchor>({
        x: 12,
        y: Math.max(12, windowHeight - 52),
        width: 32,
        height: 32,
    });
    const actions = React.useMemo(() => availableAttachmentInputActions({
        photos: Boolean(props.onPickPhotos),
        deviceFiles: Boolean(props.onPickDeviceFiles),
    }), [props.onPickDeviceFiles, props.onPickPhotos]);
    const closeMenu = React.useCallback(() => setMenuVisible(false), []);
    const open = React.useCallback(() => {
        if (actions.length === 1) {
            if (actions[0] === 'photos') props.onPickPhotos?.();
            else props.onPickDeviceFiles?.();
            return;
        }

        setMenuVisible(true);
        if (Platform.OS === 'web') {
            anchorRef.current?.measureInWindow((x, y, width, height) => {
                setAnchor({ x, y, width, height });
            });
        }
    }, [actions, props.onPickDeviceFiles, props.onPickPhotos]);

    React.useEffect(() => {
        if (actions.length !== 2) closeMenu();
    }, [actions.length, closeMenu]);

    if (actions.length === 0) return null;
    return (
        <>
            <View collapsable={false} ref={anchorRef} testID="attachment-menu-anchor">
                <BubblePressable
                    onPress={open}
                    disabled={props.disabled}
                    hitSlop={props.hitSlop}
                    style={props.style}
                    accessibilityRole="button"
                    accessibilityLabel={t('happyHerd.composer.addAttachment')}
                    accessibilityState={{ expanded: actions.length === 2 ? menuVisible : undefined }}
                >
                    <Ionicons
                        name="attach-outline"
                        size={props.size ?? 20}
                        color={props.active && props.activeColor ? props.activeColor : props.color}
                    />
                </BubblePressable>
            </View>
            {actions.length === 2 && props.onPickPhotos && props.onPickDeviceFiles && (
                <AttachmentInputMenu
                    anchor={anchor}
                    onClose={closeMenu}
                    onPickDeviceFiles={props.onPickDeviceFiles}
                    onPickPhotos={props.onPickPhotos}
                    visible={menuVisible}
                />
            )}
        </>
    );
}
