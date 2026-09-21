import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Socket.IO payload limit', () => {
    it('can carry the encoded 16 MiB Workspace live response envelope', () => {
        const source = readFileSync(join(__dirname, 'socket.ts'), 'utf8');
        expect(source).toContain('maxHttpBufferSize: 40 * 1024 * 1024');
    });
});
