/**
 * Canonical Claude model IDs exposed by HappyHerd.
 *
 * Claude Code accepts full model IDs through `--model`, but it does not expose
 * a machine-readable model-list command. Keep the release catalog explicit so
 * UI labels and launch values cannot drift or be inferred from CLI help prose.
 */
export const HAPPYHERD_CLAUDE_MODEL_SLUGS = [
    'claude-fable-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-6',
    'claude-sonnet-5',
    'claude-haiku-4-5',
] as const;

export const HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG = 'claude-opus-5';

/** Exact display names accepted by `agy --model`, as printed by `agy models`. */
export const HAPPYHERD_AGY_MODEL_NAMES = [
    'Gemini 3.6 Flash (Medium)',
    'Gemini 3.6 Flash (High)',
    'Gemini 3.6 Flash (Low)',
    'Gemini 3.5 Flash (Medium)',
    'Gemini 3.5 Flash (High)',
    'Gemini 3.5 Flash (Low)',
    'Gemini 3.1 Pro (Low)',
    'Gemini 3.1 Pro (High)',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)',
] as const;

const LEGACY_CLAUDE_MODEL_ALIASES: Readonly<Record<string, string>> = {
    fable: 'claude-fable-5',
    opus: 'claude-opus-5',
    sonnet: 'claude-sonnet-5',
    haiku: 'claude-haiku-4-5',
};

/** Migrate persisted pre-slug selections without putting aliases back in UI catalogs. */
export function normalizeHappyHerdClaudeModelSlug(value: string): string {
    return LEGACY_CLAUDE_MODEL_ALIASES[value] ?? value;
}
