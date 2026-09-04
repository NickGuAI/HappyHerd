import { describe, expect, it } from 'vitest';
import { buildResumeCommand, buildResumeCommandBlock } from './resumeCommand';

describe('buildResumeCommand', () => {
    it('never offers a native CLI resume command for Rig sessions', () => {
        expect(buildResumeCommand({
            path: '/tmp/project',
            flavor: 'codex',
            codexThreadId: 'thread-1',
            client: { id: 'rig' },
            capabilities: { resume: false },
        })).toBeNull();
    });
    it('builds a Claude resume command that enters the session directory first', () => {
        expect(buildResumeCommand({
            path: '/tmp/project',
            os: 'darwin',
            flavor: 'claude',
            claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
        })).toBe(`cd '/tmp/project' && happyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd`);
    });

    it('builds a Windows Codex resume command using PowerShell directory navigation', () => {
        expect(buildResumeCommand({
            path: 'C:\\Users\\test\\project',
            os: 'win32',
            flavor: 'codex',
            codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
        })).toBe(`Set-Location -LiteralPath 'C:\\Users\\test\\project'; happyherd codex --resume 019ccca5-726b-7c61-b914-16de27dfab6e`);
    });

    it('falls back to the bare resume command when no path is available', () => {
        expect(buildResumeCommand({
            flavor: 'claude',
            claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
        })).toBe('happyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd');
    });

    it('returns null when there is no resumable session identifier', () => {
        expect(buildResumeCommand({
            path: '/tmp/project',
            flavor: 'claude',
        })).toBeNull();
    });

    it('builds the generic ACP GrokBuild resume command', () => {
        expect(buildResumeCommand({
            path: '/tmp/grok project',
            flavor: 'grok',
            acpSessionId: 'grok-session-1',
            acpCapabilities: {
                loadSession: true,
            },
        })).toBe("cd '/tmp/grok project' && happyherd grok --resume grok-session-1");
    });

    it('does not advertise GrokBuild resume when ACP rejects it', () => {
        expect(buildResumeCommand({
            flavor: 'grok',
            acpSessionId: 'grok-session-1',
            acpCapabilities: {
                loadSession: false,
            },
        })).toBeNull();
    });

    it('does not advertise GrokBuild resume without ACP capability metadata', () => {
        expect(buildResumeCommand({
            flavor: 'grok',
            acpSessionId: 'grok-session-1',
        })).toBeNull();
    });

    it('builds the DSH session/resume command only from the nested capability', () => {
        expect(buildResumeCommand({
            path: '/tmp/dsh project',
            flavor: 'dsh',
            acpSessionId: 'dsh-session-1',
            acpCapabilities: {
                loadSession: false,
                resumeSession: true,
            },
        })).toBe("cd '/tmp/dsh project' && happyherd dsh --resume dsh-session-1");

        expect(buildResumeCommand({
            flavor: 'dsh',
            acpSessionId: 'dsh-session-1',
            acpCapabilities: {
                loadSession: false,
                resumeSession: false,
            },
        })).toBeNull();
    });
});

describe('buildResumeCommandBlock', () => {
    it('builds copyable two-line CLI instructions when a path is available', () => {
        expect(buildResumeCommandBlock({
            path: '/tmp/project',
            os: 'darwin',
            flavor: 'claude',
            claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
        })).toEqual({
            lines: [
                `cd '/tmp/project'`,
                'happyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd',
            ],
            copyText: `cd '/tmp/project'\nhappyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd`,
        });
    });

    it('falls back to a single-line command block when no path is available', () => {
        expect(buildResumeCommandBlock({
            flavor: 'claude',
            claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
        })).toEqual({
            lines: ['happyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd'],
            copyText: 'happyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd',
        });
    });

    it('builds copyable two-line Windows instructions using PowerShell directory navigation', () => {
        expect(buildResumeCommandBlock({
            path: 'C:\\Users\\test\\project',
            os: 'win32',
            flavor: 'claude',
            claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
        })).toEqual({
            lines: [
                `Set-Location -LiteralPath 'C:\\Users\\test\\project'`,
                'happyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd',
            ],
            copyText: `Set-Location -LiteralPath 'C:\\Users\\test\\project'\nhappyherd claude --resume 93a9705e-bc6a-406d-8dce-8acc014dedbd`,
        });
    });
});
