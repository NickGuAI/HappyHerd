import { Type, type Static } from "@sinclair/typebox";

/**
 * Parses the guardian's final message into a verdict.
 *
 * The reviewer answers in the tagged form `createPermissionReviewInstructions` asks for, because
 * v1's hand-assembled JSON broke whenever the rationale quoted the user: a single unescaped quote
 * turned an allow into an unreadable answer and refused the call. Tags have no escaping to get
 * wrong — the three classifications are closed word lists, and the rationale is whatever sits
 * between its own tags.
 *
 * Reading stays deliberately thin. The last `<review>` block wins so the reviewer may think in
 * prose first, and each field is read once from inside it. An unrecognized classification is not
 * a verdict; the defaults, whitespace normalization, and 240-character reason cap are v1's.
 */

export const autoPermissionRiskSchema = Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
    Type.Literal("critical"),
]);

export type AutoPermissionRisk = Static<typeof autoPermissionRiskSchema>;

export const autoPermissionUserAuthorizationSchema = Type.Union([
    Type.Literal("unknown"),
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
]);

export type AutoPermissionUserAuthorization = Static<typeof autoPermissionUserAuthorizationSchema>;

/**
 * Why an action was refused, which decides what the agent is told to do next.
 *
 * A reviewed refusal is a judgement about the action itself, so the agent must not route around
 * it. A refusal the reviewer never actually made carries no such judgement, so the agent is told
 * the action is merely unproven rather than unsafe.
 */
export const autoPermissionDenialKindSchema = Type.Union([
    Type.Literal("rejected"),
    Type.Literal("timed_out"),
    Type.Literal("unavailable"),
]);

export type AutoPermissionDenialKind = Static<typeof autoPermissionDenialKindSchema>;

export const autoPermissionReviewSchema = Type.Object(
    {
        decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
        denialKind: Type.Optional(autoPermissionDenialKindSchema),
        reason: Type.String(),
        risk: autoPermissionRiskSchema,
        userAuthorization: autoPermissionUserAuthorizationSchema,
    },
    { additionalProperties: false },
);

export type AutoPermissionReview = Static<typeof autoPermissionReviewSchema>;

const RISKS: readonly AutoPermissionRisk[] = ["low", "medium", "high", "critical"];
const AUTHORIZATIONS: readonly AutoPermissionUserAuthorization[] = [
    "unknown",
    "low",
    "medium",
    "high",
];

export function parseAutoPermissionReview(text: string): AutoPermissionReview | undefined {
    const block = reviewBlock(text);
    const outcome = word(readTag(block, "outcome"));
    if (outcome !== "allow" && outcome !== "deny") return undefined;
    const riskWord = word(readTag(block, "risk_level"));
    const risk = RISKS.find((candidate) => candidate === riskWord);
    if (riskWord !== undefined && risk === undefined) return undefined;
    const authorizationWord = word(readTag(block, "user_authorization"));
    const userAuthorization = AUTHORIZATIONS.find((candidate) => candidate === authorizationWord);
    if (authorizationWord !== undefined && userAuthorization === undefined) return undefined;
    const rationale = readTag(block, "rationale");
    const reason =
        rationale !== undefined && rationale.trim().length > 0
            ? rationale
            : outcome === "allow"
              ? "Auto-review returned a low-risk allow decision."
              : "Auto-review returned a deny decision without a rationale.";
    return {
        decision: outcome,
        ...(outcome === "deny" ? { denialKind: "rejected" as const } : {}),
        reason: normalizeReason(reason),
        risk: risk ?? (outcome === "allow" ? "low" : "high"),
        userAuthorization: userAuthorization ?? "unknown",
    };
}

/**
 * The verdict is the last `<review>` block, so a reviewer may reason in prose — and quote the
 * contract it was given — before answering. A message that tags its fields without wrapping them
 * is read whole, the same thin courtesy v1 extended to an assessment buried in prose.
 */
function reviewBlock(text: string): string {
    const start = text.lastIndexOf("<review>");
    if (start < 0) return text;
    const from = start + "<review>".length;
    const end = text.indexOf("</review>", from);
    return end < 0 ? text.slice(from) : text.slice(from, end);
}

/** The text between a field's own tags, or to the end of the block when it was never closed. */
function readTag(block: string, name: string): string | undefined {
    const open = `<${name}>`;
    const start = block.indexOf(open);
    if (start < 0) return undefined;
    const from = start + open.length;
    const end = block.indexOf(`</${name}>`, from);
    return end < 0 ? block.slice(from) : block.slice(from, end);
}

/** A closed-list field's value: one bare word, however the reviewer cased or spaced it. */
function word(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function normalizeReason(reason: string): string {
    const normalized = reason.replace(/\s+/gu, " ").trim();
    return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}…`;
}
