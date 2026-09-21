import { describe, expect, it } from 'vitest';
import { assertValidTimezone, isCronValidationBounded, validateCronExpression } from './cronValidation';

describe('HappyHerd cron validation', () => {
  it('accepts ordinary five and six-field schedules', () => {
    expect(validateCronExpression('0 8 * * *')).toBe(true);
    expect(validateCronExpression('0 */15 * * * *')).toBe(true);
  });

  it('rejects zero-step and pathological expansion before node-cron', () => {
    expect(isCronValidationBounded('*/0 * * * *')).toBe(false);
    expect(isCronValidationBounded('0-999999 * * * * *')).toBe(false);
  });

  it('validates IANA timezones', () => {
    expect(() => assertValidTimezone('America/New_York')).not.toThrow();
    expect(() => assertValidTimezone('Definitely/Not_A_Zone')).toThrow(/Invalid IANA timezone/);
  });
});
