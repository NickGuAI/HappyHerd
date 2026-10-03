/**
 * What Gemini media work is made of.
 *
 * Generated media and the bytes of a local file are never crossed with a persisted or protocol
 * boundary, so they stay ordinary in-memory values rather than TypeBox-validated payloads. The
 * schemas that are validated at runtime — module options, tool arguments, tool results — live
 * beside the module and the tools that own them.
 */

/** One piece of media Gemini generated, and whatever it wrote alongside it. */
export interface GeminiGeneratedMedia {
    bytes: Uint8Array;
    mimeType: string;
    text?: string;
}

/** How Gemini is told to read an uploaded file. */
export type GeminiMediaInputType = "audio" | "document" | "image" | "video";

/** One local file as Gemini receives it. */
export interface GeminiMediaInput {
    mimeType: string;
    type: GeminiMediaInputType;
}

/**
 * How the module reaches Gemini: the key it authenticates with, and optionally the `fetch` the
 * request goes out on. A host that needs its own transport — or a test that answers without a
 * network — supplies the second.
 */
export interface GeminiConnection {
    readonly apiKey: string;
    readonly fetch?: typeof fetch;
}
