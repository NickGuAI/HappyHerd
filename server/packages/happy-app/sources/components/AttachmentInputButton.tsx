import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';

import { BubblePressable } from '@/components/BubblePressable';
import { Modal } from '@/modal';
import { t } from '@/text';
import { availableAttachmentInputActions } from './attachmentInputActions';

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
    const actions = availableAttachmentInputActions({
        photos: !!props.onPickPhotos,
        deviceFiles: !!props.onPickDeviceFiles,
    });
    const open = React.useCallback(() => {
        if (actions.length === 1) {
            if (actions[0] === 'photos') props.onPickPhotos?.();
            else props.onPickDeviceFiles?.();
            return;
        }
        Modal.alert(t('happyHerd.composer.addAttachment'), undefined, [
            ...(props.onPickPhotos ? [{ text: t('happyHerd.composer.photos'), onPress: props.onPickPhotos }] : []),
            ...(props.onPickDeviceFiles ? [{ text: t('happyHerd.composer.deviceFiles'), onPress: props.onPickDeviceFiles }] : []),
            { text: t('common.cancel'), style: 'cancel' as const },
        ]);
    }, [actions, props.onPickDeviceFiles, props.onPickPhotos]);

    if (actions.length === 0) return null;
    return (
        <BubblePressable
            onPress={open}
            disabled={props.disabled}
            hitSlop={props.hitSlop}
            style={props.style}
            accessibilityRole="button"
            accessibilityLabel={t('happyHerd.composer.addAttachment')}
        >
            <Ionicons
                name="attach-outline"
                size={props.size ?? 20}
                color={props.active && props.activeColor ? props.activeColor : props.color}
            />
        </BubblePressable>
    );
}
