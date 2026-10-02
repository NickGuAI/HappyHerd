import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readGrokAuthStore, type GrokAuthRecord } from "@/vendors/grok/impl/auth.js";

/**
 * Merges one scope's fields into the shared Grok auth store.
 *
 * The store is owned by the Grok CLI, so the current contents are re-read at write
 * time and every other scope is preserved. The replacement is staged in a sibling
 * file and renamed so a concurrent reader never observes a partial credential.
 */
export async function writeGrokAuthRecord(
    path: string,
    scope: string,
    patch: GrokAuthRecord,
): Promise<void> {
    const store = await readGrokAuthStore(path);
    const next = { ...store, [scope]: { ...store[scope], ...patch } };
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
    const staged = join(dirname(path), `.${randomUUID()}.auth.json`);
    try {
        await writeFile(staged, `${JSON.stringify(next, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
        });
        await rename(staged, path);
    } finally {
        await rm(staged, { force: true });
    }
}
