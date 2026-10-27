/**
 * Session-scoped choices that the CLI must attach to its next queued Human
 * message. A null model or effort is meaningful: it resets that override to
 * the provider's default, matching the app's per-message contract.
 */
export function sessionTaskSettings(metadata: unknown): {
  model?: string | null;
  effort?: string | null;
  permissionMode?: string;
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const value = metadata as Record<string, unknown>;
  const result: {
    model?: string | null;
    effort?: string | null;
    permissionMode?: string;
  } = {};

  if (value.modelMode === 'default') {
    result.model = null;
  } else if (value.modelMode === null || typeof value.modelMode === 'string') {
    result.model = value.modelMode;
  }
  if (value.effortLevel === null || typeof value.effortLevel === 'string') {
    result.effort = value.effortLevel;
  }
  if (value.flavor !== 'grok' && value.flavor !== 'dsh'
    && typeof value.permissionMode === 'string' && value.permissionMode.length > 0) {
    result.permissionMode = value.permissionMode;
  }

  return result;
}
