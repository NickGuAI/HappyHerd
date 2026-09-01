import type { PermissionMode } from '@/api/types';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import { hashObject } from '@/utils/deterministicJson';
import {
    composeUserSafeguardPrompt,
    resolveUserSafeguardPromptMode,
} from '@/userSafeguard/userSafeguard';

import type { ReasoningEffort } from './codexAppServerTypes';
import type { HappyHerdHeartbeatMessageMarker } from '@slopus/happy-wire';

export interface CodexEnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    /** Exact developer instructions injected before this queued turn. */
    developerInstructions?: string;
    /** Reasoning effort passed through to Codex's sendTurnAndWait. */
    effort?: ReasoningEffort;
    /** Queue-only marker carried with an isolated heartbeat turn. */
    heartbeat?: HappyHerdHeartbeatMessageMarker;
}

export interface AppliedCodexDeveloperInstructions {
    threadId: string;
    instructions: string;
}

export function hashCodexEnhancedMode(mode: CodexEnhancedMode): string {
    return hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        developerInstructions: mode.developerInstructions,
        effort: mode.effort,
    });
}

export function buildCodexDeveloperInstructions(opts: {
    appAppendSystemPrompt?: string;
    userSafeguardEnabled?: boolean;
    automation: boolean;
}): string | undefined {
    return composeUserSafeguardPrompt(
        opts.automation ? undefined : opts.appAppendSystemPrompt,
        resolveUserSafeguardPromptMode(opts.userSafeguardEnabled, opts.automation),
    );
}

export function shouldInjectCodexDeveloperInstructions(
    threadId: string,
    instructions: string | undefined,
    applied: AppliedCodexDeveloperInstructions | undefined,
): boolean {
    return Boolean(instructions) && (
        applied?.threadId !== threadId
        || applied.instructions !== instructions
    );
}

/**
 * Happy wraps the change-title instruction in these sentinel markers inside
 * Codex turn text. `stripHappySystemBlocks` also understands historical turns
 * that wrapped app append-system prompts here, so fork/duplicate/side-chat
 * backfills keep showing only what the Human typed. Current app and safeguard
 * instructions travel as app-server developer instructions instead.
 */
export const HAPPY_SYSTEM_BLOCK_OPEN = '<happy-system>';
export const HAPPY_SYSTEM_BLOCK_CLOSE = '</happy-system>';

function wrapHappySystem(text: string): string {
    return `${HAPPY_SYSTEM_BLOCK_OPEN}\n${text}\n${HAPPY_SYSTEM_BLOCK_CLOSE}`;
}

/**
 * Remove any `<happy-system>…</happy-system>` blocks (and the blank lines that
 * join them to the user's text) from a Codex turn string, leaving only what the
 * user actually wrote. Safe to call on text that has no markers.
 */
export function stripHappySystemBlocks(text: string): string {
    const open = HAPPY_SYSTEM_BLOCK_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const close = HAPPY_SYSTEM_BLOCK_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\s*${open}[\\s\\S]*?${close}\\s*`, 'g');
    return text.replace(re, '\n\n').trim();
}

export function buildCodexTurnPrompt(opts: {
    message: string;
    includeTitleInstruction: boolean;
}): string {
    const parts: string[] = [];

    parts.push(opts.message);

    if (opts.includeTitleInstruction) {
        parts.push(wrapHappySystem(CHANGE_TITLE_INSTRUCTION));
    }

    return parts.join('\n\n');
}
