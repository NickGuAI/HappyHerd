import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('span', props),
}));

vi.mock('react-native', () => ({
    Pressable: ({ children, ...props }: Record<string, any>) => React.createElement('button', props, children),
    Text: ({ children, ...props }: Record<string, any>) => React.createElement('span', props, children),
    View: ({ children, ...props }: Record<string, any>) => React.createElement('div', props, children),
}));

const theme = {
    colors: {
        divider: '#444444',
        surfaceHighest: '#242424',
        success: '#00cc66',
        textDestructive: '#cc3333',
        textSecondary: '#999999',
        warning: '#dd9900',
    },
};

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: ((value: typeof theme) => Record<string, unknown>) | Record<string, unknown>) => (
            typeof factory === 'function' ? factory(theme) : factory
        ),
    },
    useUnistyles: () => ({ theme }),
}));

vi.mock('@/components/markdown/MarkdownView', () => ({
    MarkdownView: ({ markdown }: { markdown: string }) => React.createElement('div', null, markdown),
}));

vi.mock('@/text', () => ({
    t: (key: string) => ({
        'uiCopy.events': 'events',
        'uiCopy.reasoning': 'REASONING',
        'uiCopy.noChildActivityObservedYet': 'No child activity observed yet.',
        'uiCopy.collapseSubagentActivity': 'Collapse sub-agent activity',
        'uiCopy.expandSubagentActivity': 'Expand sub-agent activity',
        'uiCopy.hideActivity': 'Hide activity',
        'uiCopy.viewActivity': 'View activity',
    } as Record<string, string>)[key] ?? key,
}));

describe('SubagentView', () => {
    it('keeps child output and tool activity collapsed by default', async () => {
        const { SubagentView } = await import('./SubagentView');
        const html = renderToStaticMarkup(React.createElement(SubagentView, {
            tool: {
                name: 'Subagent',
                state: 'completed',
                input: {},
                result: { status: 'completed' },
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
            },
            metadata: null,
            messages: [
                {
                    id: 'child-final',
                    kind: 'agent-text',
                    text: 'CHILD FINAL RESPONSE SHOULD START HIDDEN',
                    isThinking: false,
                    createdAt: 2,
                },
                {
                    id: 'child-command',
                    kind: 'tool-call',
                    createdAt: 1,
                    tool: {
                        name: 'CodexBash',
                        description: 'CHILD TOOL SHOULD START HIDDEN',
                        state: 'completed',
                        input: {},
                        createdAt: 1,
                        startedAt: 1,
                        completedAt: 2,
                    },
                },
            ],
        } as any));

        expect(html).toContain('COMPLETED');
        expect(html).toContain('2 events');
        expect(html).toContain('View activity');
        expect(html).not.toContain('CHILD FINAL RESPONSE SHOULD START HIDDEN');
        expect(html).not.toContain('CHILD TOOL SHOULD START HIDDEN');
    });
});
