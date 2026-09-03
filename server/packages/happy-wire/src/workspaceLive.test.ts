import { describe, expect, it } from 'vitest';
import {
  isWorkspaceLiveLoopbackUrl,
  MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH,
  resolveWorkspaceLiveRedirectUrl,
  WorkspaceLiveHttpRequestSchema,
  WorkspaceLiveHttpResponseSchema,
} from './workspaceLive';

describe('Workspace live localhost wire contract', () => {
  it.each([
    'http://localhost:3000',
    'https://LOCALHOST/path?q=1#result',
    'http://127.0.0.1:5173/path',
    'http://[::1]:8080/',
  ])('accepts exact loopback target %s', (url) => {
    expect(isWorkspaceLiveLoopbackUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com',
    'http://127.0.0.2:3000',
    'http://127.1:3000',
    'http://2130706433:3000',
    'http://0x7f000001:3000',
    'http://localhost.:3000',
    'http://localhost.example:3000',
    'http://localhost@evil.example:3000',
    'http://[::1%25lo0]:3000',
    'file:///tmp/index.html',
    'not-a-url',
  ])('rejects non-exact loopback target %s', (url) => {
    expect(isWorkspaceLiveLoopbackUrl(url)).toBe(false);
    expect(WorkspaceLiveHttpRequestSchema.safeParse({
      url,
      method: 'GET',
      headers: {},
    }).success).toBe(false);
  });

  it('keeps request and response fields explicit', () => {
    expect(WorkspaceLiveHttpRequestSchema.parse({
      url: 'http://localhost:3000/api',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-test': 'preserved' },
      body: 'e30=',
    })).toEqual({
      url: 'http://localhost:3000/api',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-test': 'preserved' },
      body: 'e30=',
    });
    expect(WorkspaceLiveHttpResponseSchema.parse({
      success: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html', 'x-workspace-test': 'preserved' },
      body: 'PGgxPk9LPC9oMT4=',
      finalUrl: 'http://localhost:3000/',
    })).toMatchObject({ success: true, status: 200 });
  });

  it('rejects malformed and oversized bodies before transport', () => {
    const request = {
      url: 'http://127.0.0.1:3000/',
      method: 'POST',
      headers: {},
    };
    expect(WorkspaceLiveHttpRequestSchema.safeParse({ ...request, body: 'not base64' }).success).toBe(false);
    expect(WorkspaceLiveHttpRequestSchema.safeParse({
      ...request,
      body: 'A'.repeat(MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH),
    }).success).toBe(false);
    expect(WorkspaceLiveHttpRequestSchema.safeParse({
      ...request,
      body: 'A'.repeat(MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH + 4),
    }).success).toBe(false);
  });

  it('revalidates raw absolute and network-path redirect authorities', () => {
    expect(resolveWorkspaceLiveRedirectUrl('http://localhost:3000/start', '/next')).toBe(
      'http://localhost:3000/next',
    );
    expect(resolveWorkspaceLiveRedirectUrl('http://localhost:3000/start', 'http://127.0.0.1:4000/next')).toBe(
      'http://127.0.0.1:4000/next',
    );
    expect(resolveWorkspaceLiveRedirectUrl('http://localhost:3000/start', 'http://127.1:4000/next')).toBeNull();
    expect(resolveWorkspaceLiveRedirectUrl('http://localhost:3000/start', '//2130706433:4000/next')).toBeNull();
    expect(resolveWorkspaceLiveRedirectUrl('http://localhost:3000/start', '\\\\evil.example/next')).toBeNull();
    expect(resolveWorkspaceLiveRedirectUrl('http://localhost:3000/start', 'https://example.com/next')).toBeNull();
  });
});
