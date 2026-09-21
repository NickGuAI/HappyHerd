import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardTypeOptions, Platform } from 'react-native';
import { BaseModal } from './BaseModal';
import { PromptModalConfig } from '../types';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { MobileGlassSurface } from '@/components/MobileGlass';
import { t } from '@/text';
import { resolvePhoneSafeTextEntryFontSize } from '@/utils/mobileTypographyFloor';

interface WebPromptModalProps {
    config: PromptModalConfig;
    onClose: () => void;
    onConfirm: (value: string | null) => void;
}

export function WebPromptModal({ config, onClose, onConfirm }: WebPromptModalProps) {
    const { theme } = useUnistyles();
    const [inputValue, setInputValue] = useState(config.defaultValue || '');
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        // Auto-focus the input when modal opens
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    const handleCancel = () => {
        onConfirm(null);
        onClose();
    };

    const handleConfirm = () => {
        onConfirm(inputValue);
        onClose();
    };

    const getKeyboardType = (): KeyboardTypeOptions => {
        switch (config.inputType) {
            case 'email-address':
                return 'email-address';
            case 'numeric':
                return 'numeric';
            default:
                return 'default';
        }
    };

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
        input: {
            width: '100%',
            height: 44,
            borderWidth: 1,
            borderColor: theme.colors.kilv.rimLine,
            borderRadius: 4,
            paddingHorizontal: 10,
            marginTop: 16,
            fontSize: resolvePhoneSafeTextEntryFontSize(Platform.OS, 14),
            color: theme.colors.kilv.stoneInk,
            backgroundColor: theme.colors.kilv.scrimStrong
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
        }
    });

    return (
        <BaseModal visible={true} onClose={handleCancel} closeOnBackdrop={false}>
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
                    <TextInput
                        ref={inputRef}
                        style={[styles.input, focused && { borderColor: theme.colors.kilv.molten }, Typography.mono()]}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        value={inputValue}
                        onChangeText={setInputValue}
                        placeholder={config.placeholder}
                        placeholderTextColor={theme.colors.kilv.rim}
                        keyboardType={getKeyboardType()}
                        secureTextEntry={config.inputType === 'secure-text'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus={Platform.OS === 'web'}
                        onSubmitEditing={handleConfirm}
                        returnKeyType="done"
                    />
                </View>
                
                <View style={styles.buttonContainer}>
                    <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.button,
                            pressed && styles.buttonPressed
                        ]}
                        onPress={handleCancel}
                    >
                        <Text style={[
                            styles.buttonText,
                            styles.cancelText,
                            Typography.default()
                        ]}>
                            {config.cancelText || t('common.cancel')}
                        </Text>
                    </Pressable>
                    <View style={styles.buttonSeparator} />
                    <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.button,
                            pressed && styles.buttonPressed
                        ]}
                        onPress={handleConfirm}
                    >
                        <Text style={[
                            styles.buttonText,
                            Typography.default('semiBold')
                        ]}>
                            {config.confirmText || t('common.ok')}
                        </Text>
                    </Pressable>
                </View>
            </MobileGlassSurface>
        </BaseModal>
    );
}
