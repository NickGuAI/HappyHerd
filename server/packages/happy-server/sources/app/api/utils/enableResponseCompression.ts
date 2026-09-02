import compress from '@fastify/compress';
import type {
    FastifyBaseLogger,
    FastifyInstance,
    FastifyTypeProvider,
    RawReplyDefaultExpression,
    RawRequestDefaultExpression,
    RawServerBase,
} from 'fastify';

export async function enableResponseCompression<
    RawServer extends RawServerBase,
    RawRequest extends RawRequestDefaultExpression<RawServer>,
    RawReply extends RawReplyDefaultExpression<RawServer>,
    Logger extends FastifyBaseLogger,
    TypeProvider extends FastifyTypeProvider,
>(
    app: FastifyInstance<RawServer, RawRequest, RawReply, Logger, TypeProvider>,
): Promise<void> {
    await app.register(compress, {
        global: true,
        globalDecompression: false,
    });
}
