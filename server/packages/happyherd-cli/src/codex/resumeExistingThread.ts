import { trimIdent } from '@/utils/trimIdent';
import type { ApprovalPolicy, SandboxMode } from './codexAppServerTypes';
import { instructionReceiptMetadata, type CommanderContextMetadata } from '@/agentContext/commanderContext';

type ResumeThreadClient = {
    resumeThread: (opts: {
        replayPlans?: boolean;
        threadId: string;
        model?: string;
        cwd: string;
        mcpServers: Record<string, unknown>;
        developerInstructions?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
    }) => Promise<{ threadId: string; model: string }>;
    injectDeveloperInstructions: (opts: { threadId: string; instructions: string }) => Promise<unknown>;
};

type ResumeThreadSession = {
    updateMetadata: (handler: (currentMetadata: any) => any) => Promise<void>;
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
    /** Freshly assembled context; publish only after native delivery succeeds. */
    contextMetadata?: CommanderContextMetadata;
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
            ...(opts.announce === false ? { replayPlans: false } : {}),
            threadId: opts.threadId,
            ...(opts.model ? { model: opts.model } : {}),
            cwd: opts.cwd,
            mcpServers: opts.mcpServers,
            ...(opts.developerInstructions ? { developerInstructions: opts.developerInstructions } : {}),
            ...(opts.approvalPolicy ? { approvalPolicy: opts.approvalPolicy } : {}),
            ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
        });

        // A resumed Codex history may ignore the thread configuration override.
        // Existing developer-item injection makes this launch's context visible
        // to the next turn and provides the acknowledgement for its receipt.
        if (opts.developerInstructions) {
            await opts.client.injectDeveloperInstructions({
                threadId: resumedThread.threadId,
                instructions: opts.developerInstructions,
            });
        }

        await opts.session.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            codexThreadId: resumedThread.threadId,
            ...(opts.contextMetadata && opts.developerInstructions
                && opts.contextMetadata.commanderId === currentMetadata.commanderId ? {
                    contextHash: opts.contextMetadata.contextHash,
                    commanderContextFiles: opts.contextMetadata.commanderContextFiles,
                    ...instructionReceiptMetadata({
                        provider: 'codex', layer: 'developer', deliveredInstruction: opts.developerInstructions,
                    }),
                } : {}),
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
