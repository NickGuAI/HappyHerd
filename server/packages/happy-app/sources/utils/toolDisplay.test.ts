import { describe, expect, it, vi } from 'vitest';
import { ToolCall } from '@/sync/typesMessage';
import {
    formatToolDisplayValue,
    getToolActivityLabel,
    getTerminalToolCommand,
    getToolDisplayTitle,
    getToolSummaryCategory,
    getToolSummaryDetail,
    isToolIdentityCompatibleWithFlavor,
    isTerminalToolName,
    resolveToolDisplayRuntimeState,
    shouldRenderToolCardHeader,
    shouldUseCompactToolRow,
} from './toolDisplay';

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

function tool(name: string, input: unknown): ToolCall {
    return {
        name,
        state: 'completed',
        input,
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        description: null,
    };
}

describe('terminal tool display helpers', () => {
    it('does not render stale running events as live after the provider session stops', () => {
        expect(resolveToolDisplayRuntimeState('running', true)).toBe('running');
        expect(resolveToolDisplayRuntimeState('running', undefined)).toBe('running');
        expect(resolveToolDisplayRuntimeState('running', false)).toBe('interrupted');
        expect(resolveToolDisplayRuntimeState('completed', false)).toBe('completed');
    });

    it('detects command-like terminal tools', () => {
        expect(isTerminalToolName('Bash')).toBe(true);
        expect(isTerminalToolName('CodexBash')).toBe(true);
        expect(isTerminalToolName('GeminiBash')).toBe(true);
        expect(isTerminalToolName('execute')).toBe(true);
        expect(isTerminalToolName('Read')).toBe(false);
    });

    it('extracts one-line command summaries from shell tools', () => {
        expect(getTerminalToolCommand(tool('Bash', { command: 'pnpm test' }))).toBe('pnpm test');

        expect(getTerminalToolCommand(tool(
            'CodexBash',
            {
                command: ['/usr/bin/zsh', '-lc', 'git status --short'],
                parsed_cmd: [{ type: 'bash', cmd: 'git status --short' }],
            },
        ))).toBe('git status --short');
    });

    it('extracts Gemini execute titles without cwd metadata', () => {
        expect(getTerminalToolCommand(tool(
            'execute',
            { toolCall: { title: 'rm tmp.txt [current working directory /repo] (cleanup)' } },
        ))).toBe('rm tmp.txt');
    });

    it('hides card headers for tools that already name each changed file', () => {
        for (const platform of ['web', 'ios', 'android']) {
            expect(shouldRenderToolCardHeader('CodexPatch', platform)).toBe(false);
            expect(shouldRenderToolCardHeader('GeminiPatch', platform)).toBe(false);
        }
        // Everything else still needs a header to say what it was.
        expect(shouldRenderToolCardHeader('CodexBash', 'web')).toBe(true);
        expect(shouldRenderToolCardHeader('CodexDiff', 'ios')).toBe(true);
    });

    it('classifies tools for compact transcript rows', () => {
        expect(getToolSummaryCategory('CodexBash')).toBe('terminal');
        expect(getToolSummaryCategory('exec_command')).toBe('terminal');
        expect(getToolSummaryCategory('CodexPatch')).toBe('edit');
        expect(getToolSummaryCategory('apply_patch')).toBe('edit');
        expect(getToolSummaryCategory('Read')).toBe('read');
        expect(getToolSummaryCategory('read_agent_history')).toBe('read');
        expect(getToolSummaryCategory('Grep')).toBe('search');
        expect(getToolSummaryCategory('list_workspaces')).toBe('search');
        expect(getToolSummaryCategory('WebFetch')).toBe('web');
        expect(getToolSummaryCategory('spawn_agent')).toBe('task');
    });

    it('extracts compact transcript row details', () => {
        expect(getToolSummaryDetail(tool('CodexBash', {
            command: ['/usr/bin/zsh', '-lc', 'git status --short'],
            parsed_cmd: [{ type: 'bash', cmd: 'git status --short' }],
        }))).toBe('git status --short');

        expect(getToolSummaryDetail(tool('CodexPatch', {
            changes: {
                'README-RU.md': { kind: { type: 'update' } },
            },
        }))).toBe('README-RU.md');

        expect(getToolSummaryDetail(tool('MultiEdit', {
            file_path: '/repo/src/app.tsx',
        }))).toBe('/repo/src/app.tsx');

        expect(getToolSummaryDetail(tool('exec_command', {
            cmd: 'pnpm test',
        }))).toBe('pnpm test');

        expect(getToolSummaryDetail(tool('read_file', {
            target_file: '/repo/src/app.tsx',
        }))).toBe('/repo/src/app.tsx');
    });

    it('builds one human-readable label for compact activity rows', () => {
        expect(getToolActivityLabel(tool('CodexBash', {
            command: ['/usr/bin/zsh', '-lc', 'git status --short'],
            parsed_cmd: [{ type: 'bash', cmd: 'git status --short' }],
        }))).toBe('toolGroup.ran: git status --short');

        expect(getToolActivityLabel(tool('Read', {
            file_path: '/repo/src/app.tsx',
        }))).toBe('toolGroup.read: /repo/src/app.tsx');

        const describedTool = tool('CodexPatch', {
            changes: { 'README.md': { kind: { type: 'update' } } },
        });
        describedTool.description = 'Updated the README';
        expect(getToolActivityLabel(describedTool)).toBe('Updated the README');

        expect(getToolActivityLabel(tool('mcp__linear__create_issue', {})))
            .toBe('MCP: Linear Create Issue');

        const rigCommand = tool('exec_command', { cmd: 'git status --short' });
        rigCommand.description = 'Running Exec Command';
        expect(getToolActivityLabel(rigCommand))
            .toBe('toolGroup.ran: git status --short');

        const rigCoordination = tool('spawn_agent', {});
        rigCoordination.description = 'Running Spawn Agent';
        expect(getToolActivityLabel(rigCoordination)).toBe('Spawn Agent');

        const futureTool = tool('brand_new_rig_tool', {});
        futureTool.description = 'Running Brand New Rig Tool';
        expect(getToolActivityLabel(futureTool)).toBe('Brand New Rig Tool');

        const providerTitledTool = tool('execute', { command: 'pnpm test' });
        providerTitledTool.title = 'Run the focused ACP callback tests';
        providerTitledTool.description = 'Running execute';
        expect(getToolActivityLabel(providerTitledTool)).toBe('Run the focused ACP callback tests');
    });

    it('uses an authoritative provider title without a known-tools entry', () => {
        const providerTitledTool = tool('other', {});
        providerTitledTool.title = 'Inspect the Grok configuration';

        expect(getToolDisplayTitle(providerTitledTool)).toBe('Inspect the Grok configuration');
        expect(getToolDisplayTitle(tool('future_provider_tool', {}))).toBe('future_provider_tool');
    });

    it('keeps ACP categories on generic views outside their owning provider', () => {
        expect(isToolIdentityCompatibleWithFlavor('think', 'grok')).toBe(false);
        expect(isToolIdentityCompatibleWithFlavor('read', 'grok')).toBe(false);
        expect(isToolIdentityCompatibleWithFlavor('search', 'opencode')).toBe(false);
        expect(isToolIdentityCompatibleWithFlavor('execute', 'grok')).toBe(false);
        expect(isToolIdentityCompatibleWithFlavor('edit', 'opencode')).toBe(false);
        expect(isToolIdentityCompatibleWithFlavor('execute', 'gemini')).toBe(true);
        expect(isToolIdentityCompatibleWithFlavor('future_provider_tool', 'grok')).toBe(true);
    });

    it('formats structured and falsy provider outcomes without losing their value', () => {
        expect(formatToolDisplayValue({ exitCode: 2, stderr: 'failed' })).toBe(`{\n  "exitCode": 2,\n  "stderr": "failed"\n}`);
        expect(formatToolDisplayValue(false)).toBe('false');
        expect(formatToolDisplayValue(null)).toBe('null');
    });

    it('uses compact rows for current and future non-interactive tools', () => {
        expect(shouldUseCompactToolRow(tool('exec_command', {}), true)).toBe(true);
        expect(shouldUseCompactToolRow(tool('brand_new_rig_tool', {}), true)).toBe(true);
        expect(shouldUseCompactToolRow(tool('brand_new_rig_tool', {}), false)).toBe(false);
        expect(shouldUseCompactToolRow(tool('file', {}), true)).toBe(false);
        expect(shouldUseCompactToolRow(tool('AskUserQuestion', {}), true)).toBe(false);
        expect(shouldUseCompactToolRow(tool('Subagent', {}), true)).toBe(false);
        expect(shouldUseCompactToolRow(tool('request_user_input', {}), true)).toBe(false);

        const pendingPlan = tool('ExitPlanMode', {});
        pendingPlan.permission = {
            id: 'permission-1',
            status: 'pending',
        };
        expect(shouldUseCompactToolRow(pendingPlan, true)).toBe(false);
        pendingPlan.permission.status = 'approved';
        expect(shouldUseCompactToolRow(pendingPlan, true)).toBe(true);
    });
});
