/** Questions: a run that cannot proceed without the person. */

import type { Cuid2, ResourceVersion, Timestamp } from "./common.js";

/** One option the person picks from. */
export interface QuestionOption {
    label: string;
    description: string;
}

/** One prompt inside a question. */
export interface QuestionPrompt {
    id: Cuid2;
    /** A short label for the prompt. */
    header: string;
    question: string;
    multiSelect: boolean;
    /** Possibly empty, and then the answer is free text. */
    options: QuestionOption[];
}

/** The question object. An agent has at most one open at a time. */
export interface Question {
    id: Cuid2;
    agentId: Cuid2;
    /** Whose run is waiting. */
    runId: Cuid2;
    /** `"canceled"` means the run stopped needing the answer. */
    status: "pending" | "answered" | "canceled";
    /** One or more prompts, answered together. */
    questions: QuestionPrompt[];
    /** When the agent proceeds on its own; `null` waits indefinitely. */
    autoResolveAt: Timestamp | null;
    /** `null` while pending; a map from prompt ID to the chosen values. */
    answers: Record<string, string[]> | null;
    version: ResourceVersion;
    createdAt: Timestamp;
    answeredAt: Timestamp | null;
}

/** `GET /v0/agents/:agentId/question` — `null` when nothing is pending. */
export interface PendingQuestionResponse {
    question: Question | null;
}

/** `POST /v0/agents/:agentId/question/:questionId/answer` */
export interface QuestionResponse {
    question: Question;
}

/** `POST /v0/agents/:agentId/question/:questionId/answer` */
export interface AnswerQuestionRequest {
    /**
     * Each prompt ID mapped to the person's values. A value matching an option
     * label is a selection; any other string is free text. Every prompt must
     * receive at least one value.
     */
    answers: Record<string, string[]>;
    mutationId?: string;
}
