import { describe, expect, it } from 'vitest';
import { readBoundedBytes, readBoundedJson } from './boundedResponse';

function stream(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { onCancel?.(); },
  });
}

describe('bounded response reader', () => {
  it('accepts a response without Content-Length below the hard limit', async () => {
    const response = new Response(stream([Buffer.from('{"ok":'), Buffer.from('true}')]), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(readBoundedJson(response, 64, 'fixture')).resolves.toEqual({ ok: true });
  });

  it('cancels a chunked response that crosses the hard limit', async () => {
    let cancelled = false;
    const response = new Response(stream([Buffer.alloc(5), Buffer.alloc(5)], () => { cancelled = true; }));
    await expect(readBoundedBytes(response, 8, 'fixture')).rejects.toThrow('exceeds the byte limit');
    expect(cancelled).toBe(true);
  });

  it('does not trust an understated Content-Length', async () => {
    const response = new Response(stream([Buffer.alloc(9)]), { headers: { 'content-length': '1' } });
    await expect(readBoundedBytes(response, 8, 'fixture')).rejects.toThrow('exceeds the byte limit');
  });

  it('rejects an oversized declared response before reading the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(Buffer.alloc(1)); controller.close(); },
    });
    const response = new Response(body, { headers: { 'content-length': '9' } });
    await expect(readBoundedBytes(response, 8, 'fixture')).rejects.toThrow('exceeds the byte limit');
  });
});
