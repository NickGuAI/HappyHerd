export type JsonCanvasPosition = Readonly<{ x: number; y: number }>;

export type JsonCanvasNode = Readonly<{
    id: string;
    type: 'text' | 'file' | 'link' | 'group';
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    text?: string;
    file?: string;
    subpath?: string;
    url?: string;
    label?: string;
}>;

export type JsonCanvasEdge = Readonly<{
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: 'top' | 'right' | 'bottom' | 'left';
    toSide?: 'top' | 'right' | 'bottom' | 'left';
    fromEnd?: 'none' | 'arrow';
    toEnd?: 'none' | 'arrow';
    color?: string;
    label?: string;
}>;

export type JsonCanvasDocument = Readonly<{
    nodes: readonly JsonCanvasNode[];
    edges: readonly JsonCanvasEdge[];
}>;

function finiteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function optionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

export function parseJsonCanvas(content: string): JsonCanvasDocument | null {
    let value: any;
    try {
        value = JSON.parse(content);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const rawNodes = value.nodes === undefined ? [] : value.nodes;
    const rawEdges = value.edges === undefined ? [] : value.edges;
    if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;

    const ids = new Set<string>();
    const nodes: JsonCanvasNode[] = [];
    for (const candidate of rawNodes) {
        if (
            !candidate
            || typeof candidate !== 'object'
            || typeof candidate.id !== 'string'
            || !['text', 'file', 'link', 'group'].includes(candidate.type)
            || !finiteNumber(candidate.x)
            || !finiteNumber(candidate.y)
            || !finiteNumber(candidate.width)
            || !finiteNumber(candidate.height)
            || candidate.width <= 0
            || candidate.height <= 0
            || ids.has(candidate.id)
            || !optionalString(candidate.color)
            || !optionalString(candidate.text)
            || !optionalString(candidate.file)
            || !optionalString(candidate.subpath)
            || !optionalString(candidate.url)
            || !optionalString(candidate.label)
        ) return null;
        if (candidate.type === 'text' && typeof candidate.text !== 'string') return null;
        if (candidate.type === 'file' && typeof candidate.file !== 'string') return null;
        if (candidate.type === 'link' && typeof candidate.url !== 'string') return null;
        ids.add(candidate.id);
        nodes.push(candidate as JsonCanvasNode);
    }

    const edges: JsonCanvasEdge[] = [];
    const edgeIds = new Set<string>();
    for (const candidate of rawEdges) {
        if (
            !candidate
            || typeof candidate !== 'object'
            || typeof candidate.id !== 'string'
            || edgeIds.has(candidate.id)
            || typeof candidate.fromNode !== 'string'
            || typeof candidate.toNode !== 'string'
            || !ids.has(candidate.fromNode)
            || !ids.has(candidate.toNode)
            || !optionalString(candidate.color)
            || !optionalString(candidate.label)
            || (candidate.fromSide !== undefined && !['top', 'right', 'bottom', 'left'].includes(candidate.fromSide))
            || (candidate.toSide !== undefined && !['top', 'right', 'bottom', 'left'].includes(candidate.toSide))
            || (candidate.fromEnd !== undefined && !['none', 'arrow'].includes(candidate.fromEnd))
            || (candidate.toEnd !== undefined && !['none', 'arrow'].includes(candidate.toEnd))
        ) return null;
        edgeIds.add(candidate.id);
        edges.push({ ...candidate, toEnd: candidate.toEnd ?? 'arrow' } as JsonCanvasEdge);
    }

    return { nodes, edges };
}
