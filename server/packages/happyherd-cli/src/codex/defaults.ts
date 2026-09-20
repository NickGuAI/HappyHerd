import type { PermissionMode } from '@/api/types';

/** Model used by native HappyHerd Codex sessions when no override is supplied. */
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';

/** Native HappyHerd Codex sessions use full-access mode when no override is supplied. */
export const DEFAULT_CODEX_PERMISSION_MODE: PermissionMode = 'yolo';
