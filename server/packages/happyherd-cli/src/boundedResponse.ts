/** Streaming response readers with hard byte ceilings. */

export async function readBoundedBytes(response: Response, maximumBytes: number, label: string): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('response byte limit is invalid');
  const declaredText = response.headers.get('content-length');
  if (declaredText !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(declaredText)) throw new Error(`${label} Content-Length is invalid`);
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared) || declared > maximumBytes) throw new Error(`${label} exceeds the byte limit`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try { await reader.cancel('response exceeds byte limit'); } catch { /* the size error remains authoritative */ }
        throw new Error(`${label} exceeds the byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readBoundedJson(response: Response, maximumBytes: number, label: string): Promise<unknown> {
  const bytes = await readBoundedBytes(response, maximumBytes, label);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}
