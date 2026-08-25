import { describe, expect, it } from 'vitest';

import { resolveAcpPermissionResponse } from './AcpBackend';

const options = [
  { optionId: 'provider-once', name: 'Approve once', kind: 'allow_once' },
  { optionId: 'provider-always', name: 'Approve always', kind: 'allow_always' },
  { optionId: 'provider-deny', name: 'Reject', kind: 'reject_once' },
] as const;

describe('ACP permission responses', () => {
  it('returns the provider option ID matching the standard permission kind', () => {
    expect(resolveAcpPermissionResponse([...options], 'approved')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-once' },
    });
    expect(resolveAcpPermissionResponse([...options], 'approved_for_session')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-always' },
    });
    expect(resolveAcpPermissionResponse([...options], 'denied')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-deny' },
    });
  });

  it('cancels instead of inventing an option ID on abort or mismatch', () => {
    expect(resolveAcpPermissionResponse([...options], 'abort')).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(resolveAcpPermissionResponse([], 'approved')).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(resolveAcpPermissionResponse([
      { optionId: 'provider-always', name: 'Approve always', kind: 'allow_always' },
    ], 'approved')).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});
