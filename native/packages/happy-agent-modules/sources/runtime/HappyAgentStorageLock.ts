import { randomUUID } from "node:crypto";
import { open, readFile, unlink, type FileHandle } from "node:fs/promises";

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { AgentStorageLock } from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

const lockRecordSchema = Type.Object(
    {
        pid: Type.Integer({ minimum: 1 }),
        token: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
);
type LockRecord = Static<typeof lockRecordSchema>;

/** Acquire the single-owner process lock required by AgentStorage. */
export async function acquireHappyAgentStorageLock(path: string): Promise<AgentStorageLock> {
    const record: LockRecord = { pid: process.pid, token: randomUUID() };
    const handle = await createLockFile(path, record);
    return new FileAgentStorageLock(path, handle, record.token);
}

class FileAgentStorageLock implements AgentStorageLock {
    readonly #path: string;
    readonly #handle: FileHandle;
    readonly #token: string;
    #released = false;

    constructor(path: string, handle: FileHandle, token: string) {
        this.#path = path;
        this.#handle = handle;
        this.#token = token;
    }

    async release(_ctx: Context): Promise<void> {
        if (this.#released) return;
        this.#released = true;
        try {
            const current = await readLockRecord(this.#path);
            if (current?.token === this.#token) await unlink(this.#path);
        } finally {
            await this.#handle.close();
        }
    }
}

async function createLockFile(path: string, record: LockRecord): Promise<FileHandle> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const handle = await open(path, "wx", 0o600);
            try {
                await handle.writeFile(JSON.stringify(record), "utf8");
                await handle.sync();
                return handle;
            } catch (error) {
                await handle.close();
                await unlink(path).catch(() => undefined);
                throw error;
            }
        } catch (error) {
            if (!isAlreadyExists(error)) throw error;
            const owner = await readLockRecord(path);
            if (owner !== undefined && processExists(owner.pid)) {
                throw new Error(
                    `The Happy agent store is already owned by process ${String(owner.pid)}.`,
                );
            }
            await unlink(path).catch((unlinkError: unknown) => {
                if (!isMissing(unlinkError)) throw unlinkError;
            });
        }
    }
    throw new Error("The Happy agent store lock could not be acquired.");
}

async function readLockRecord(path: string): Promise<LockRecord | undefined> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        return Value.Check(lockRecordSchema, parsed) ? parsed : undefined;
    } catch (error) {
        if (isMissing(error) || error instanceof SyntaxError) return undefined;
        throw error;
    }
}

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !isNoSuchProcess(error);
    }
}

function isAlreadyExists(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isNoSuchProcess(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
}
