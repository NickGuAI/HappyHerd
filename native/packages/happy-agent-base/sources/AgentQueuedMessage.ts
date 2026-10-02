import type {
    SessionAgentMessage,
    SessionSystemMessage,
    SessionUserMessage,
} from "@slopus/happy-providers";

/**
 * A message a caller may hand to one of the agent's delivery queues.
 *
 * Steering and sending say when a message enters the conversation, not who wrote it. A user
 * message is the ordinary case. A system message is how the runtime tells the model something it
 * never asked for, such as a background process that died. An agent message is the opaque
 * provider-native payload one collaborating agent addresses to another. Each keeps its own role
 * all the way into the context, so the provider serializes it as what it actually is rather than
 * as something the user said.
 */
export type AgentQueuedMessage = SessionUserMessage | SessionSystemMessage | SessionAgentMessage;
