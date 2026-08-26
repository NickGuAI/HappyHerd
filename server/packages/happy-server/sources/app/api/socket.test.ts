import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Socket.IO payload limit', () => {
    it('can carry an encrypted 10 MiB Commander avatar response', () => {
        const source = readFileSync(join(__dirname, 'socket.ts'), 'utf8');
        expect(source).toContain('maxHttpBufferSize: 20 * 1024 * 1024');
    });
});
