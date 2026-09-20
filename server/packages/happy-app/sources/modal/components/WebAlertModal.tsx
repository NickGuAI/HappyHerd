import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { BaseModal } from './BaseModal';
import { AlertModalConfig, ConfirmModalConfig } from '../types';
import { Typography } from '@/constants/Typography';
import { StyleSheet } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { MobileGlassSurface } from '@/components/MobileGlass';
import { t } from '@/text';

interface WebAlertModalProps {
    config: AlertModalConfig | ConfirmModalConfig;
    onClose: () => void;
    onConfirm?: (value: boolean) => void;
}

export function WebAlertModal({ config, onClose, onConfirm }: WebAlertModalProps) {
    const { theme } = useUnistyles();
    const isConfirm = config.type === 'confirm';
    
    const handleButtonPress = (buttonIndex: number) => {
        if (isConfirm && onConfirm) {
            onConfirm(buttonIndex === 1);
        } else if (!isConfirm && config.buttons?.[buttonIndex]?.onPress) {
            config.buttons[buttonIndex].onPress!();
        }
        onClose();
    };

    const buttons = isConfirm
        ? [
            { text: config.cancelText || t('common.cancel'), style: 'cancel' as const },
            { text: config.confirmText || t('common.ok'), style: config.destructive ? 'destructive' as const : 'default' as const }
        ]
        : config.buttons || [{ text: t('common.ok'), style: 'default' as const }];

    const styles = StyleSheet.create({
        container: {
            backgroundColor: theme.colors.kilv.stone,
            borderRadius: 6,
            width: 360,
            maxWidth: '100%',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.kilv.rimLine,
            shadowColor: theme.colors.shadow.color,
            shadowOffset: {
                width: 0,
                height: 2
            },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5
        },
        content: {
            paddingHorizontal: 24,
            paddingTop: 24,
            paddingBottom: 16,
            alignItems: 'stretch'
        },
        title: {
            fontSize: 16,
            textAlign: 'left',
            color: theme.colors.kilv.stoneInk,
            marginBottom: 4
        },
        message: {
            fontSize: 14,
            textAlign: 'left',
            color: theme.colors.kilv.stoneInk,
            marginTop: 4,
            lineHeight: 21
        },
        buttonContainer: {
            borderTopWidth: 1,
            borderTopColor: theme.colors.kilv.rimLine,
            flexDirection: 'row'
        },
        button: {
            flex: 1,
            minHeight: 48,
            paddingVertical: 12,
            paddingHorizontal: 12,
            alignItems: 'center',
            justifyContent: 'center'
        },
        buttonPressed: {
            backgroundColor: theme.colors.kilv.rimLine
        },
        buttonSeparator: {
            width: 1,
            backgroundColor: theme.colors.kilv.rimLine
        },
        buttonText: {
            fontSize: 16,
            color: theme.colors.kilv.molten
        },
        cancelText: {
            fontWeight: '400'
        },
        destructiveText: {
            color: theme.colors.kilv.islandDanger
        }
    });

    return (
        <BaseModal visible={true} onClose={onClose} closeOnBackdrop={false}>
            <MobileGlassSurface
                enabled={false}
                nativeEffect
                glassEffectStyle="regular"
                intensity={88}
                tintColor={theme.colors.glass.overlayTint}
                style={styles.container}
            >
                <View style={styles.content}>
                    <Text style={[styles.title, Typography.default('semiBold')]}>
                        {config.title}
                    </Text>
                    {config.message && (
                        <Text style={[styles.message, Typography.default()]}>
                            {config.message}
                        </Text>
                    )}
                </View>
                
                <View style={styles.buttonContainer}>
                    {buttons.map((button, index) => (
                        <React.Fragment key={index}>
                            {index > 0 && <View style={styles.buttonSeparator} />}
                            <Pressable
                                accessibilityRole="button"
                                style={({ pressed }) => [
                                    styles.button,
                                    pressed && styles.buttonPressed
                                ]}
                                onPress={() => handleButtonPress(index)}
                            >
                                <Text style={[
                                    styles.buttonText,
                                    button.style === 'cancel' && styles.cancelText,
                                    button.style === 'destructive' && styles.destructiveText,
                                    Typography.default(button.style === 'cancel' ? undefined : 'semiBold')
                                ]}>
                                    {button.text}
                                </Text>
                            </Pressable>
                        </React.Fragment>
                    ))}
                </View>
            </MobileGlassSurface>
        </BaseModal>
    );
}
