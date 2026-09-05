import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { useUnistyles } from 'react-native-unistyles';

import { MarkdownView } from '../MarkdownView.web';

const FIRST_OPTION = '把 Speaker 2 改成 Maria';
const SECOND_OPTION = '保持 Speaker 2 不变，同时保留当前转录中的全部说话人标记以及这一条足够长、会在窄屏和宽屏容器中按可用宽度自然换行的建议文字';
const COMMONMARK_SENSITIVE_OPTIONS = [
    'Keep Speaker 2 (recommended))',
    'Keep Speaker 2 trailing \\',
    String.raw`Keep \[Speaker 2\]`,
];

const markdown = [
    'Body copy with an [ordinary link](https://example.com/docs) and `inline code`.',
    '',
    '## Heading',
    '',
    '- ordinary one',
    '  - nested ordinary',
    '- ordinary two',
    '',
    '> Quoted copy',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '| Date | School | Event | Format | Status | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
    '| Sun 10/4 14:00 | Horace Mann | Nursery / K / Lower Admissions Information Session | In person | Confirmed | Gross Theatre, 246th St & Tibbett Ave. Families only. |',
    '| Wed 10/14 | Horace Mann | Virtual Lions Talks Kickoff | Online | Registered | Aria Gu is registered. |',
    '',
    '<options>',
    `<option>${FIRST_OPTION}</option>`,
    `<option>${SECOND_OPTION}</option>`,
    ...COMMONMARK_SENSITIVE_OPTIONS.map((option) => `<option>${option}</option>`),
    '</options>',
    '',
    ...Array.from({ length: 12 }, (_, index) => `Vertical scroll evidence paragraph ${index + 1}.`),
].join('\n');

declare global {
    interface Window {
        __MARKDOWN_LINE_COMMENTS__?: number[];
        __MARKDOWN_OPTION_PRESSES__?: string[];
    }
}

function MarkdownFixture() {
    const { theme } = useUnistyles();
    return (
        <main
            data-testid="markdown-caller"
            style={{
                width: '100%',
                height: '100vh',
                padding: 16,
                overflow: 'hidden',
                backgroundColor: theme.colors.surface,
                color: '#000000',
            }}
        >
            <section
                data-testid="markdown-host"
                style={{
                    width: '100%',
                    maxWidth: 720,
                    height: '100%',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                }}
            >
                <MarkdownView
                    markdown={markdown}
                    textAlign={new URLSearchParams(window.location.search).get('align') === 'center'
                        ? 'center'
                        : undefined}
                    onLineComment={({ line }) => {
                        window.__MARKDOWN_LINE_COMMENTS__ = [
                            ...(window.__MARKDOWN_LINE_COMMENTS__ ?? []),
                            line,
                        ];
                    }}
                    onOptionPress={(option) => {
                        window.__MARKDOWN_OPTION_PRESSES__ = [
                            ...(window.__MARKDOWN_OPTION_PRESSES__ ?? []),
                            option.title,
                        ];
                    }}
                />
            </section>
        </main>
    );
}

createRoot(document.getElementById('root')!).render(<MarkdownFixture />);
