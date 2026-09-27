import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import React from 'react';
import { View, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { HerdKey } from '@/components/herd/pages/HerdPage';
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
        <View style={[styles.container, focused && { borderBottomColor: theme.colors.selection.border }]}>
            <Ionicons name="search" size={19} color={theme.colors.textLink} />
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
            <HerdKey label={t('commandPalette.keyEscape')} />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 18,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    input: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 16,
        fontSize: 17,
        color: theme.colors.text,
        letterSpacing: -0.2,
        // Remove outline on web
        ...(Platform.OS === 'web' ? {
            outlineStyle: 'none',
            outlineWidth: 0,
        } as any : {}),
    },
}));
