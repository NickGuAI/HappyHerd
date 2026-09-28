import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { Command } from './types';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { HerdKey } from '@/components/herd/pages/HerdPage';
import { HerdShellIcon } from '@/components/herd/shell/HerdShellIcon';
import { useHerdPhoneWeb } from '@/components/herd/mobile/useHerdPhone';

interface CommandPaletteItemProps {
    command: Command;
    isSelected: boolean;
    onPress: () => void;
    onHover?: () => void;
}

export function CommandPaletteItem({ command, isSelected, onPress, onHover }: CommandPaletteItemProps) {
    const { theme } = useUnistyles();
    const phone = useHerdPhoneWeb();
    const [isHovered, setIsHovered] = React.useState(false);

    const handleMouseEnter = React.useCallback(() => {
        if (Platform.OS === 'web') {
            setIsHovered(true);
            onHover?.();
        }
    }, [onHover]);

    const handleMouseLeave = React.useCallback(() => {
        if (Platform.OS === 'web') {
            setIsHovered(false);
        }
    }, []);

    const pressableProps: any = {
        style: ({ pressed }: any) => [
            styles.container,
            phone && styles.containerPhone,
            isSelected && styles.selected,
            isHovered && !isSelected && styles.hovered,
            pressed && Platform.OS === 'web' && styles.pressed
        ],
        onPress,
    };

    // Add mouse events only on web
    if (Platform.OS === 'web') {
        pressableProps.onMouseEnter = handleMouseEnter;
        pressableProps.onMouseLeave = handleMouseLeave;
    }

    return (
        <Pressable {...pressableProps} accessibilityRole="button" accessibilityState={{ selected: isSelected }} aria-selected={isSelected}>
            {isSelected && <View testID="command-palette-accent" style={styles.accentBar} />}
            <View style={styles.content}>
                {(command.glyph || command.icon) && (
                    <View style={styles.iconContainer}>
                        {command.glyph ? (
                            <HerdShellIcon
                                name={command.glyph}
                                size={17}
                                color={isSelected ? theme.colors.textLink : theme.colors.textSecondary}
                            />
                        ) : (
                            <Ionicons
                                name={command.icon as any}
                                size={17}
                                color={isSelected ? theme.colors.textLink : theme.colors.textSecondary}
                            />
                        )}
                    </View>
                )}
                <Text numberOfLines={1} style={[styles.title, Typography.default(), isSelected && styles.titleSelected]}>
                    {command.title}
                </Text>
                {command.subtitle && (
                    <Text numberOfLines={1} style={[styles.subtitle, Typography.default()]}>
                        {command.subtitle}
                    </Text>
                )}
                {command.shortcut && !phone && (
                    <View style={styles.shortcutContainer}>
                        <HerdKey label={command.shortcut} />
                    </View>
                )}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        minHeight: 44,
        paddingHorizontal: 12,
        justifyContent: 'center',
        backgroundColor: 'transparent',
        borderRadius: theme.borderRadius.md,
    },
    // Phones: touch-size rows whose content sits on the 16 px gutter with the list's 8 px.
    containerPhone: {
        minHeight: 48,
        paddingHorizontal: 8,
    },
    selected: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    hovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    accentBar: {
        position: 'absolute',
        left: 0,
        top: 10,
        bottom: 10,
        width: 2,
        borderRadius: 1,
        backgroundColor: theme.colors.kilv.accent,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconContainer: {
        width: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        flexShrink: 0,
        maxWidth: '62%',
        fontSize: 15,
        color: theme.colors.textSecondary,
        letterSpacing: -0.2,
    },
    titleSelected: {
        color: theme.colors.text,
    },
    subtitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        color: theme.colors.kilv.inkFaint,
        letterSpacing: -0.1,
    },
    shortcutContainer: {
        marginLeft: 'auto',
    },
}));
