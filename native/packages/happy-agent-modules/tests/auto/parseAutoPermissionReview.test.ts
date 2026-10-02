import { describe, expect, it } from "vitest";

import { parseAutoPermissionReview } from "../../sources/auto/impl/parseAutoPermissionReview.js";

describe("parseAutoPermissionReview", () => {
    it("reads the structured verdict the guardian is told to produce", () => {
        const review = parseAutoPermissionReview(
            [
                "<review>",
                "<risk_level>low</risk_level>",
                "<user_authorization>high</user_authorization>",
                "<outcome>allow</outcome>",
                "<rationale>Routine local edit.</rationale>",
                "</review>",
            ].join("\n"),
        );

        expect(review).toEqual({
            decision: "allow",
            reason: "Routine local edit.",
            risk: "low",
            userAuthorization: "high",
        });
    });

    it("keeps a rationale that quotes the user, which broke the old JSON contract", () => {
        const review = parseAutoPermissionReview(
            [
                "<review>",
                "<risk_level>high</risk_level>",
                "<user_authorization>high</user_authorization>",
                "<outcome>allow</outcome>",
                '<rationale>The user issued the "sync to main" command, whose documented workflow is exactly this non-force push {no escaping needed}.</rationale>',
                "</review>",
            ].join("\n"),
        );

        expect(review).toEqual({
            decision: "allow",
            reason: 'The user issued the "sync to main" command, whose documented workflow is exactly this non-force push {no escaping needed}.',
            risk: "high",
            userAuthorization: "high",
        });
    });

    it("accepts the short low-risk answer", () => {
        expect(parseAutoPermissionReview("<review>\n<outcome>allow</outcome>\n</review>")).toEqual({
            decision: "allow",
            risk: "low",
            userAuthorization: "unknown",
            reason: "Auto-review returned a low-risk allow decision.",
        });
    });

    it("defaults an omitted deny rationale and risk to the deny values", () => {
        expect(parseAutoPermissionReview("<review><outcome>deny</outcome></review>")).toEqual({
            decision: "deny",
            denialKind: "rejected",
            risk: "high",
            userAuthorization: "unknown",
            reason: "Auto-review returned a deny decision without a rationale.",
        });
    });

    it("reads a verdict the reviewer wrote after thinking in prose", () => {
        expect(
            parseAutoPermissionReview(
                "The target is a single file in the workspace.\n\n<review>\n<outcome>allow</outcome>\n</review>",
            ),
        ).toEqual({
            decision: "allow",
            risk: "low",
            userAuthorization: "unknown",
            reason: "Auto-review returned a low-risk allow decision.",
        });
    });

    it("takes the last review block when the reviewer restated the contract first", () => {
        expect(
            parseAutoPermissionReview(
                [
                    "The contract asks for <review><outcome>allow | deny</outcome></review>.",
                    "<review>",
                    "<outcome>deny</outcome>",
                    "<rationale>Deletes a path outside the workspace.</rationale>",
                    "</review>",
                ].join("\n"),
            ),
        ).toEqual({
            decision: "deny",
            denialKind: "rejected",
            risk: "high",
            userAuthorization: "unknown",
            reason: "Deletes a path outside the workspace.",
        });
    });

    it("reads tagged fields the reviewer did not wrap in a review block", () => {
        expect(
            parseAutoPermissionReview(
                "<outcome>allow</outcome>\n<rationale>Read-only listing.</rationale>",
            ),
        ).toEqual({
            decision: "allow",
            risk: "low",
            userAuthorization: "unknown",
            reason: "Read-only listing.",
        });
    });

    it("tolerates casing and padding in the closed-list fields", () => {
        expect(
            parseAutoPermissionReview(
                "<review><outcome> Allow </outcome><risk_level>MEDIUM</risk_level></review>",
            ),
        ).toEqual({
            decision: "allow",
            risk: "medium",
            userAuthorization: "unknown",
            reason: "Auto-review returned a low-risk allow decision.",
        });
    });

    it("collapses whitespace and caps an overlong rationale at 240 characters", () => {
        const review = parseAutoPermissionReview(
            `<review><outcome>deny</outcome><rationale>${"word ".repeat(80)}tail</rationale></review>`,
        );

        // v1 keeps 237 characters plus the single-character ellipsis, so the cap is 238 total.
        expect(review?.reason).toHaveLength(238);
        expect(review?.reason.endsWith("…")).toBe(true);
        expect(review?.reason).not.toContain("  ");
    });

    it("rejects unknown outcomes and unknown supplied classifications", () => {
        expect(
            parseAutoPermissionReview(
                "<review><outcome>escalate</outcome><risk_level>high</risk_level></review>",
            ),
        ).toBeUndefined();
        expect(
            parseAutoPermissionReview(
                "<review><outcome>allow</outcome><risk_level>extreme</risk_level></review>",
            ),
        ).toBeUndefined();
        expect(
            parseAutoPermissionReview(
                "<review><outcome>allow</outcome><user_authorization>total</user_authorization></review>",
            ),
        ).toBeUndefined();
    });

    it("returns undefined for unreadable guardian text", () => {
        expect(parseAutoPermissionReview("no verdict here")).toBeUndefined();
        expect(parseAutoPermissionReview("")).toBeUndefined();
        expect(parseAutoPermissionReview("<review></review>")).toBeUndefined();
        expect(parseAutoPermissionReview('{"outcome":"allow"}')).toBeUndefined();
    });

    it("uses defaults for blank and whitespace-only rationales", () => {
        expect(
            parseAutoPermissionReview(
                "<review><outcome>allow</outcome><risk_level>medium</risk_level><rationale> \n\t </rationale></review>",
            ),
        ).toEqual({
            decision: "allow",
            risk: "medium",
            userAuthorization: "unknown",
            reason: "Auto-review returned a low-risk allow decision.",
        });
        expect(
            parseAutoPermissionReview(
                "<review><outcome>deny</outcome><user_authorization>low</user_authorization><rationale></rationale></review>",
            ),
        ).toEqual({
            decision: "deny",
            denialKind: "rejected",
            risk: "high",
            userAuthorization: "low",
            reason: "Auto-review returned a deny decision without a rationale.",
        });
    });

    it("normalizes all whitespace runs in a rationale", () => {
        expect(
            parseAutoPermissionReview(
                "<review><outcome>deny</outcome><rationale>first\u000bsecond\u00a0third\nfourth</rationale></review>",
            )?.reason,
        ).toBe("first second third fourth");
    });

    it("reads a verdict whose tags were never closed", () => {
        expect(
            parseAutoPermissionReview("<review>\n<outcome>allow</outcome>\n<rationale>Cut off"),
        ).toEqual({
            decision: "allow",
            risk: "low",
            userAuthorization: "unknown",
            reason: "Cut off",
        });
    });

    it("keeps a rationale at the cap and truncates one beyond it", () => {
        const atCap = "a".repeat(240);
        const overCap = "b".repeat(241);

        expect(
            parseAutoPermissionReview(
                `<review><outcome>deny</outcome><rationale>${atCap}</rationale></review>`,
            )?.reason,
        ).toBe(atCap);
        expect(
            parseAutoPermissionReview(
                `<review><outcome>deny</outcome><rationale>${overCap}</rationale></review>`,
            )?.reason,
        ).toBe(`${"b".repeat(237)}…`);
    });
});
