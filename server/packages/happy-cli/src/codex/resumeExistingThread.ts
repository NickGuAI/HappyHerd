import { trimIdent } from '@/utils/trimIdent';
import type { ApprovalPolicy, SandboxMode } from './codexAppServerTypes';

type ResumeThreadClient = {
    resumeThread: (opts: {
        threadId: string;
        model?: string;
        cwd: string;
        mcpServers: Record<string, unknown>;
        developerInstructions?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
    }) => Promise<{ threadId: string; model: string }>;
};

type ResumeThreadSession = {
    updateMetadata: (handler: (currentMetadata: any) => any) => void;
    sendSessionEvent: (event: { type: 'message'; message: string }) => void;
};

type ResumeThreadMessageBuffer = {
    addMessage: (message: string, type: 'status') => void;
};

export async function resumeExistingThread(opts: {
    client: ResumeThreadClient;
    session: ResumeThreadSession;
    messageBuffer: ResumeThreadMessageBuffer;
    threadId: string;
    model?: string;
    cwd: string;
    mcpServers: Record<string, unknown>;
    developerInstructions?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    /**
     * Whether to surface a "Resumed Codex thread …" message in the chat UI.
     * Side chats open empty on purpose, so they pass `false` to keep this
     * internal resume detail out of the conversation. Defaults to `true`.
     */
    announce?: boolean;
}): Promise<{ threadId: string; model: string }> {
    try {
        const resumedThread = await opts.client.resumeThread({
            threadId: opts.threadId,
            ...(opts.model ? { model: opts.model } : {}),
            cwd: opts.cwd,
            mcpServers: opts.mcpServers,
            ...(opts.developerInstructions ? { developerInstructions: opts.developerInstructions } : {}),
            ...(opts.approvalPolicy ? { approvalPolicy: opts.approvalPolicy } : {}),
            ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
        });

        opts.session.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            codexThreadId: resumedThread.threadId,
        }));
        opts.messageBuffer.addMessage(`Resumed thread ${trimIdent(resumedThread.threadId)}`, 'status');
        if (opts.announce !== false) {
            opts.session.sendSessionEvent({
                type: 'message',
                message: `Resumed Codex thread ${resumedThread.threadId}`,
            });
        }

        return resumedThread;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to resume Codex thread ${opts.threadId}: ${reason}`);
    }
}
