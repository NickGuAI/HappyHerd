import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { useUnistyles } from 'react-native-unistyles';

import { MarkdownView } from '../MarkdownView.web';

const FIRST_OPTION = '把 Speaker 2 改成 Maria';
const SECOND_OPTION = '保持 Speaker 2 不变，同时保留当前转录中的全部说话人标记以及这一条足够长、会在窄屏和宽屏容器中按可用宽度自然换行的建议文字';

const markdown = [
    'Body copy with an [ordinary link](https://example.com/docs) and `inline code`.',
    '',
    '## Heading',
    '',
    '- ordinary one',
    '- ordinary two',
    '',
    '> Quoted copy',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| answer | 42 |',
    '',
    '<options>',
    `<option>${FIRST_OPTION}</option>`,
    `<option>${SECOND_OPTION}</option>`,
    '</options>',
].join('\n');

declare global {
    interface Window {
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
                minHeight: '100vh',
                padding: 16,
                backgroundColor: theme.colors.surface,
                color: '#000000',
            }}
        >
            <section data-testid="markdown-host" style={{ width: '100%', maxWidth: 720 }}>
                <MarkdownView
                    markdown={markdown}
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
