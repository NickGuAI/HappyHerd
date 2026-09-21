import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import React from 'react';
import { View, TextInput, Platform } from 'react-native';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface CommandPaletteInputProps {
    value: string;
    onChangeText: (text: string) => void;
    onKeyPress?: (key: string) => void;
    inputRef?: React.RefObject<TextInput | null>;
}

export function CommandPaletteInput({ value, onChangeText, onKeyPress, inputRef }: CommandPaletteInputProps) {
    const { theme } = useUnistyles();
    const [focused, setFocused] = React.useState(false);
    const handleKeyDown = React.useCallback((e: any) => {
        if (Platform.OS === 'web' && onKeyPress) {
            const key = e.nativeEvent.key;

            // Handle navigation keys
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(key)) {
                e.preventDefault();
                e.stopPropagation();
                onKeyPress(key);
            }
        }
    }, [onKeyPress]);

    return (
        <View style={[styles.container, focused && { borderBottomColor: theme.colors.kilv.accent }]}>
            <TextInput
                ref={inputRef}
                style={[styles.input, Typography.default()]}
                value={value}
                onChangeText={onChangeText}
                placeholder={t('commandPalette.placeholder')}
                placeholderTextColor={theme.colors.input.placeholder}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="go"
                onKeyPress={handleKeyDown}
                blurOnSubmit={false}
            />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.kilv.bgSunken,
    },
    input: {
        paddingHorizontal: 24,
        paddingVertical: 24,
        fontSize: 18,
        color: theme.colors.text,
        letterSpacing: -0.3,
        // Remove outline on web
        ...(Platform.OS === 'web' ? {
            outlineStyle: 'none',
            outlineWidth: 0,
        } as any : {}),
    },
}));
