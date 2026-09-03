import * as z from 'zod';

// Workspace-live values are encrypted and then base64 encoded before they are
// carried by Socket.IO. Eight MiB leaves ample room below its 20 MiB frame
// limit for both base64 expansions, JSON, headers, and encryption data.
export const MAX_WORKSPACE_LIVE_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH = Math.ceil(MAX_WORKSPACE_LIVE_BODY_BYTES / 3) * 4;
export const MAX_WORKSPACE_LIVE_HEADER_COUNT = 128;
export const MAX_WORKSPACE_LIVE_HEADER_CHARACTERS = 256 * 1024;
export const MAX_WORKSPACE_LIVE_REDIRECTS = 10;

const WORKSPACE_LIVE_RAW_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i;

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let index = 0; index < value.length - padding; index += 1) {
    const code = value.charCodeAt(index);
    const isAlphaNumeric = (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122);
    if (!isAlphaNumeric && code !== 43 && code !== 47) return false;
  }
  for (let index = value.length - padding; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

const WorkspaceLiveBodySchema = z.string()
  .max(MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH)
  .refine(isCanonicalBase64, 'Expected canonical base64 body')
  .refine((value) => {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding <= MAX_WORKSPACE_LIVE_BODY_BYTES;
  }, 'Workspace live body is too large');

const WorkspaceLiveHeadersSchema = z.record(
  z.string().min(1).max(256),
  z.string().max(16 * 1024),
).superRefine((headers, context) => {
  const entries = Object.entries(headers);
  const characters = entries.reduce((total, [name, value]) => total + name.length + value.length, 0);
  if (entries.length > MAX_WORKSPACE_LIVE_HEADER_COUNT) {
    context.addIssue({ code: 'custom', message: 'Too many workspace live headers' });
  }
  if (characters > MAX_WORKSPACE_LIVE_HEADER_CHARACTERS) {
    context.addIssue({ code: 'custom', message: 'Workspace live headers are too large' });
  }
});

/**
 * Accept only the owner-approved, textually exact loopback authorities.
 *
 * This intentionally checks the raw authority before URL parsing. WHATWG URL
 * canonicalization otherwise turns aliases such as `127.1`, `2130706433`, or
 * `0x7f000001` into `127.0.0.1`, silently widening the boundary.
 */
export function isWorkspaceLiveLoopbackUrl(value: string): boolean {
  if (!WORKSPACE_LIVE_RAW_URL.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
  } catch {
    return false;
  }
}

/** Resolve one redirect without allowing URL parsing to canonicalize a raw
 * non-approved authority into an approved spelling. Relative redirects remain
 * on the already validated loopback origin unless they explicitly select a
 * different, independently validated loopback authority. */
export function resolveWorkspaceLiveRedirectUrl(currentUrl: string, location: string): string | null {
  if (location.includes('\\')) return null;
  const absoluteScheme = /^[A-Za-z][A-Za-z\d+.-]*:/.test(location);
  const networkPath = location.startsWith('//');
  if (absoluteScheme && !isWorkspaceLiveLoopbackUrl(location)) return null;
  try {
    if (networkPath) {
      const currentProtocol = new URL(currentUrl).protocol;
      if (!isWorkspaceLiveLoopbackUrl(`${currentProtocol}${location}`)) return null;
    }
    const resolved = new URL(location, currentUrl).toString();
    return isWorkspaceLiveLoopbackUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export const WorkspaceLiveHttpRequestSchema = z.object({
  url: z.string().max(8 * 1024).refine(isWorkspaceLiveLoopbackUrl, 'Expected an exact loopback HTTP(S) URL'),
  method: z.string().regex(/^[A-Z]+$/).max(16),
  headers: WorkspaceLiveHeadersSchema,
  body: WorkspaceLiveBodySchema.optional(),
}).strict();

export type WorkspaceLiveHttpRequest = z.infer<typeof WorkspaceLiveHttpRequestSchema>;

export const WorkspaceLiveHttpResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    status: z.number().int().min(100).max(599),
    statusText: z.string().max(1024),
    headers: WorkspaceLiveHeadersSchema,
    body: WorkspaceLiveBodySchema,
    finalUrl: z.string().max(8 * 1024).refine(isWorkspaceLiveLoopbackUrl),
  }).strict(),
  z.object({
    success: z.literal(false),
    code: z.enum([
      'invalid-request',
      'invalid-url',
      'too-large',
      'redirect-limit',
      'request-failed',
      'unavailable',
    ]),
    error: z.string().max(4 * 1024),
  }).strict(),
]);

export type WorkspaceLiveHttpResponse = z.infer<typeof WorkspaceLiveHttpResponseSchema>;
