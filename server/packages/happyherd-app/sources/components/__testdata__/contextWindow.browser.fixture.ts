import { ContextWindowResponseSchema, type ContextWindowResponse } from '@happyherd/wire';
import rigResponse from './contextWindow.rig.response.json';

// Sanitized provider-shaped replies. The CLI fixtures separately prove the raw
// transcript/rollout cut; this fixture proves every returned byte reaches the UI.
export function contextWindowReply(provider: 'claude' | 'codex' | 'rig'): Extract<ContextWindowResponse, { type: 'success' }> {
    const native = (value: Record<string, unknown>, kind: string) => ({ kind, content: JSON.stringify(value, null, 2) });
    /* rename:preserve */
    // Exact sanitized native SQLite reader response fixture from the local patch
    // against Happy Agent 115be1c248985b823491f852dbde47ea7e6a76fd:
    // happy-agent-modules/tests/happy/fixtures/context-response.json.
    // Native readHappyContextWindow.test.ts verifies it byte-for-byte against
    // AgentPersistence; this browser test establishes rendering, not live state.
    /* /rename:preserve */
    if (provider === 'rig') {
        const response = ContextWindowResponseSchema.parse(rigResponse);
        if (response.type !== 'success') throw new Error('Native response fixture must succeed');
        return response;
    }
    return provider === 'claude' ? {
        type: 'success', provider,
        limitations: ['claude_system_prompt_unrecorded', 'claude_tool_definitions_unrecorded', 'provider_input_not_fully_recorded'],
        entries: [
            native({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }, 'system:compact_boundary'),
            native({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Retain the plain text output format.' } }, 'user'),
            native({ type: 'attachment', attachment: { type: 'environment', content: 'Working directory: /fixture/project\nPlatform: fixture-os' } }, 'attachment:environment'),
            native({ type: 'attachment', attachment: { type: 'skill_listing', content: [{ name: 'fixture-skill', description: 'Read the complete sanitized skill instructions.' }] } }, 'attachment:skill_listing'),
            native({ type: 'attachment', attachment: { type: 'session_context', content: 'Hidden session context.\nPreserve this second line.' } }, 'attachment:session_context'),
            native({ type: 'attachment', attachment: { type: 'deferred_tools', tools: [{ name: 'fixture_tool', description: 'The full deferred tool record hidden in the chat.' }] } }, 'attachment:deferred_tools'),
            native({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All recorded entries are readable through the final line.' }] } }, 'assistant'),
        ],
    } : {
        type: 'success', provider,
        limitations: ['provider_input_not_fully_recorded'],
        entries: [
            { kind: 'base_instructions', content: 'You are the fixture assistant.\nPreserve full native content, including this final instruction.' },
            native({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Injected fixture developer instructions from replacement_history.' }] }, 'message:developer'),
            native({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Keep this retained user request.' }] }, 'message:user'),
            native({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Recorded reasoning summary' }], encrypted_content: 'fixture-opaque-reasoning' }, 'reasoning'),
            native({ type: 'function_call', name: 'fixture_tool', arguments: '{"path":"/fixture/project/file.txt"}', call_id: 'fixture-call' }, 'function_call'),
            native({ type: 'function_call_output', call_id: 'fixture-call', output: 'Full first line\nFull second line\nFinal line' }, 'function_call_output'),
            native({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All recorded entries are readable through the final line.' }] }, 'message:assistant'),
        ],
    };
}
