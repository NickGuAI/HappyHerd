import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('Inbox read-state migration', () => {
    it('preserves existing feed contents and leaves existing and new items unread', async () => {
        const db = new PGlite();
        try {
            await db.exec('CREATE TABLE "Account" ("id" TEXT PRIMARY KEY); INSERT INTO "Account" VALUES (\'owner\')');
            const migration = (name: string) => readFile(resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'), 'utf8');
            await db.exec(await migration('20250920213557_add_user_feed'));
            await db.exec(`INSERT INTO "UserFeedItem" ("id", "userId", "counter", "body", "updatedAt")
                VALUES ('existing', 'owner', 1, '{"kind":"text","text":"preserved"}', CURRENT_TIMESTAMP)`);
            await db.exec(await migration('20260930000000_add_feed_read_at'));
            expect((await db.query('SELECT "id", "body", "readAt" FROM "UserFeedItem"')).rows).toEqual([
                { id: 'existing', body: { kind: 'text', text: 'preserved' }, readAt: null }
            ]);
            await db.exec(`INSERT INTO "UserFeedItem" ("id", "userId", "counter", "body", "updatedAt")
                VALUES ('new', 'owner', 2, '{"kind":"text","text":"new"}', CURRENT_TIMESTAMP)`);
            expect((await db.query('SELECT "readAt" FROM "UserFeedItem" WHERE "id" = \'new\'')).rows).toEqual([{ readAt: null }]);
        } finally {
            await db.close();
        }
    });
});
