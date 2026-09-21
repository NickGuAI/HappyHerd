import { describe, expect, it } from 'vitest';

import type { AgentTextMessage, Message, ToolCallMessage } from '@/sync/typesMessage';
import { resolveAcpInlineImages } from './acpInlineImages';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64');

function tool(
    id: string,
    turn: string,
    input: Record<string, unknown>,
    result: unknown,
    startedAt: number,
    completedAt: number,
    name = 'other',
): ToolCallMessage {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: startedAt,
        turn,
        children: [],
        tool: {
            callId: id,
            name,
            state: 'completed',
            input,
            result,
            createdAt: startedAt,
            startedAt,
            completedAt,
            description: null,
        },
    };
}

function text(id: string, turn: string, createdAt = 50, path = 'images/5.jpg'): AgentTextMessage {
    return {
        kind: 'agent-text',
        id,
        localId: null,
        createdAt,
        turn,
        text: `![Cabinet POV](${path})`,
    };
}

function exactTurn(overrides: { readTurn?: string; data?: string; mimeType?: string; camelMimeType?: string } = {}): Message[] {
    return [
        text('answer', 'turn-1'),
        tool(
            'read',
            overrides.readTurn ?? 'turn-1',
            { variant: 'ReadFile', target_file: '/provider/session/images/5.jpg' },
            {
                type: 'ReadFile',
                ImageContent: {
                    data: overrides.data ?? jpeg,
                    mime_type: overrides.mimeType ?? 'image/jpeg',
                    ...(overrides.camelMimeType ? { mimeType: overrides.camelMimeType } : {}),
                },
            },
            30,
            40,
            'read',
        ),
        tool(
            'edit',
            'turn-1',
            { variant: 'ImageEdit' },
            {
                type: 'ImageEdit',
                path: '/provider/session/images/5.jpg',
                filename: '5.jpg',
                session_folder: 'images',
            },
            10,
            20,
        ),
    ];
}

describe('resolveAcpInlineImages', () => {
    it('recovers the exact same-turn ImageEdit -> ReadFile -> Markdown chain', () => {
        const resolved = resolveAcpInlineImages(exactTurn(), 'grok').get('answer');

        expect(resolved?.sources.get('images/5.jpg')).toBe(`data:image/jpeg;base64,${jpeg}`);
        expect(resolved?.suppressed.size).toBe(0);
    });

    it('recovers the exact chain when ImageEdit uses a safe multi-segment session folder', () => {
        const path = '.private-content/images/scene.jpg';
        const providerPath = '/provider/session/.private-content/images/scene.jpg';
        const messages: Message[] = [
            text('nested-history', 'turn-1', 50, path),
            tool(
                'nested-read',
                'turn-1',
                { variant: 'ReadFile', target_file: providerPath },
                { type: 'ReadFile', ImageContent: { data: jpeg, mime_type: 'image/jpeg' } },
                30,
                40,
                'read',
            ),
            tool(
                'nested-edit',
                'turn-1',
                { variant: 'ImageEdit' },
                {
                    type: 'ImageEdit',
                    path: providerPath,
                    filename: 'scene.jpg',
                    session_folder: '.private-content/images',
                },
                10,
                20,
            ),
        ];

        const resolved = resolveAcpInlineImages(messages, 'grok').get('nested-history');
        expect(resolved?.sources.get(path)).toBe(`data:image/jpeg;base64,${jpeg}`);
    });

    it('does not cross turns or accept ambiguous, malformed, or MIME-spoofed content', () => {
        expect(resolveAcpInlineImages(exactTurn({ readTurn: 'turn-2' }), 'grok').size).toBe(0);
        expect(resolveAcpInlineImages(exactTurn({ data: 'bm90IGFuIGltYWdl' }), 'grok').size).toBe(0);
        expect(resolveAcpInlineImages(exactTurn({ mimeType: 'image/png' }), 'grok').size).toBe(0);
        expect(resolveAcpInlineImages(exactTurn({ camelMimeType: 'image/png' }), 'grok').size).toBe(0);

        const ambiguous = exactTurn();
        ambiguous.push(tool(
            'edit-2',
            'turn-1',
            { variant: 'ImageEdit' },
            {
                type: 'ImageEdit',
                path: '/provider/other/images/5.jpg',
                filename: '5.jpg',
                session_folder: 'images',
            },
            11,
            21,
        ));
        expect(resolveAcpInlineImages(ambiguous, 'grok').size).toBe(0);
    });

    it('suppresses the pseudo Markdown node when the same turn already has its encrypted attachment', () => {
        const messages = exactTurn();
        messages.push(tool(
            'file',
            'turn-1',
            { ref: 'encrypted-ref', name: 'images/5.jpg', mimeType: 'image/jpeg' },
            null,
            60,
            60,
            'file',
        ));

        const resolved = resolveAcpInlineImages(messages, 'grok').get('answer');
        expect(resolved?.suppressed.has('images/5.jpg')).toBe(true);
        expect(resolved?.sources.size).toBe(0);
    });

    it('suppresses a safe nested ACP attachment path without treating it as a workspace file', () => {
        const path = 'generated/scenes/5.jpg';
        const messages: Message[] = [
            text('nested-answer', 'turn-1', 50, path),
            tool(
                'nested-file',
                'turn-1',
                { ref: 'encrypted-ref', name: path, mimeType: 'image/jpeg' },
                null,
                60,
                60,
                'file',
            ),
        ];

        const resolved = resolveAcpInlineImages(messages, 'grok').get('nested-answer');
        expect(resolved?.suppressed.has(path)).toBe(true);
    });

    it('leaves ordinary providers and unproven workspace images unchanged', () => {
        expect(resolveAcpInlineImages(exactTurn(), 'codex').size).toBe(0);
        expect(resolveAcpInlineImages([text('answer', 'turn-1')], 'grok').size).toBe(0);
    });
});
