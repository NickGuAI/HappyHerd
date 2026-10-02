import { describe, expect, it } from "vitest";

import { isGrokAuthError } from "@/vendors/grok/errors/grokErrors.js";

describe("Grok authentication errors", () => {
    it("recognizes the upstream expired credential rejection", () => {
        expect(
            isGrokAuthError({
                message:
                    'Error 401 "Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=xai-grok-cli, upstream=PermissionDenied, reason=no auth context)"',
                status: 401,
            }),
        ).toBe(true);
    });

    it("recognizes a credential rejection whose status was lost in transport", () => {
        expect(
            isGrokAuthError({ message: "Invalid or expired credentials (no auth context)" }),
        ).toBe(true);
        expect(isGrokAuthError({ message: "upstream=PermissionDenied" })).toBe(true);
    });

    it("leaves unrelated failures alone so they keep their own handling", () => {
        expect(isGrokAuthError({ message: "rate limit exceeded", status: 429 })).toBe(false);
        expect(isGrokAuthError({ message: "internal server error", status: 500 })).toBe(false);
        expect(isGrokAuthError({ message: "prompt is too long" })).toBe(false);
    });
});
