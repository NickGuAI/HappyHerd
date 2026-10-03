import type { CodexCredential } from "@/vendors/VendorCredential.js";
import { CODEX_API_ENDPOINT, CODEX_CHATGPT_ENDPOINT } from "@/vendors/codex/impl/codexConstants.js";
import { recoverCodexUnauthorizedCredential } from "@/vendors/codex/impl/recoverCodexUnauthorizedCredential.js";

const IMAGE_MODEL = "gpt-image-2";
const MAXIMUM_RESPONSE_BYTES = 96 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const REQUEST_MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 200;

export interface GenerateCodexImageRequest {
    images?: readonly string[];
    prompt: string;
    signal?: AbortSignal;
    turnId: string;
}

export interface GenerateCodexImageResult {
    base64: string;
    mediaType: "image/png";
}

export class CodexImageGenerationError extends Error {
    readonly fallbackEligible: boolean;
    readonly status: number;

    constructor(
        message: string,
        options: { fallbackEligible: boolean; status: number; cause?: unknown },
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "CodexImageGenerationError";
        this.fallbackEligible = options.fallbackEligible;
        this.status = options.status;
    }
}

export async function generateCodexImage(options: {
    credential: CodexCredential;
    endpoint?: string;
    fetch?: typeof fetch;
    request: GenerateCodexImageRequest;
    userAgent?: string;
}): Promise<GenerateCodexImageResult> {
    let credential = options.credential;
    const sessionCredential = credential.name === "codex-session" ? credential : undefined;
    const endpoint =
        options.endpoint ??
        (sessionCredential === undefined ? CODEX_API_ENDPOINT : CODEX_CHATGPT_ENDPOINT);
    const images = options.request.images ?? [];
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal =
        options.request.signal === undefined
            ? timeoutSignal
            : AbortSignal.any([options.request.signal, timeoutSignal]);
    let response: Response;
    for (let recoveryStep = 0; ; recoveryStep += 1) {
        response = await requestImageWithRetry({
            credential,
            endpoint,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            images,
            prompt: options.request.prompt,
            signal,
            turnId: options.request.turnId,
            ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
        });
        if (response.status !== 401) break;
        let recovered: CodexCredential | undefined;
        try {
            recovered = await recoverCodexUnauthorizedCredential(credential, recoveryStep);
        } catch (error) {
            await response.body?.cancel().catch(() => undefined);
            throw new CodexImageGenerationError(
                `Codex image generation authentication could not be recovered: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { cause: error, fallbackEligible: true, status: response.status },
            );
        }
        if (recovered === undefined) break;
        await response.body?.cancel().catch(() => undefined);
        credential = recovered;
    }
    let raw: string;
    try {
        raw = await readBoundedResponse(response);
    } catch (error) {
        if (!response.ok) throw codexImageHttpError(response, undefined, error);
        throw error;
    }
    let payload: unknown;
    try {
        payload = JSON.parse(raw);
    } catch {
        if (!response.ok) {
            throw codexImageHttpError(response, undefined);
        }
        throw new Error(
            `Codex image generation returned invalid JSON (${String(response.status)}).`,
        );
    }
    if (!response.ok) {
        throw codexImageHttpError(response, payload);
    }
    const base64 = (payload as { data?: readonly { b64_json?: unknown }[] }).data?.[0]?.b64_json;
    if (typeof base64 !== "string" || base64.length === 0) {
        throw new Error("Codex image generation returned no image data.");
    }
    return { base64, mediaType: "image/png" };
}

async function requestImageWithRetry(
    options: Parameters<typeof requestImage>[0],
): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
        let response: Response;
        try {
            response = await requestImage(options);
        } catch (error) {
            options.signal.throwIfAborted();
            if (!(error instanceof TypeError) || attempt >= REQUEST_MAX_RETRIES) throw error;
            await waitForRetry(attempt, options.signal);
            continue;
        }
        if (response.status < 500 || response.status > 599 || attempt >= REQUEST_MAX_RETRIES) {
            return response;
        }
        await response.body?.cancel().catch(() => undefined);
        await waitForRetry(attempt, options.signal);
    }
}

async function waitForRetry(attempt: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const exponentialDelay = RETRY_BASE_DELAY_MS * 2 ** attempt;
    const jitteredDelay = exponentialDelay * (0.9 + Math.random() * 0.2);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(finish, jitteredDelay);
        signal.addEventListener("abort", abort, { once: true });

        function finish() {
            signal.removeEventListener("abort", abort);
            resolve();
        }
        function abort() {
            clearTimeout(timer);
            reject(signal.reason);
        }
    });
}

async function requestImage(options: {
    credential: CodexCredential;
    endpoint: string;
    fetch?: typeof fetch;
    images: readonly string[];
    prompt: string;
    signal: AbortSignal;
    turnId: string;
    userAgent?: string;
}): Promise<Response> {
    const sessionCredential =
        options.credential.name === "codex-session" ? options.credential : undefined;
    const apiCredential =
        options.credential.name === "codex-api-key" ? options.credential : undefined;
    const token =
        sessionCredential === undefined
            ? apiCredential!.credential.apiKey
            : sessionCredential.credential.accessToken;
    return (options.fetch ?? fetch)(
        `${options.endpoint.replace(/\/$/u, "")}${sessionCredential === undefined ? "" : "/codex"}/images/${options.images.length === 0 ? "generations" : "edits"}`,
        {
            body: JSON.stringify({
                ...(options.images.length === 0
                    ? {}
                    : { images: options.images.map((image_url) => ({ image_url })) }),
                background: "auto",
                model: IMAGE_MODEL,
                prompt: options.prompt,
                quality: "auto",
                size: "auto",
            }),
            headers: {
                authorization: `Bearer ${token}`,
                ...(sessionCredential?.credential.accountId === undefined
                    ? {}
                    : { "chatgpt-account-id": sessionCredential.credential.accountId }),
                "content-type": "application/json",
                originator: "codex_exec",
                ...(options.userAgent === undefined ? {} : { "user-agent": options.userAgent }),
                "x-codex-image-turn-id": options.turnId,
            },
            method: "POST",
            signal: options.signal,
        },
    );
}

function codexImageHttpError(
    response: Response,
    payload: unknown,
    cause?: unknown,
): CodexImageGenerationError {
    const message = (payload as { error?: { message?: unknown }; message?: unknown } | undefined)
        ?.error?.message;
    const fallback = (payload as { message?: unknown } | undefined)?.message;
    return new CodexImageGenerationError(
        `Codex image generation failed (${String(response.status)}): ${
            typeof message === "string"
                ? message
                : typeof fallback === "string"
                  ? fallback
                  : response.statusText || "Unknown error"
        }`,
        {
            ...(cause === undefined ? {} : { cause }),
            fallbackEligible: [401, 402, 403, 404, 429].includes(response.status),
            status: response.status,
        },
    );
}

async function readBoundedResponse(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_RESPONSE_BYTES) {
        throw new Error("Codex image generation response exceeded the 96 MiB limit.");
    }
    if (response.body === null) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > MAXIMUM_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error("Codex image generation response exceeded the 96 MiB limit.");
            }
            chunks.push(next.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
