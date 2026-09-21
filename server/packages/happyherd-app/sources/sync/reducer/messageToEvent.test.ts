import { describe, expect, it } from 'vitest';
import type { NormalizedMessage } from '../typesRaw';
import { parseMessageAsEvent } from './messageToEvent';

describe('title tool compatibility', () => {
    it.each([
        'mcp__happyherd__change_title', 'mcp__happy__change_title',
        'mcp__happy_cli__change_title', 'mcp__happy-cli__change_title',
    ])('renders current and historical %s events without changing titles', name => {
        const msg = {
            role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', name, input: { title: /* rename:preserve */ 'happy: user content' /* /rename:preserve */ } }],
        } as unknown as NormalizedMessage;
        expect(parseMessageAsEvent(msg)).toEqual({ type: 'message', message: /* rename:preserve */ 'Title changed to "happy: user content"' /* /rename:preserve */ });
        expect(parseMessageAsEvent({ ...msg, isSidechain: true })).toBeNull();
        expect(parseMessageAsEvent({ ...msg, content: [{ type: 'tool-call', name, input: { title: 42 } }] } as unknown as NormalizedMessage)).toBeNull();
    });
});
