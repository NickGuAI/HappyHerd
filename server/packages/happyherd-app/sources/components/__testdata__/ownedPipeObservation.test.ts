import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { observeOwnedPipe, type PipeReceipt } from './ownedPipeObservation';

const secret = 'PRIVATE_SYNTHETIC_雪_PAYLOAD';
const command = { id: 7, method: 'Browser.getVersion', params: { secret } };
const frame = (message: unknown) => Buffer.from(JSON.stringify(message) + '\0');

// Mirrors 1.62.1 PipeTransport2 framing and deferred dispatch without any browser.
class Transport {
    _pendingBuffers: Buffer[] = [];
    received: unknown[] = [];
    scheduled: Array<() => void> = [];
    chunks: Buffer[] = [];
    _pipeWrite = { write: vi.fn(function (..._args: unknown[]) { return false; }) };
    send(message: unknown) {
        this._pipeWrite.write(JSON.stringify(message));
        this._pipeWrite.write('\0');
    }
    _dispatch(buffer: Buffer) {
        this.chunks.push(buffer);
        let end = buffer.indexOf(0);
        if (end === -1) { this._pendingBuffers.push(buffer); return; }
        this._pendingBuffers.push(buffer.subarray(0, end));
        const first = Buffer.concat(this._pendingBuffers).toString();
        this.scheduled.push(() => this.received.push(JSON.parse(first)));
        let start = end + 1;
        for (end = buffer.indexOf(0, start); end !== -1; end = buffer.indexOf(0, start)) {
            const text = buffer.toString('utf8', start, end);
            this.scheduled.push(() => this.received.push(JSON.parse(text)));
            start = end + 1;
        }
        this._pendingBuffers = [buffer.subarray(start)];
    }
}

function setup(emit?: (receipt: PipeReceipt) => void) {
    const transport = new Transport();
    let resolve!: (value: { transport: Transport }) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<{ transport: Transport }>((yes, no) => { resolve = yes; reject = no; });
    const original = vi.fn(function (..._args: unknown[]) { return promise; });
    const impl = { _launchProcess: original };
    const chromium = { _connection: { toImpl: vi.fn(() => impl) } };
    const receipts: PipeReceipt[] = [];
    const observer = observeOwnedPipe(chromium, '1.62.1', emit ?? (r => receipts.push(r)));
    return { transport, promise, resolve, reject, original, impl, chromium, receipts, observer };
}
async function bind(s: ReturnType<typeof setup>) {
    const promise = s.impl._launchProcess();
    s.resolve({ transport: s.transport });
    await promise;
}

describe('owned Playwright pipe observation integrity (not historical stall reproduction)', () => {
    it('installs before the caller await continuation and preserves the exact original promise and arguments', async () => {
        const prototype = Transport.prototype._dispatch;
        const other = new Transport();
        const s = setup();
        const descriptor = Object.getOwnPropertyDescriptor(s.impl, '_launchProcess');
        const args = [{}, () => undefined];
        const returned = s.impl._launchProcess(...args);
        expect(returned).toBe(s.promise);
        expect(s.original.mock.contexts[0]).toBe(s.impl);
        expect(s.original.mock.calls[0][0]).toBe(args[0]);
        expect(s.original.mock.calls[0][1]).toBe(args[1]);
        expect(s.impl._launchProcess).toBe(s.original);
        const continuation = returned.then(() => s.transport.send(command));
        s.resolve({ transport: s.transport });
        await continuation;
        expect(s.receipts.map(r => r.event)).toEqual(['pipe-write-start', 'pipe-write-return']);
        expect(other._dispatch).toBe(prototype);
        expect(Transport.prototype._dispatch).toBe(prototype);
        expect((await import('node:child_process')).spawn).toBe(spawn);
        s.observer.stop();
        expect(Object.hasOwn(s.transport, '_dispatch')).toBe(false);
        expect(Object.hasOwn(s.transport, 'send')).toBe(false);
        expect(s.transport._dispatch).toBe(prototype);
        // Original launch property is restored, not the observer descriptor.
        expect(Object.getOwnPropertyDescriptor(s.impl, '_launchProcess')?.value).toBe(s.original);
        expect(descriptor?.value).not.toBe(s.original);
    });

    it('preserves write receiver/callback identity, false return and thrown error', async () => {
        const s = setup();
        const error = new Error(secret);
        const callback = vi.fn();
        const original = s.transport._pipeWrite.write;
        await bind(s);
        expect(s.transport._pipeWrite.write('x', callback)).toBe(false);
        expect(original.mock.contexts[0]).toBe(s.transport._pipeWrite);
        expect(original.mock.calls[0][1]).toBe(callback);
        original.mockImplementationOnce(() => { throw error; });
        expect(() => s.transport.send(command)).toThrow(error);
        expect(s.receipts.map(r => r.event)).toEqual(['pipe-write-start']);
        s.observer.stop();
        expect(s.transport._pipeWrite.write).toBe(original);
    });

    it('observes split multibyte/coalesced matching root frames without changing buffers or deferred order', async () => {
        const s = setup();
        await bind(s);
        s.transport.send(command);
        s.transport.send({ id: 8, method: 'Target.setAutoAttach' });
        const child = frame({ id: 7, sessionId: 'child', result: secret });
        const unknown = frame({ id: 99, result: secret });
        const matching = frame({ id: 7, result: secret });
        const snow = matching.indexOf(Buffer.from('雪'));
        const chunks = [child, matching.subarray(0, snow + 1), Buffer.concat([matching.subarray(snow + 1), unknown])];
        const before = chunks.map(chunk => Buffer.from(chunk));
        for (const chunk of chunks) s.transport._dispatch(chunk);
        expect(s.receipts).toEqual([{ event: 'pipe-write-start', id: 7 }, { event: 'pipe-write-return', id: 7 }, { event: 'pipe-frame-observed', id: 7 }]);
        expect(s.transport.received).toEqual([]);
        expect(s.transport.chunks).toHaveLength(3);
        chunks.forEach((chunk, i) => { expect(s.transport.chunks[i]).toBe(chunk); expect(chunk.equals(before[i])).toBe(true); });
        s.transport.scheduled.forEach(callback => callback());
        expect(s.transport.received).toEqual([{ id: 7, sessionId: 'child', result: secret }, { id: 7, result: secret }, { id: 99, result: secret }]);
        expect(JSON.stringify(s.receipts)).not.toContain(secret);
        expect(s.receipts.every(r => Object.keys(r).every(k => ['event', 'id', 'reason'].includes(k)))).toBe(true);
        s.observer.stop();
    });

    it.each(['oversize', 'frame-count', 'malformed'] as const)('bounds observation of %s input while original dispatch remains intact', async kind => {
        const s = setup();
        await bind(s);
        s.transport.send(command);
        const buffer = kind === 'oversize' ? frame({ id: 7, result: 'x'.repeat(8192) })
            : kind === 'frame-count' ? Buffer.concat([...Array.from({ length: 17 }, () => frame({ id: 99 })), frame({ id: 7 })])
            : Buffer.from('{malformed\0');
        s.transport._dispatch(buffer);
        expect(s.transport.chunks).toEqual([buffer]);
        expect(s.receipts.some(r => r.event === 'pipe-frame-observed')).toBe(false);
        if (kind !== 'malformed') expect(s.receipts.at(-1)).toEqual({ event: 'pipe-observation-unavailable', reason: 'frame-bound' });
        // Even malformed input is delivered to the original parser/deferred handler.
        if (kind === 'malformed') expect(() => s.transport.scheduled[0]()).toThrow();
        s.observer.stop();
    });

    it('does not label unrelated sends, unknown IDs or standalone delimiters as getVersion writes', async () => {
        const s = setup();
        const write = s.transport._pipeWrite.write;
        await bind(s);
        s.transport.send({ id: 99, method: 'Target.setAutoAttach' });
        s.transport._pipeWrite.write('\0');
        expect(s.receipts).toEqual([]);
        s.transport.send(command);
        s.transport.send({ id: 99, method: 'Target.setAutoAttach' });
        s.transport._dispatch(frame({ id: 99 }));
        s.transport._pipeWrite.write('\0');
        s.transport.send({ id: 8, method: 'Browser.getVersion' });
        expect(s.receipts).toEqual([{ event: 'pipe-write-start', id: 7 }, { event: 'pipe-write-return', id: 7 }]);
        s.transport._dispatch(frame({ id: 7 }));
        expect(s.receipts.at(-1)).toEqual({ event: 'pipe-frame-observed', id: 7 });
        expect(write).toHaveBeenCalledTimes(10);
        s.observer.stop();
    });

    it('makes frame-bound unavailability terminal and restores taps before later matching frames', async () => {
        const s = setup();
        const write = s.transport._pipeWrite.write;
        await bind(s);
        const retainedDispatch = s.transport._dispatch;
        s.transport.send(command);
        s.transport._dispatch(Buffer.concat([frame({ id: 99, result: 'x'.repeat(8192) }), frame({ id: 7 })]));
        expect(s.receipts.at(-1)).toEqual({ event: 'pipe-observation-unavailable', reason: 'frame-bound' });
        const count = s.receipts.length;
        expect(Object.hasOwn(s.transport, 'send')).toBe(false);
        expect(Object.hasOwn(s.transport, '_dispatch')).toBe(false);
        expect(s.transport._pipeWrite.write).toBe(write);
        s.transport.send(command);
        s.transport._dispatch(frame({ id: 7 }));
        retainedDispatch.call(s.transport, frame({ id: 7 }));
        s.transport.scheduled.forEach(callback => callback());
        expect(s.transport.received).toHaveLength(4);
        expect(s.receipts).toHaveLength(count);
        expect(s.receipts.some(r => r.event === 'pipe-frame-observed')).toBe(false);
        s.observer.stop();
    });

    it('restores a partial bind and silences later receipts even if unavailable emission throws', async () => {
        const emitted: PipeReceipt[] = [];
        const s = setup(receipt => { emitted.push(receipt); throw new Error('sink'); });
        const write = s.transport._pipeWrite.write;
        const dispatch = s.transport._dispatch;
        Object.defineProperty(s.transport, '_dispatch', { configurable: false, writable: false, value: dispatch });
        await bind(s); // send/write hooks installed before dispatch replacement fails.
        expect(emitted).toEqual([{ event: 'pipe-observation-unavailable', reason: 'transport-shape' }]);
        expect(Object.hasOwn(s.transport, 'send')).toBe(false);
        expect(s.transport._pipeWrite.write).toBe(write);
        expect(s.transport._dispatch).toBe(dispatch);
        s.transport.send(command);
        s.transport._dispatch(frame({ id: 7 }));
        s.transport.scheduled.forEach(callback => callback());
        expect(s.transport.received).toEqual([{ id: 7 }]);
        expect(emitted).toHaveLength(1);
        s.observer.stop();
    });

    it('does not install or emit after teardown preceding launch fulfillment', async () => {
        const s = setup();
        const returned = s.impl._launchProcess();
        s.observer.stop();
        s.resolve({ transport: s.transport });
        await returned;
        s.transport.send(command);
        expect(s.receipts).toEqual([]);
        expect(Object.hasOwn(s.transport, '_dispatch')).toBe(false);
    });

    it('restores before a late reply and leaves original dispatch active', async () => {
        const s = setup();
        await bind(s);
        s.transport.send(command);
        s.observer.stop();
        const count = s.receipts.length;
        s.transport._dispatch(frame({ id: 7 }));
        s.transport.scheduled.forEach(callback => callback());
        expect(s.transport.received).toEqual([{ id: 7 }]);
        expect(s.receipts).toHaveLength(count);
    });

    it('preserves original launch rejection and synchronous throw identities', async () => {
        const error = Object.assign(new Error(secret), { name: 'TimeoutError', code: 'ORIGINAL' });
        const s = setup();
        const returned = s.impl._launchProcess();
        s.reject(error);
        await expect(returned).rejects.toBe(error);
        s.observer.stop();
        const impl = { _launchProcess() { throw error; } };
        const observer = observeOwnedPipe({ _connection: { toImpl: () => impl } }, '1.62.1', () => { throw new Error('sink'); });
        let thrown: unknown;
        try { impl._launchProcess(); } catch (e) { thrown = e; }
        expect(thrown).toBe(error);
        observer.stop();
    });

    it('ignores throwing diagnostics and restores exact own dispatch descriptors', async () => {
        const s = setup(() => { throw new Error('sink'); });
        const error = new Error(secret);
        const original = function () { throw error; };
        Object.defineProperty(s.transport, '_dispatch', { configurable: true, enumerable: false, writable: false, value: original });
        const descriptor = Object.getOwnPropertyDescriptor(s.transport, '_dispatch');
        await bind(s);
        s.transport.send(command);
        let thrown: unknown;
        try { s.transport._dispatch(frame({ id: 7 })); } catch (e) { thrown = e; }
        expect(thrown).toBe(error);
        s.observer.stop();
        expect(Object.getOwnPropertyDescriptor(s.transport, '_dispatch')).toEqual(descriptor);
    });

    it('disables only observation for unsupported versions and throwing private shape reads', () => {
        const emit = vi.fn();
        const impl = { _launchProcess: vi.fn() };
        const chromium = { _connection: { toImpl: () => impl } };
        observeOwnedPipe(chromium, 'unsupported', emit).stop();
        expect(emit).toHaveBeenCalledWith({ event: 'pipe-observation-unavailable', reason: 'version' });
        expect(impl._launchProcess).not.toHaveBeenCalled();
        observeOwnedPipe({ get _connection() { throw new Error(secret); } }, '1.62.1', emit).stop();
        expect(emit).toHaveBeenLastCalledWith({ event: 'pipe-observation-unavailable', reason: 'local-implementation' });
    });
});
