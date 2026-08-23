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

    it('only gives local paths a target when the author used explicit Markdown link syntax', () => {
        const blocks = parseMarkdown('Open packages/happy-app/README.md or [the app readme](packages/happy-app/README.md).');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'Open packages/happy-app/README.md or ', url: null },
                { styles: [], text: 'the app readme', url: 'packages/happy-app/README.md' },
                { styles: [], text: '.', url: null },
            ],
        }]);
    });

    it('keeps a parenthesized Markdown link title inside the destination', () => {
        const blocks = parseMarkdown('[the report](docs/My Report.md:12:3 (Project docs)) next');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'the report', url: 'docs/My Report.md:12:3 (Project docs)' },
                { styles: [], text: ' next', url: null },
            ],
        }]);
    });

    it('preserves arbitrarily nested parentheses in an explicit Markdown destination', () => {
        const blocks = parseMarkdown('[notes](docs/foo_(bar(baz)).md) next');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'notes', url: 'docs/foo_(bar(baz)).md' },
                { styles: [], text: ' next', url: null },
            ],
        }]);
    });

    it('ignores closing parentheses inside a quoted Markdown link title', () => {
        const blocks = parseMarkdown('[notes](docs/file.md "title )") next');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'notes', url: 'docs/file.md "title )"' },
                { styles: [], text: ' next', url: null },
            ],
        }]);
    });

    it('ignores parentheses inside an angle-delimited destination', () => {
        const blocks = parseMarkdown('[notes](<docs/foo_(bar).md> "title )") next');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'notes', url: '<docs/foo_(bar).md> "title )"' },
                { styles: [], text: ' next', url: null },
            ],
        }]);
    });

    it('preserves non-link inline capture groups after link scanning', () => {
        const blocks = parseMarkdown('Use `code` and ~~obsolete~~ text.');

        expect(blocks).toEqual([{
            type: 'text',
            content: [
                { styles: [], text: 'Use ', url: null },
                { styles: ['code'], text: 'code', url: null },
                { styles: [], text: ' and ', url: null },
                { styles: ['strikethrough'], text: 'obsolete', url: null },
                { styles: [], text: ' text.', url: null },
            ],
        }]);
    });

    it.each([
        '[bad](docs/file.md "unterminated [good](docs/good.md) tail',
        '[bad](<docs/file.md [good](docs/good.md) tail',
    ])('recovers a later explicit link after an unterminated destination in %s', (markdown) => {
        const blocks = parseMarkdown(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');
        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }
        expect(blocks[0].content).toContainEqual({
            styles: [],
            text: 'good',
            url: 'docs/good.md',
        });
    });

    it.each([
        ['[bad](docs/file.md "unterminated [good](docs/good.md "title") tail', 'docs/good.md "title"'],
        ['[bad](<docs/file.md [good](<docs/good.md>) tail', '<docs/good.md>'],
    ])('does not borrow a later valid link delimiter while recovering %s', (markdown, expectedUrl) => {
        const blocks = parseMarkdown(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');
        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }
        expect(blocks[0].content).toContainEqual({
            styles: [],
            text: 'good',
            url: expectedUrl,
        });
    });

    it.each([
        '[file](docs/My "Quoted" File.md) tail',
        "[file](docs/My 'Quoted' File.md) tail",
        '[file](docs/My "draft".md "Actual title") tail',
        '[file](docs/My Report.md "draft) tail',
    ])('preserves a non-terminal quote as literal path data in %s', (markdown) => {
        const blocks = parseMarkdown(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');
        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }
        expect(blocks[0].content[0]).toMatchObject({
            styles: [],
            text: 'file',
            url: expect.any(String),
        });
        expect(blocks[0].content[0]?.url).toBe(markdown.slice('[file]('.length, -') tail'.length));
    });

    it.each([
        '[outer](docs/[v1](draft).md) tail',
        '[outer](docs/file.md "see [v1](draft)") tail',
    ])('keeps a nested link-shaped sequence inside the valid outer destination in %s', (markdown) => {
        const blocks = parseMarkdown(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');
        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }
        expect(blocks[0].content).toEqual([
            {
                styles: [],
                text: 'outer',
                url: markdown.slice('[outer]('.length, -') tail'.length),
            },
            { styles: [], text: ' tail', url: null },
        ]);
    });

    it.each([
        '[outer](<docs/[v1](draft.md>) tail',
        '[outer](docs/file.md "see [v1](draft") tail',
    ])('keeps an unbalanced link-shaped sequence inside a closed outer delimiter in %s', (markdown) => {
        const blocks = parseMarkdown(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');
        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }
        expect(blocks[0].content).toEqual([
            {
                styles: [],
                text: 'outer',
                url: markdown.slice('[outer]('.length, -') tail'.length),
            },
            { styles: [], text: ' tail', url: null },
        ]);
    });

    it('handles many malformed link openers without rescanning each suffix', { timeout: 1_000 }, () => {
        const markdown = '[x]('.repeat(12_000);
        const blocks = parseMarkdown(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');
        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }
        expect(blocks[0].content.map((span) => span.text).join('')).toBe(markdown);
    });
});
