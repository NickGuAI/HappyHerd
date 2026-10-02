import type { IncomingMessage, ServerResponse } from "node:http";

export interface SseWriter {
    readonly closed: boolean;
    readonly done: Promise<void>;
    heartbeat(frame: string): void;
    write(frame: string): boolean;
    close(): void;
}

export interface SseWriterOptions {
    readonly maxBufferedBytes?: number;
    readonly maxWritableBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_024 * 1_024;

/** A bounded whole-frame SSE writer that resumes exclusively from Node's `drain` signal. */
export function createSseWriter(
    request: IncomingMessage,
    response: ServerResponse,
    options: SseWriterOptions = {},
): SseWriter {
    const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BYTES;
    const maxWritableBytes = options.maxWritableBytes ?? DEFAULT_MAX_BYTES;
    const queue: { readonly bytes: number; readonly frame: string }[] = [];
    let bufferedBytes = 0;
    let blocked = false;
    let closed = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
    });

    const finish = (): void => {
        close(false);
    };
    const drain = (): void => {
        if (closed) return;
        blocked = false;
        flush();
    };
    request.once("close", finish);
    response.once("close", finish);
    response.once("finish", finish);
    response.on("drain", drain);

    const api: SseWriter = {
        get closed() {
            return closed;
        },
        done,
        heartbeat: (frame) => {
            if (!blocked && queue.length === 0) write(frame);
        },
        write,
        close: () => close(true),
    };
    return api;

    function write(frame: string): boolean {
        if (closed || response.destroyed || response.writableEnded) {
            close(false);
            return false;
        }
        const bytes = Buffer.byteLength(frame, "utf8");
        if (blocked || queue.length > 0) {
            if (bufferedBytes + bytes > maxBufferedBytes) {
                close(false, true);
                return false;
            }
            queue.push({ bytes, frame });
            bufferedBytes += bytes;
            return true;
        }
        return writeNow(frame);
    }

    function writeNow(frame: string): boolean {
        try {
            if (response.writableLength > maxWritableBytes) {
                close(false, true);
                return false;
            }
            blocked = !response.write(frame);
            if (response.writableLength > maxWritableBytes) {
                close(false, true);
                return false;
            }
            return true;
        } catch {
            close(false, true);
            return false;
        }
    }

    function flush(): void {
        while (!closed && !blocked) {
            const next = queue.shift();
            if (next === undefined) return;
            bufferedBytes -= next.bytes;
            if (!writeNow(next.frame)) return;
        }
    }

    function close(endResponse: boolean, destroy = false): void {
        if (closed) return;
        closed = true;
        queue.length = 0;
        bufferedBytes = 0;
        request.off("close", finish);
        response.off("close", finish);
        response.off("finish", finish);
        response.off("drain", drain);
        if (destroy && !response.destroyed) {
            response.destroy();
        } else if (
            endResponse &&
            response.headersSent &&
            !response.destroyed &&
            !response.writableEnded
        ) {
            response.end();
        }
        resolveDone();
    }
}
