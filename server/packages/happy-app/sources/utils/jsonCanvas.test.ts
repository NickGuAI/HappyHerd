import { describe, expect, it } from 'vitest';
import { parseJsonCanvas } from './jsonCanvas';

describe('parseJsonCanvas', () => {
    it('accepts JSON Canvas 1.0 nodes and labeled edges', () => {
        const document = parseJsonCanvas(JSON.stringify({
            nodes: [
                { id: 'a', type: 'text', text: '# Start', x: 0, y: 0, width: 240, height: 120 },
                { id: 'b', type: 'file', file: 'notes/end.md', x: 320, y: 0, width: 240, height: 120 },
            ],
            edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', toEnd: 'arrow', label: 'next' }],
        }));
        expect(document?.nodes).toHaveLength(2);
        expect(document?.edges[0].label).toBe('next');
        expect(document?.edges[0].toEnd).toBe('arrow');
    });

    it('defaults optional node and edge arrays to empty JSON Canvas collections', () => {
        expect(parseJsonCanvas('{}')).toEqual({ nodes: [], edges: [] });
        expect(parseJsonCanvas('{"nodes":[]}')).toEqual({ nodes: [], edges: [] });
        expect(parseJsonCanvas('{"edges":[]}')).toEqual({ nodes: [], edges: [] });
    });

    it('defaults an omitted edge endpoint to an arrow', () => {
        const document = parseJsonCanvas('{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":1,"height":1},{"id":"b","type":"text","text":"y","x":2,"y":2,"width":1,"height":1}],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}');
        expect(document?.edges[0].toEnd).toBe('arrow');
    });

    it('rejects duplicate node ids and dangling edges', () => {
        expect(parseJsonCanvas('{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":1,"height":1},{"id":"a","type":"text","text":"y","x":2,"y":2,"width":1,"height":1}],"edges":[]}')).toBeNull();
        expect(parseJsonCanvas('{"nodes":[],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}')).toBeNull();
    });
});
