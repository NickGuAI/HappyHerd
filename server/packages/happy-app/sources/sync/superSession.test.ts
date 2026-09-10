import { describe, expect, it } from 'vitest';
import { selectSuperSession } from './superSession';

function session(id: string, createdAt: number, isSuperSession = false) {
    return {
        id,
        createdAt,
        metadata: {
            path: '/workspace',
            host: 'machine',
            ...(isSuperSession ? { isSuperSession: true } : {}),
        },
    };
}

describe('selectSuperSession', () => {
    it('keeps the immutable oldest marker across activity reorderings', () => {
        const first = session('stable', 10, true);
        const duplicate = session('later', 20, true);
        const normal = session('active', 30);

        expect(selectSuperSession([normal, duplicate, first])?.id).toBe('stable');
        expect(selectSuperSession([duplicate, first, normal])?.id).toBe('stable');
    });

    it('breaks duplicate creation-time ties by stable id', () => {
        expect(selectSuperSession([
            session('z', 10, true),
            session('a', 10, true),
        ])?.id).toBe('a');
    });
});
