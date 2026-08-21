import cron from 'node-cron';

// node-cron remains the semantic authority; this guard only prevents
// pathological range expansion.
const MAX_CRON_RANGE_VALUES = 10_000;
const RANGE_PATTERN = /(?<!\d)(?=(\d+)-(\d+)(?:\/(\d+))?)/g;
const ZERO_STEP_PATTERN = /\/0+(?!\d)/;
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;
const SHORT_MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const SHORT_WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const ASTERISK_RANGES = ['0-59', '0-59', '0-23', '1-31', '1-12', '0-6'] as const;

function replaceNames(expression: string, names: readonly string[], offset: number): string {
  return names.reduce(
    (current, name, index) => current.replace(new RegExp(name, 'gi'), String(index + offset)),
    expression,
  );
}

function prepareRangeExpressions(expression: string): string[] {
  let expressions = expression.replace(/\s{2,}/g, ' ').trim().split(' ');
  if (expressions.length === 5) expressions = ['0', ...expressions];
  if (expressions[4] !== undefined) {
    expressions[4] = replaceNames(replaceNames(expressions[4], MONTH_NAMES, 1), SHORT_MONTH_NAMES, 1);
  }
  if (expressions[5] !== undefined) {
    expressions[5] = replaceNames(
      replaceNames(expressions[5].replace('7', '0'), WEEKDAY_NAMES, 0),
      SHORT_WEEKDAY_NAMES,
      0,
    );
  }
  for (let index = 0; index < ASTERISK_RANGES.length; index += 1) {
    if (expressions[index]?.includes('*')) {
      expressions[index] = expressions[index].replace('*', ASTERISK_RANGES[index]);
    }
  }
  return expressions;
}

export function isCronValidationBounded(expression: string): boolean {
  if (ZERO_STEP_PATTERN.test(expression)) return false;
  let totalValues = 0;
  for (const field of prepareRangeExpressions(expression)) {
    for (const match of field.matchAll(RANGE_PATTERN)) {
      let first = Number.parseInt(match[1], 10);
      let last = Number.parseInt(match[2], 10);
      const step = Number.parseInt(match[3] ?? '1', 10);
      if (![first, last].every(Number.isFinite) || Number.isNaN(step) || step <= 0) return false;
      if (first > last) [first, last] = [last, first];
      for (let value = first; value <= last;) {
        totalValues += 1;
        if (totalValues > MAX_CRON_RANGE_VALUES) return false;
        const next = value + step;
        if (next <= value) return false;
        value = next;
      }
    }
  }
  return true;
}

export function validateCronExpression(expression: string): boolean {
  return isCronValidationBounded(expression) && cron.validate(expression);
}

export function assertValidCron(expression: string): void {
  if (!validateCronExpression(expression)) {
    throw new Error(`Invalid or unsafe cron expression: ${expression}`);
  }
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}
