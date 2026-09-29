import { createId } from '@paralleldrive/cuid2';
import { createReducer, reducer } from '../reducer/reducer';
import { normalizeRawMessage, RawRecordSchema, type NormalizedMessage } from '../typesRaw';

export type ChildOutcome = 'completed' | 'failed' | 'cancelled';

/** Shared wire fixture for the mapper's background-child contract (#344). */
export function subagentLifecycleFixture(startTime = 1_000) {
    const turn = createId();
    const child = createId();
    const sibling = createId();
    let time = startTime;
    const record = (ev: Record<string, unknown>, subagent?: string) => ({
        role: 'session',
        content: {
            type: 'session',
            data: { id: createId(), time: time++, role: 'agent', turn, ...(subagent ? { subagent } : {}), ev },
        },
    });
    const start = [
        record({ t: 'start', title: 'Background review' }, child),
        record({ t: 'start', title: 'Other child' }, sibling),
        record({ t: 'text', text: 'Inspecting child files' }, child),
    ];
    // The CLI suppresses the parent Agent tool and its async launch acknowledgment.
    // It publishes the parent turn boundary without a child stop while work is active.
    const parentFinished = [
        record({ t: 'turn-end', status: 'completed' }),
    ];
    const continuedActivity = [
        record({ t: 'text', text: 'Still working after the parent turn' }, child),
        record({ t: 'tool-call-start', call: 'child-read', name: 'Read', title: 'Inspect child source', description: 'Inspect child source', args: { file_path: '/work/project/source.ts' } }, child),
        record({ t: 'tool-call-end', call: 'child-read', result: 'Child source contents' }, child),
    ];
    const running = [...start, ...parentFinished, ...continuedActivity];
    const terminal = (status: ChildOutcome) => record({
        t: 'stop', status, authoritative: true,
        ...(status === 'completed' ? {} : { detail: `Provider child ${status}` }),
    }, child);
    return { child, sibling, start, parentFinished, continuedActivity, running, terminal };
}

export type SubagentWireRecord = ReturnType<typeof subagentLifecycleFixture>['running'][number];

export function normalizeSubagentRecords(records: SubagentWireRecord[]): NormalizedMessage[] {
    return records.map((record) => normalizeRawMessage(
        record.content.data.id, null, record.content.data.time, RawRecordSchema.parse(record),
    )).filter((message): message is NormalizedMessage => message !== null);
}

export function replaySubagentRecords(records: SubagentWireRecord[]) {
    return reducer(createReducer(), normalizeSubagentRecords(records)).messages;
}
