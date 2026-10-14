import { StyleSheet } from 'react-native-unistyles';
import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, Platform } from 'react-native';
import { Command, CommandCategory } from './types';
import { CommandPaletteItem } from './CommandPaletteItem';
import { Typography } from '@/constants/Typography';
import { useHerdPhoneWeb } from '@/components/herd/mobile/useHerdPhone';

import { t } from '@/text';
interface CommandPaletteResultsProps {
    categories: CommandCategory[];
    selectedIndex: number;
    onSelectCommand: (command: Command) => void;
    onSelectionChange: (index: number) => void;
}

export function CommandPaletteResults({
    categories,
    selectedIndex,
    onSelectCommand,
    onSelectionChange
}: CommandPaletteResultsProps) {
    const scrollViewRef = useRef<ScrollView>(null);
    const nativeContentRef = useRef<View>(null);
    const phone = useHerdPhoneWeb();
    const itemRefs = useRef<{ [key: number]: View | null }>({});

    // Flatten commands for index tracking
    const allCommands = React.useMemo(() => {
        return categories.flatMap(cat => cat.commands);
    }, [categories]);

    // Scroll to selected item when index changes
    useEffect(() => {
        const selectedItem = itemRefs.current[selectedIndex];
        if (selectedItem && scrollViewRef.current) {
            // For web, we need to use the DOM API
            if (typeof (selectedItem as any).scrollIntoView === 'function') {
                (selectedItem as any).scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                });
            } else if (Platform.OS !== 'web') {
                // Native ScrollView has no scrollIntoView; measure in its content
                // coordinate space so hardware navigation keeps selection visible.
                const scroll = scrollViewRef.current;
                const content = nativeContentRef.current;
                if (content) selectedItem.measureLayout(content, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 8), animated: true }), () => {});
            }
        }
    }, [selectedIndex]);

    if (categories.length === 0 || allCommands.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, Typography.default()]}>
                    {t("uiCopy.noCommandsFound")}
                </Text>
            </View>
        );
    }

    let currentIndex = 0;
    const categoryViews = categories.map(category => {
                if (category.commands.length === 0) return null;

                const categoryStartIndex = currentIndex;
                const categoryCommands = category.commands.map((command, idx) => {
                    const commandIndex = categoryStartIndex + idx;
                    const isSelected = commandIndex === selectedIndex;
                    currentIndex++;

                    return (
                        <View
                            key={command.id}
                            ref={(ref) => {
                                itemRefs.current[commandIndex] = ref;
                            }}
                        >
                            <CommandPaletteItem
                                command={command}
                                isSelected={isSelected}
                                onPress={() => onSelectCommand(command)}
                                onHover={() => onSelectionChange(commandIndex)}
                            />
                        </View>
                    );
                });

                return (
                    <View key={category.id}>
                        <Text style={[styles.categoryTitle, phone && styles.categoryTitlePhone, Typography.mono('semiBold')]}>
                            {category.title}
                        </Text>
                        {categoryCommands}
                    </View>
                );
            });

    return (
        <ScrollView
            ref={scrollViewRef}
            style={[styles.container, phone && styles.containerPhone]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            {Platform.OS === 'web' ? categoryViews : <View ref={nativeContentRef}>{categoryViews}</View>}
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        // Use viewport-based height for better proportions
        ...(Platform.OS === 'web' ? {
            maxHeight: '52vh',
        } as any : {
            maxHeight: 420, // Fallback for native
        }),
        padding: 8,
    },
    // Phones: the list takes the palette's height; the palette caps it.
    containerPhone: {
        maxHeight: 'none' as any,
        flexShrink: 1,
    },
    emptyContainer: {
        padding: 48,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        letterSpacing: -0.2,
    },
    categoryTitle: {
        paddingHorizontal: 10,
        paddingTop: 10,
        paddingBottom: 6,
        fontSize: 10.5,
        color: theme.colors.textLink,
        textTransform: 'uppercase',
        letterSpacing: 2,
    },
    categoryTitlePhone: {
        paddingHorizontal: 8,
    },
}));
