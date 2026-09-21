import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { select: (values: Record<string, unknown>) => values.ios ?? values.default },
        TextInput: host('TextInput'),
    };
});

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: any) => factory({ colors: { text: 'text' } }),
    },
}));

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { CodeEditor } from './CodeEditor';

type CodeEditorProps = {
    value: string;
    onChange: (value: string) => void;
    language: string | null;
    darkMode: boolean;
    readOnly?: boolean;
};

const NativeCodeEditor = (CodeEditor as unknown as {
    type: (props: CodeEditorProps) => ReactElement;
}).type;

function renderEditor(overrides: Partial<CodeEditorProps> = {}) {
    const element = NativeCodeEditor({
        value: 'first line\nsecond line',
        onChange: vi.fn(),
        language: 'markdown',
        darkMode: false,
        ...overrides,
    });
    return element.props as Record<string, any>;
}

describe('CodeEditor native', () => {
    it('renders the current text in a multiline native input', () => {
        expect(renderEditor()).toMatchObject({
            accessibilityLabel: 'files.editFile',
            editable: true,
            multiline: true,
            value: 'first line\nsecond line',
        });
    });

    it('forwards native text edits', () => {
        const onChange = vi.fn();
        renderEditor({ value: 'before', onChange, language: null, darkMode: true }).onChangeText('after');

        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('after');
    });

    it('disables editing and the change callback in read-only mode', () => {
        expect(renderEditor({ value: 'locked', readOnly: true })).toMatchObject({
            editable: false,
            onChangeText: undefined,
            value: 'locked',
        });
    });
});
