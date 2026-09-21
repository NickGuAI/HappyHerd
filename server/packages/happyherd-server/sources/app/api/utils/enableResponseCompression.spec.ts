import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';

import { enableResponseCompression } from './enableResponseCompression';

describe('response compression', () => {
    it('compresses large JavaScript responses when the client advertises gzip', async () => {
        const app = fastify();
        app.addHook('onSend', async (_request, _reply, payload) => {
            return typeof payload === 'string' ? payload.replace('__happyherd', '__happyherdCompressed') : payload;
        });
        await enableResponseCompression(app);
        const bundle = 'globalThis.__happyherd = true;\n'.repeat(2_000);
        app.get('/bundle.js', (_request, reply) => {
            reply.type('application/javascript').send(bundle);
        });

        const response = await app.inject({
            method: 'GET',
            url: '/bundle.js',
            headers: { 'accept-encoding': 'gzip' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe('gzip');
        expect(response.rawPayload.byteLength).toBeLessThan(Buffer.byteLength(bundle) * 0.3);
        expect(gunzipSync(response.rawPayload).toString()).toContain('__happyherdCompressed');
        await app.close();
    });
});
