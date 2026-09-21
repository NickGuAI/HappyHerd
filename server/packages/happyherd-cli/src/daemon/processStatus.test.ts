import { describe, expect, it, vi } from 'vitest';

import { hasProviderProcessExited } from './processStatus';

function probeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('hasProviderProcessExited', () => {
  it('reports exit only when the operating system says the PID is missing', () => {
    const probe = vi.fn(() => {
      throw probeError('ESRCH');
    });

    expect(hasProviderProcessExited(42, probe)).toBe(true);
    expect(probe).toHaveBeenCalledWith(42, 0);
  });

  it('keeps the session active when the process exists', () => {
    expect(hasProviderProcessExited(42, vi.fn())).toBe(false);
  });

  it('does not treat permission or unknown probe failures as process exit', () => {
    const deniedProbe = vi.fn(() => {
      throw probeError('EPERM');
    });
    const unknownProbe = vi.fn(() => {
      throw new Error('probe failed');
    });

    expect(hasProviderProcessExited(42, deniedProbe)).toBe(false);
    expect(hasProviderProcessExited(42, unknownProbe)).toBe(false);
  });
});
