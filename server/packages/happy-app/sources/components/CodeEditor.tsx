import * as React from 'react';
import { Platform, TextInput } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { t } from '@/text';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language: string | null;
    darkMode: boolean;
    readOnly?: boolean;
}

function NativeCodeEditor({
    value,
    onChange,
    readOnly = false,
}: CodeEditorProps) {
    return (
        <TextInput
            accessibilityLabel={t('files.editFile')}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!readOnly}
            multiline
            onChangeText={readOnly ? undefined : onChange}
            scrollEnabled
            spellCheck={false}
            style={styles.editor}
            textAlignVertical="top"
            value={value}
        />
    );
}

export const CodeEditor = React.memo(NativeCodeEditor);

const styles = StyleSheet.create((theme) => ({
    editor: {
        flex: 1,
        padding: 16,
        color: theme.colors.text,
        backgroundColor: 'transparent',
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        fontSize: 14,
        lineHeight: 21,
    },
}));
