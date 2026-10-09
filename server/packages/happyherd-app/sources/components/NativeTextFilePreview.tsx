import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from './StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/** Source Preview keeps native selection and makes every source line reviewable. */
export function NativeTextFilePreview({ content, requestedLine, onLineComment, renderLineComment }: {
    content: string;
    requestedLine?: number | null;
    onLineComment: (anchor: { line: number }) => void;
    renderLineComment: (line: number) => React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const scroll = React.useRef<ScrollView>(null);
    const offsets = React.useRef(new Map<number, number>());
    const reveal = React.useCallback(() => {
        const y = requestedLine == null ? undefined : offsets.current.get(requestedLine);
        if (y !== undefined) scroll.current?.scrollTo({ y, animated: false });
    }, [requestedLine]);
    React.useEffect(reveal, [reveal, content]);
    return <ScrollView ref={scroll} style={{ flex: 1 }} testID="native-text-file-preview">
        {content.split('\n').map((text, index) => {
            const line = index + 1;
            return <View key={line} onLayout={(event) => {
                offsets.current.set(line, event.nativeEvent.layout.y);
                if (line === requestedLine) reveal();
            }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('files.commentOnLine', { line: String(line) })}
                        onPress={() => onLineComment({ line })} style={{ minWidth: 52, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Text style={{ ...Typography.mono(), color: theme.colors.textLink }}>{line} +</Text>
                    </Pressable>
                    <Text selectable style={{ ...Typography.mono(), flex: 1, minWidth: 0, paddingVertical: 12, fontSize: 16, color: theme.colors.text }}>{text || '\u00a0'}</Text>
                </View>
                {renderLineComment(line)}
            </View>;
        })}
    </ScrollView>;
}
