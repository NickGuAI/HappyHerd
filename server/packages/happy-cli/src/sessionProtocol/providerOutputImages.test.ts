import { describe, expect, it } from 'vitest';

import {
    extractAcpContentImages,
    extractClaudeAgentOutputImages,
    extractCodexAgentOutputImages,
    redactAcpImageDataForLogging,
} from './providerOutputImages';
import { MAX_PLAINTEXT_ATTACHMENT_BYTES } from '@/api/attachmentLimits';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);

describe('provider output images', () => {
    it('extracts direct and tool-wrapped ACP images while preserving a safe provider URI', () => {
        const direct = extractAcpContentImages({
            type: 'image',
            data: jpeg.toString('base64'),
            mimeType: 'image/jpeg',
            uri: 'images/5.jpg',
        });
        const wrapped = extractAcpContentImages([{
            type: 'content',
            content: {
                type: 'image',
                data: png.toString('base64'),
                mimeType: 'image/png',
                uri: 'images/6.png',
            },
        }]);

        expect(direct).toHaveLength(1);
        expect(direct[0]).toMatchObject({ name: 'images/5.jpg', sourceUri: 'images/5.jpg', mimeType: 'image/jpeg' });
        expect(wrapped).toHaveLength(1);
        expect(wrapped[0]).toMatchObject({ name: 'images/6.png', sourceUri: 'images/6.png', mimeType: 'image/png' });
    });

    it('accepts the encrypted-upload boundary and rejects the next byte', () => {
        const atLimit = Buffer.alloc(MAX_PLAINTEXT_ATTACHMENT_BYTES, 0xff);
        atLimit.set([0xff, 0xd8, 0xff], 0);
        expect(extractAcpContentImages({
            type: 'image',
            data: atLimit.toString('base64'),
            mimeType: 'image/jpeg',
            uri: 'images/large.jpg',
        })).toHaveLength(1);

        const overLimit = Buffer.alloc(MAX_PLAINTEXT_ATTACHMENT_BYTES + 1, 0xff);
        overLimit.set([0xff, 0xd8, 0xff], 0);
        expect(extractAcpContentImages({
            type: 'image',
            data: overLimit.toString('base64'),
            mimeType: 'image/jpeg',
            uri: 'images/too-large.jpg',
        })).toEqual([]);
    });

    it('rejects spoofed and malformed ACP images and does not trust unsafe URIs', () => {
        expect(extractAcpContentImages({
            type: 'image',
            data: jpeg.toString('base64'),
            mimeType: 'image/png',
            uri: 'images/5.png',
        })).toEqual([]);
        expect(extractAcpContentImages({
            type: 'image',
            data: `${jpeg.toString('base64')}!!!!`,
            mimeType: 'image/jpeg',
            uri: 'images/malformed.jpg',
        })).toEqual([]);

        const unsafeName = extractAcpContentImages({
            type: 'image',
            data: jpeg.toString('base64'),
            mimeType: 'image/jpeg',
            uri: '../5.jpg',
        });
        expect(unsafeName[0]?.name).toBe('acp-image-1.jpg');
    });

    it('redacts ACP image strings and bytes before logging', () => {
        const base64 = jpeg.toString('base64');
        const safe = redactAcpImageDataForLogging({
            content: [{ type: 'image', data: base64, mimeType: 'image/jpeg' }],
            outgoing: { type: 'model-output-image', data: new Uint8Array(jpeg), mimeType: 'image/jpeg', name: 'images/5.jpg' },
        });
        const serialized = JSON.stringify(safe);

        expect(serialized).not.toContain(base64);
        expect(serialized).not.toContain('255,216,255');
        expect(serialized).toContain(`\"base64Length\":${base64.length}`);
        expect(serialized).toContain(`\"byteLength\":${jpeg.length}`);
    });

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
