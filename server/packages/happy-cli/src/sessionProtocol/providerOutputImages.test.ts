import { describe, expect, it } from 'vitest';

import {
    extractClaudeAgentOutputImages,
    extractCodexAgentOutputImages,
} from './providerOutputImages';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);

describe('provider output images', () => {
    it('extracts spec-shaped Claude tool-result PNG/JPEG blocks in content order', () => {
        const images = extractClaudeAgentOutputImages({
            type: 'user',
            uuid: 'user-tool-result',
            message: {
                content: [{
                    type: 'tool_result',
                    tool_use_id: 'image-tool',
                    content: [
                        { type: 'text', text: 'first' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
                    ],
                }],
            },
        } as any);

        expect(images.map((image) => ({ mimeType: image.mimeType, name: image.name }))).toEqual([
            { mimeType: 'image/png', name: 'claude-image-1.png' },
            { mimeType: 'image/jpeg', name: 'claude-image-2.jpg' },
        ]);
        expect(Buffer.from(images[0].data)).toEqual(png);
        expect(Buffer.from(images[1].data)).toEqual(jpeg);
    });

    it('does not classify a human Claude image input as agent output', () => {
        const images = extractClaudeAgentOutputImages({
            type: 'user',
            uuid: 'human-image-input',
            message: {
                content: [{
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
                }],
            },
        } as any);

        expect(images).toEqual([]);
    });

    it('extracts Codex image generation and MCP image blocks without accepting spoofed media', () => {
        const generated = extractCodexAgentOutputImages({
            type: 'imageGeneration',
            id: 'generated-1',
            status: 'completed',
            result: png.toString('base64'),
            revisedPrompt: null,
            failure: null,
        });
        const mcp = extractCodexAgentOutputImages({
            type: 'mcpToolCall',
            id: 'mcp-1',
            server: 'images',
            tool: 'create',
            status: 'completed',
            arguments: {},
            result: {
                content: [
                    { type: 'text', text: 'done' },
                    { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
                    { type: 'image', data: 'bm90IGFuIGltYWdl', mimeType: 'image/png' },
                ],
            },
        });

        expect(generated).toHaveLength(1);
        expect(generated[0]).toMatchObject({ mimeType: 'image/png', name: 'codex-image-generated-1.png' });
        expect(mcp).toHaveLength(1);
        expect(mcp[0]).toMatchObject({ mimeType: 'image/jpeg', name: 'codex-image-mcp-1.jpg' });
    });
});
