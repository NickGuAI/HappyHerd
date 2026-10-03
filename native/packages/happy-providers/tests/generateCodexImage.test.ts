import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
    CodexApiKeyCredential,
    CodexImageGenerationError,
    CodexSessionCredential,
    generateCodexImage,
} from "@/index.js";

describe("generateCodexImage", () => {
    it("uses the standalone Codex Images API and returns the first PNG", async () => {
        const credential = await CodexApiKeyCredential.tryLoad({ apiKey: "test-key" });
        const request = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { status: 200 }),
            );

        const result = await generateCodexImage({
            credential: credential!,
            endpoint: "https://example.test/v1/",
            fetch: request,
            request: { prompt: "A small orange fox", turnId: "turn-1" },
            userAgent: "rig-image-test/1.0",
        });

        expect(result).toEqual({ base64: "AQID", mediaType: "image/png" });
        expect(request.mock.calls[0]?.[0]).toBe("https://example.test/v1/images/generations");
        const init = request.mock.calls[0]?.[1] as RequestInit;
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-key");
        expect(new Headers(init.headers).get("user-agent")).toBe("rig-image-test/1.0");
        expect(new Headers(init.headers).get("x-codex-image-turn-id")).toBe("turn-1");
        expect(JSON.parse(String(init.body))).toEqual({
            background: "auto",
            model: "gpt-image-2",
            prompt: "A small orange fox",
            quality: "auto",
            size: "auto",
        });
    });

    it("sends edit references to the edits endpoint", async () => {
        const credential = await CodexApiKeyCredential.tryLoad({ apiKey: "test-key" });
        const request = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: [{ b64_json: "BAUG" }] }), { status: 200 }),
            );

        await generateCodexImage({
            credential: credential!,
            endpoint: "https://example.test/v1",
            fetch: request,
            request: {
                images: ["data:image/png;base64,AQID"],
                prompt: "Add a red hat",
                turnId: "turn-edit",
            },
        });

        expect(request.mock.calls[0]?.[0]).toBe("https://example.test/v1/images/edits");
        const init = request.mock.calls[0]?.[1] as RequestInit | undefined;
        expect(JSON.parse(String(init?.body))).toMatchObject({
            images: [{ image_url: "data:image/png;base64,AQID" }],
            prompt: "Add a red hat",
        });
    });

    it("reloads a changed Codex session credential after an unauthorized image request", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-image-auth-reload-"));
        const authFile = join(directory, "auth.json");
        await writeFile(
            authFile,
            JSON.stringify({
                tokens: { access_token: "stale", account_id: "account-1" },
            }),
        );
        try {
            const credential = await CodexSessionCredential.tryLoad({ authFile });
            if (credential === null) expect.fail("Credential did not load.");
            await writeFile(
                authFile,
                JSON.stringify({
                    tokens: { access_token: "fresh", account_id: "account-1" },
                }),
            );
            const authorizations: string[] = [];
            const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
                authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
                return authorizations.length === 1
                    ? new Response(JSON.stringify({ error: { message: "expired" } }), {
                          status: 401,
                      })
                    : new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                          status: 200,
                      });
            });

            await generateCodexImage({
                credential,
                endpoint: "https://example.test/backend-api",
                fetch: request,
                request: { prompt: "A fox", turnId: "turn-auth" },
            });

            expect(authorizations).toEqual(["Bearer stale", "Bearer fresh"]);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    it("refreshes a Codex session credential after reload remains unauthorized", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-image-auth-refresh-"));
        const authFile = join(directory, "auth.json");
        await writeFile(
            authFile,
            JSON.stringify({
                tokens: {
                    access_token: "stale",
                    account_id: "account-1",
                    refresh_token: "refresh-token",
                },
            }),
        );
        const refresh = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    access_token: "fresh",
                    refresh_token: "fresh-refresh",
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", refresh);
        try {
            const credential = await CodexSessionCredential.tryLoad({
                authFile,
                env: {
                    CODEX_APP_SERVER_LOGIN_CLIENT_ID: "test-client",
                    CODEX_REFRESH_TOKEN_URL_OVERRIDE: "https://refresh.example/token",
                },
            });
            if (credential === null) expect.fail("Credential did not load.");
            const authorizations: string[] = [];
            const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
                authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
                return authorizations.length < 3
                    ? new Response(JSON.stringify({ error: { message: "expired" } }), {
                          status: 401,
                      })
                    : new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                          status: 200,
                      });
            });

            await generateCodexImage({
                credential,
                endpoint: "https://example.test/backend-api",
                fetch: request,
                request: { prompt: "A fox", turnId: "turn-refresh" },
            });

            expect(authorizations).toEqual(["Bearer stale", "Bearer stale", "Bearer fresh"]);
            expect(refresh).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
            await rm(directory, { force: true, recursive: true });
        }
    });

    it("marks only definitive account refusals as eligible for provider fallback", async () => {
        const credential = await CodexApiKeyCredential.tryLoad({ apiKey: "test-key" });
        const refused = await generateCodexImage({
            credential: credential!,
            endpoint: "https://example.test/v1",
            fetch: async () =>
                new Response(JSON.stringify({ error: { message: "failed" } }), { status: 429 }),
            request: { prompt: "A fox", turnId: "turn-429" },
        }).catch((caught: unknown) => caught);
        expect(refused).toBeInstanceOf(CodexImageGenerationError);
        expect((refused as CodexImageGenerationError).fallbackEligible).toBe(true);

        vi.useFakeTimers();
        try {
            const failed = generateCodexImage({
                credential: credential!,
                endpoint: "https://example.test/v1",
                fetch: async () =>
                    new Response(JSON.stringify({ error: { message: "failed" } }), { status: 500 }),
                request: { prompt: "A fox", turnId: "turn-500" },
            }).catch((caught: unknown) => caught);
            await vi.runAllTimersAsync();
            const error = await failed;
            expect(error).toBeInstanceOf(CodexImageGenerationError);
            expect((error as CodexImageGenerationError).fallbackEligible).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("retries transport failures on the same provider with one stable turn ID", async () => {
        vi.useFakeTimers();
        try {
            const credential = await CodexApiKeyCredential.tryLoad({ apiKey: "test-key" });
            const turnIds: string[] = [];
            const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
                turnIds.push(new Headers(init?.headers).get("x-codex-image-turn-id") ?? "");
                if (turnIds.length === 1) throw new TypeError("connection reset");
                return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                    status: 200,
                });
            });
            const generated = generateCodexImage({
                credential: credential!,
                endpoint: "https://example.test/v1",
                fetch: request,
                request: { prompt: "A fox", turnId: "stable-turn" },
            });

            await vi.runAllTimersAsync();
            await expect(generated).resolves.toEqual({
                base64: "AQID",
                mediaType: "image/png",
            });
            expect(turnIds).toEqual(["stable-turn", "stable-turn"]);
        } finally {
            vi.useRealTimers();
        }
    });
});
