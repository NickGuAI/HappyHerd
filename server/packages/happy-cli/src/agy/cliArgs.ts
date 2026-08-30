/**
 * Agy CLI argument builder
 *
 * Pure function that turns a turn's parameters into the argv for `agy --print`.
 * Kept separate from the backend so it can be unit-tested in isolation.
 */

import type { PermissionMode } from '@/api/types';

export type AgyPermissionMode = Extract<PermissionMode, 'default' | 'bypassPermissions'>;

export function isAgyPermissionMode(value: unknown): value is AgyPermissionMode {
  return value === 'default' || value === 'bypassPermissions';
}

export function parseAgyPermissionMode(value: string): AgyPermissionMode {
  if (!isAgyPermissionMode(value)) {
    throw new Error(`Unsupported Antigravity permission mode: ${value}`);
  }
  return value;
}

export interface BuildAgyArgsOptions {
  /** The user prompt for this turn. */
  prompt: string;
  /** Model display name passed to `--model` (e.g. "Gemini 3.1 Pro (High)"). */
  model?: string;
  /** Conversation id to resume via `--conversation`; omit/null for a fresh conversation. */
  conversationId?: string | null;
  /** Happy permission mode for this turn. */
  permissionMode: AgyPermissionMode;
  /** Directories to expose to agy via repeatable `--add-dir`. */
  addDirs?: string[];
  /** Value for `--print-timeout` (e.g. "10m"). */
  printTimeout?: string;
}

/**
 * Build the argv for a single `agy --print` invocation. The prompt is placed
 * last (as the value of `--print`) so all preceding flags parse cleanly.
 */
export function buildAgyArgs(opts: BuildAgyArgsOptions): string[] {
  if (!isAgyPermissionMode(opts.permissionMode)) {
    throw new Error(`Unsupported Antigravity permission mode: ${String(opts.permissionMode)}`);
  }
  const args: string[] = [];

  if (opts.conversationId) {
    args.push('--conversation', opts.conversationId);
  }
  if (opts.model) {
    args.push('--model', opts.model);
  }
  if (opts.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--sandbox');
  }
  for (const dir of opts.addDirs ?? []) {
    args.push('--add-dir', dir);
  }
  if (opts.printTimeout) {
    args.push('--print-timeout', opts.printTimeout);
  }

  args.push('--print', opts.prompt);
  return args;
}
