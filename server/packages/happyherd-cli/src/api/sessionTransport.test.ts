import { describe, expect, it } from 'vitest';
import { sessionTransportEndpoint, sessionTransportErrorCode } from './sessionTransport';

describe('session transport safe diagnostics', () => {
    it.each([
        [{ code: 'ENOTFOUND' }, 'dns'], [{ message: 'websocket error', description: { error: { code: 'ENOTFOUND' } } }, 'dns'], [{ code: 'ECONNREFUSED' }, 'connect'],
        [{ response: { status: 503 } }, 'http'], [{ message: 'transport close' }, 'closed'],
        [{ code: 'ETIMEDOUT' }, 'recovery-timeout'], [{ message: 'secret-token' }, 'unknown'],
    ])('classifies %j without exposing exception text', (error, expected) => {
        expect(sessionTransportErrorCode(error)).toBe(expected);
    });
    it('removes credentials, query and fragments from displayed endpoints', () => {
        expect(sessionTransportEndpoint('https://user:password@example.com/base/?token=secret#key')).toBe('https://example.com/base');
    });
});
