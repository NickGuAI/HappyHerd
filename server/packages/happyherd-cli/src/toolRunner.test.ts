import { describe, expect, it } from 'vitest';
import {
  MAX_SANITIZED_TOOL_STREAM_BYTES,
  sanitizedOutput,
} from './toolRunner';

describe('managed tool output boundary', () => {
  it('bounds invalid UTF-8 by the final encoded bytes', () => {
    const output = sanitizedOutput(Buffer.alloc(MAX_SANITIZED_TOOL_STREAM_BYTES, 0xff), 'token-value-that-is-long-enough');
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(MAX_SANITIZED_TOOL_STREAM_BYTES);
    expect(output.length).toBeGreaterThan(0);
  });

  it('keeps both maximally escaped JSON streams under the broker response ceiling', () => {
    const hostile = Buffer.from('"\\\t'.repeat(MAX_SANITIZED_TOOL_STREAM_BYTES));
    const stdout = sanitizedOutput(hostile, 'token-value-that-is-long-enough');
    const stderr = sanitizedOutput(hostile, 'token-value-that-is-long-enough');
    expect(Buffer.byteLength(stdout, 'utf8')).toBe(MAX_SANITIZED_TOOL_STREAM_BYTES);
    const response = Buffer.from(JSON.stringify({ schemaVersion: 1, status: 0, stdout, stderr }));
    expect(response.length).toBeLessThan(5 * 1024 * 1024);
  });

  it('redacts tokens and strips terminal escapes before byte truncation', () => {
    const token = 'token-value-that-is-long-enough';
    const output = sanitizedOutput(Buffer.from(`\u001b[31m${token}\u001b[0m`), token);
    expect(output).toBe('[REDACTED]');
  });
});
