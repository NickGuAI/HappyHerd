import { Type, type Static } from "@sinclair/typebox";

import { eventIdSchema } from "../events/index.js";

/**
 * One interactive terminal, as everyone outside this module sees it.
 *
 * A terminal belongs to a project, or to one managed workspace of that project, and not to any
 * chat: everybody looking at the same folder sees the same terminals. The record below is what a
 * lifecycle call answers with. It never contains screen contents — the picture and everything that
 * happens on it travel over the attachment, not over these calls.
 */
export const MAX_TERMINAL_COLS = 500;
export const MAX_TERMINAL_ROWS = 200;
export const MAX_TERMINAL_SCROLLBACK = 100_000;
/** How many terminals one project or workspace may hold at once. */
export const MAX_TERMINALS_PER_SCOPE = 32;
export const MAX_TERMINAL_COMMAND_LENGTH = 8_192;
export const MAX_TERMINAL_PATH_LENGTH = 4_096;
export const MAX_TERMINAL_SHELL_LENGTH = 1_024;
export const MAX_TERMINAL_ID_LENGTH = 128;

export const DEFAULT_TERMINAL_COLS = 80;
export const DEFAULT_TERMINAL_ROWS = 24;
export const DEFAULT_TERMINAL_SCROLLBACK = 10_000;
export const DEFAULT_TERMINAL_COLOR_SCHEME = "dark";

const exact = { additionalProperties: false } as const;

/**
 * Which palette the canonical emulator starts on.
 *
 * It is settled when the terminal is created and never changes, because it seeds the emulator that
 * every attachment is a replica of. A person who switches theme opens a new terminal.
 */
export const terminalColorSchemeSchema = Type.Union([Type.Literal("dark"), Type.Literal("light")]);
export type TerminalColorScheme = Static<typeof terminalColorSchemeSchema>;

export const terminalStatusSchema = Type.Union([Type.Literal("exited"), Type.Literal("running")]);
export type TerminalStatus = Static<typeof terminalStatusSchema>;

/** The folder a terminal collection belongs to: a project, or one of its managed workspaces. */
export const terminalScopeSchema = Type.Object(
    {
        projectId: Type.String({ minLength: 1, maxLength: MAX_TERMINAL_ID_LENGTH }),
        workspaceId: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_TERMINAL_ID_LENGTH }),
        ),
    },
    exact,
);
export type TerminalScope = Static<typeof terminalScopeSchema>;

export const createTerminalInputSchema = Type.Object(
    {
        cols: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_COLS })),
        colorScheme: Type.Optional(terminalColorSchemeSchema),
        /** What to run instead of an interactive shell. The shell still hosts it. */
        command: Type.Optional(Type.String({ maxLength: MAX_TERMINAL_COMMAND_LENGTH })),
        /** Where to start, absolute or relative to the scope's folder. Defaults to that folder. */
        cwd: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TERMINAL_PATH_LENGTH })),
        maxScrollback: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_TERMINAL_SCROLLBACK }),
        ),
        rows: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_ROWS })),
        shell: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TERMINAL_SHELL_LENGTH })),
    },
    exact,
);
export type CreateTerminalInput = Static<typeof createTerminalInputSchema>;

export const resizeTerminalInputSchema = Type.Object(
    {
        cols: Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_COLS }),
        rows: Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_ROWS }),
    },
    exact,
);
export type ResizeTerminalInput = Static<typeof resizeTerminalInputSchema>;

export const terminalSchema = Type.Object(
    {
        cols: Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_COLS }),
        colorScheme: terminalColorSchemeSchema,
        /**
         * Changes whenever a new process backs this terminal, so an offset taken against an older
         * process can never be replayed into this one.
         */
        epoch: Type.String({ minLength: 1, maxLength: MAX_TERMINAL_ID_LENGTH }),
        exitCode: Type.Union([Type.Null(), Type.Integer()]),
        id: Type.String({ minLength: 1, maxLength: MAX_TERMINAL_ID_LENGTH }),
        rows: Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_ROWS }),
        status: terminalStatusSchema,
        /** The root workspace is named by its project ID. */
        workspaceId: Type.String({ minLength: 1, maxLength: MAX_TERMINAL_ID_LENGTH }),
        /** UUIDv7 minted whenever this terminal's observable resource state changes. */
        version: eventIdSchema,
    },
    exact,
);
export type Terminal = Static<typeof terminalSchema>;

/** Fields that can appear in one terminal state-change event. */
export const terminalChangesSchema = Type.Partial(
    Type.Omit(terminalSchema, ["id", "version"]),
    exact,
);
export type TerminalChanges = Static<typeof terminalChangesSchema>;

export const terminalEventSchema = Type.Union([
    Type.Object(
        {
            terminal: terminalSchema,
            type: Type.Literal("terminal_created"),
        },
        exact,
    ),
    Type.Object(
        {
            changes: terminalChangesSchema,
            previousVersion: eventIdSchema,
            terminalId: Type.String({ minLength: 1, maxLength: MAX_TERMINAL_ID_LENGTH }),
            type: Type.Literal("terminal_updated"),
            version: eventIdSchema,
        },
        exact,
    ),
]);
export type TerminalEvent = Static<typeof terminalEventSchema>;

const terminalListenerResultSchema = Type.Union([Type.Void(), Type.Promise(Type.Void())]);

/**
 * Receives terminal lifecycle events after the in-memory state has changed.
 *
 * Terminal state is intentionally non-durable, so there is no transactional callback. Subscribe
 * during module construction, before terminals can open, to observe every terminal in this daemon
 * lifetime.
 */
export const terminalEventListenerSchema = Type.Function(
    [terminalEventSchema],
    terminalListenerResultSchema,
);
export type TerminalEventListener = Static<typeof terminalEventListenerSchema>;
export type TerminalUnsubscribe = () => void;

/** Why a terminal request could not be served, in terms a caller can turn into a status code. */
export type TerminalErrorCode = "conflict" | "invalid" | "not_found" | "unavailable";

export class TerminalError extends Error {
    readonly code: TerminalErrorCode;

    constructor(code: TerminalErrorCode, message: string) {
        super(message);
        this.name = "TerminalError";
        this.code = code;
    }
}
