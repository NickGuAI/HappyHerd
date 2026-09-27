import { StyleSheet } from 'react-native-unistyles';
import React from 'react';
import { View, Platform } from 'react-native';
import { CommandPaletteInput } from './CommandPaletteInput';
import { CommandPaletteResults } from './CommandPaletteResults';
import { useCommandPalette } from './useCommandPalette';
import { Command } from './types';
import { HerdKey } from '@/components/herd/pages/HerdPage';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface CommandPaletteProps {
    commands: Command[];
    onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
    const {
        searchQuery,
        selectedIndex,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleSelectCommand,
        handleKeyPress,
        setSelectedIndex,
    } = useCommandPalette(commands, onClose);

    // Only render on web
    if (Platform.OS !== 'web') {
        return null;
    }

    return (
        <View style={styles.container}>
            <CommandPaletteInput
                value={searchQuery}
                onChangeText={handleSearchChange}
                onKeyPress={handleKeyPress}
                inputRef={inputRef}
            />
            <CommandPaletteResults
                categories={filteredCategories}
                selectedIndex={selectedIndex}
                onSelectCommand={handleSelectCommand}
                onSelectionChange={setSelectedIndex}
            />
            <View testID="command-palette-hints" style={styles.footer}>
                <View style={styles.hint}>
                    <HerdKey label="↑" />
                    <HerdKey label="↓" />
                    <Text style={styles.hintText}>{t('commandPalette.hintNavigate')}</Text>
                </View>
                <View style={styles.hint}>
                    <HerdKey label="↵" />
                    <Text style={styles.hintText}>{t('commandPalette.hintOpen')}</Text>
                </View>
                <View style={styles.hint}>
                    <HerdKey label={t('commandPalette.keyEscape')} />
                    <Text style={styles.hintText}>{t('commandPalette.hintClose')}</Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.kilv.radiusSheet,
        width: '100%',
        maxWidth: 640,
        // Use viewport-based height for better layout
        ...(Platform.OS === 'web' ? {
            maxHeight: '70vh',
        } as any : {
            maxHeight: 500, // Fallback for native
        }),
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: {
            width: 0,
            height: 20,
        },
        shadowOpacity: 0.25,
        shadowRadius: 40,
        elevation: 20,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        _web: { boxShadow: theme.kilv.shadow },
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    hint: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    hintText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
