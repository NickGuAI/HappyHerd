import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parseMarkdown';

const item = (spans: { styles: string[]; text: string; url: string | null }[]) => ({
    depth: 0,
    spans,
});

describe('parseMarkdown', () => {
    it('parses unordered lists across common markdown bullet markers and preserves clickable links', () => {
        const blocks = parseMarkdown([
            '* first item',
            '+ second item with [docs](https://example.com/docs)',
            '- third item with https://example.com/raw.',
        ].join('\n'));

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('list');

        if (blocks[0]?.type !== 'list') {
            throw new Error('Expected markdown list block');
        }

        expect(blocks[0].items).toHaveLength(3);
        expect(blocks[0].items[1]).toEqual(item([
            { styles: [], text: 'second item with ', url: null },
            { styles: [], text: 'docs', url: 'https://example.com/docs' },
        ]));
        expect(blocks[0].items[2]).toEqual(item([
            { styles: [], text: 'third item with ', url: null },
            { styles: [], text: 'https://example.com/raw', url: 'https://example.com/raw' },
            { styles: [], text: '.', url: null },
        ]));
    });

    it('parses standalone markdown image blocks', () => {
        const blocks = parseMarkdown('![Markdown renderable image](https://example.com/render.png)');

        expect(blocks).toEqual([
            {
                type: 'image',
                alt: 'Markdown renderable image',
                url: 'https://example.com/render.png',
            },
        ]);
    });

    it('fails closed for markdown images with unsafe schemes', () => {
        const blocks = parseMarkdown('![secret](data:image/png;base64,abc123)');

        expect(blocks).toEqual([{
            type: 'text',
            content: [{ styles: [], text: '![secret](data:image/png;base64,abc123)', url: null }],
        }]);
    });

    it('parses block quotes and GFM task lists', () => {
        const blocks = parseMarkdown([
            '> Keep the main agent moving.',
            '> A child failure is an outcome.',
            '',
            '- [x] Preserve the result',
            '- [ ] Retry only when the main agent decides',
        ].join('\n'));

        expect(blocks).toEqual([
            {
                type: 'quote',
                content: [{ styles: [], text: 'Keep the main agent moving.\nA child failure is an outcome.', url: null }],
            },
            {
                type: 'task-list',
                items: [
                    { checked: true, depth: 0, spans: [{ styles: [], text: 'Preserve the result', url: null }] },
                    { checked: false, depth: 0, spans: [{ styles: [], text: 'Retry only when the main agent decides', url: null }] },
                ],
            },
        ]);
    });

    it('parses GFM strikethrough spans', () => {
        const blocks = parseMarkdown('Keep ~~obsolete~~ current guidance.');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'Keep ', url: null },
                { styles: ['strikethrough'], text: 'obsolete', url: null },
                { styles: [], text: ' current guidance.', url: null },
            ],
        }]);
    });

    it('auto-linkifies bare URLs in text blocks', () => {
        const blocks = parseMarkdown('Visit https://example.com/docs for more.');

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');

        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }

        expect(blocks[0].content).toEqual([
            { styles: [], text: 'Visit ', url: null },
            { styles: [], text: 'https://example.com/docs', url: 'https://example.com/docs' },
            { styles: [], text: ' for more.', url: null },
        ]);
    });
});
