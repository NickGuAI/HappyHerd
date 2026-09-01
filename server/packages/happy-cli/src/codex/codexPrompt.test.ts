import { describe, expect, it } from 'vitest';

import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import {
    buildCodexDeveloperInstructions,
    buildCodexTurnPrompt,
    hashCodexEnhancedMode,
    shouldInjectCodexDeveloperInstructions,
    stripHappySystemBlocks,
    type CodexEnhancedMode,
} from './codexPrompt';

const HISTORICAL_APPEND = '<options><option>Yes</option></options>';
const wrapped = (text: string) => `<happy-system>\n${text}\n</happy-system>`;

describe('buildCodexDeveloperInstructions', () => {
    it('isolates Human safeguard state across a heartbeat and supports explicit disable', () => {
        const human = {
            appAppendSystemPrompt: 'render option chips',
            userSafeguardEnabled: true,
        };
        const enabled = buildCodexDeveloperInstructions({ ...human, automation: false });
        const heartbeat = buildCodexDeveloperInstructions({ ...human, automation: true });
        const restored = buildCodexDeveloperInstructions({ ...human, automation: false });
        const disabled = buildCodexDeveloperInstructions({
            ...human,
            userSafeguardEnabled: false,
            automation: false,
        });

        expect(enabled).toContain('render option chips');
        expect(enabled).toContain('<skill name="happyherd-user-safeguard">');
        expect(heartbeat).toContain('# HappyHerd automation boundary');
        expect(heartbeat).not.toContain('render option chips');
        expect(heartbeat).not.toContain('<skill name="happyherd-user-safeguard">');
        expect(restored).toBe(enabled);
        expect(disabled).toContain('render option chips');
        expect(disabled).toContain('account safeguard is disabled');
        expect(disabled).not.toContain('<skill name="happyherd-user-safeguard">');
    });

    it('re-injects unchanged instructions when recovery creates a new thread', () => {
        const applied = {
            threadId: 'thread-before-restart',
            instructions: 'Human safeguard enabled',
        };

        expect(shouldInjectCodexDeveloperInstructions(
            'thread-before-restart',
            'Human safeguard enabled',
            applied,
        )).toBe(false);
        expect(shouldInjectCodexDeveloperInstructions(
            'thread-after-resume-failure',
            'Human safeguard enabled',
            applied,
        )).toBe(true);
    });
});

describe('buildCodexTurnPrompt', () => {
    it('keeps developer and safeguard instructions out of Codex user content', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'pick an option',
            includeTitleInstruction: true,
        });

        expect(prompt).toBe(
            'pick an option\n\n' +
            wrapped(CHANGE_TITLE_INSTRUCTION),
        );
        expect(prompt).not.toContain(HISTORICAL_APPEND);
        expect(prompt).not.toContain('HappyHerd User Safeguard');
    });

    it('preserves the existing first-turn title instruction', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'hello',
            includeTitleInstruction: true,
        });

        expect(prompt).toBe(`hello\n\n${wrapped(CHANGE_TITLE_INSTRUCTION)}`);
    });

    it('sends normal follow-up turns without Happy scaffolding', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'continue',
            includeTitleInstruction: false,
        });

        expect(prompt).toBe('continue');
    });
});

describe('stripHappySystemBlocks', () => {
    it('recovers the user message from a fully-scaffolded first turn (fork backfill)', () => {
        const prompt = `${wrapped(HISTORICAL_APPEND)}\n\nприветик\n\n${wrapped(CHANGE_TITLE_INSTRUCTION)}`;

        expect(stripHappySystemBlocks(prompt)).toBe('приветик');
    });

    it('recovers a multi-line user message wrapped only by the title instruction', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'line one\n\nline two',
            includeTitleInstruction: true,
        });

        expect(stripHappySystemBlocks(prompt)).toBe('line one\n\nline two');
    });

    it('leaves plain text without markers untouched', () => {
        expect(stripHappySystemBlocks('just a normal message')).toBe('just a normal message');
    });
});

describe('hashCodexEnhancedMode', () => {
    it('separates queued Codex messages with different developer instructions', () => {
        const baseMode: CodexEnhancedMode = {
            permissionMode: 'default',
            model: 'gpt-5.6-sol',
            effort: 'medium',
        };

        expect(hashCodexEnhancedMode({
            ...baseMode,
            developerInstructions: 'Human safeguard enabled',
        })).not.toBe(hashCodexEnhancedMode({
            ...baseMode,
            developerInstructions: 'Automation safeguard suppressed',
        }));
    });
});
