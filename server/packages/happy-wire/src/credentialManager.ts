import { z } from 'zod';

export const ManagedCredentialProviderSchema = z.enum(['claude', 'codex', 'grok']);
export type ManagedCredentialProvider = z.infer<typeof ManagedCredentialProviderSchema>;

export const ManagedCredentialUsageSchema = z.enum(['skills', 'browser', 'mcp']);
export type ManagedCredentialUsage = z.infer<typeof ManagedCredentialUsageSchema>;
const ManagedCredentialUsageListSchema = z.array(ManagedCredentialUsageSchema)
    .max(3)
    .refine((usage) => new Set(usage).size === usage.length, 'Usage labels must be unique');

export const ManagedCredentialTypeSchema = z.enum(['login', 'token', 'connection']);
export type ManagedCredentialType = z.infer<typeof ManagedCredentialTypeSchema>;

export const ManagedProviderAccountSummarySchema = z.object({
    id: z.string().uuid(),
    provider: ManagedCredentialProviderSchema,
    name: z.string().min(1).max(64),
    status: z.enum(['stored', 'limited']),
    current: z.boolean(),
    limitedUntil: z.number().int().positive().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    credentialVersion: z.number().int().positive(),
});
export type ManagedProviderAccountSummary = z.infer<typeof ManagedProviderAccountSummarySchema>;

export const ManagedProviderAccountListSchema = z.object({
    accounts: z.array(ManagedProviderAccountSummarySchema),
});
export type ManagedProviderAccountList = z.infer<typeof ManagedProviderAccountListSchema>;

export const SavedCredentialSummarySchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    type: ManagedCredentialTypeSchema,
    service: z.string().max(200),
    username: z.string().max(300).nullable(),
    usage: ManagedCredentialUsageListSchema,
    version: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
});
export type SavedCredentialSummary = z.infer<typeof SavedCredentialSummarySchema>;

export const CredentialManagerSnapshotSchema = z.object({
    accounts: z.array(ManagedProviderAccountSummarySchema),
    credentials: z.array(SavedCredentialSummarySchema),
});
export type CredentialManagerSnapshot = z.infer<typeof CredentialManagerSnapshotSchema>;

export const CredentialAccountTargetSchema = z.object({
    id: z.string().uuid(),
    provider: ManagedCredentialProviderSchema,
    name: z.string().min(1).max(64),
    expectedCredentialVersion: z.number().int().positive(),
});
export type CredentialAccountTarget = z.infer<typeof CredentialAccountTargetSchema>;

export const CredentialAccountRenameRequestSchema = CredentialAccountTargetSchema.extend({
    newName: z.string().min(1).max(64),
});
export type CredentialAccountRenameRequest = z.infer<typeof CredentialAccountRenameRequestSchema>;

const SavedCredentialInputSchema = z.object({
    name: z.string().min(1).max(100),
    type: ManagedCredentialTypeSchema,
    service: z.string().max(200),
    username: z.string().max(300).nullable().optional(),
    usage: ManagedCredentialUsageListSchema,
});

export const SavedCredentialCreateRequestSchema = SavedCredentialInputSchema.extend({
    secret: z.string().min(1).max(65_536),
}).strict();
export type SavedCredentialCreateRequest = z.infer<typeof SavedCredentialCreateRequestSchema>;

export const SavedCredentialUpdateRequestSchema = SavedCredentialInputSchema.extend({
    id: z.string().min(1),
    secret: z.string().min(1).max(65_536).optional(),
    expectedVersion: z.number().int().nonnegative(),
}).strict();
export type SavedCredentialUpdateRequest = z.infer<typeof SavedCredentialUpdateRequestSchema>;

export const SavedCredentialUpsertRequestSchema = z.union([
    SavedCredentialCreateRequestSchema,
    SavedCredentialUpdateRequestSchema,
]);
export type SavedCredentialUpsertRequest = z.infer<typeof SavedCredentialUpsertRequestSchema>;

export const SavedCredentialErrorCodeSchema = z.enum([
    'saved-credential-limit-reached',
    'saved-credential-name-conflict',
    'saved-credential-version-conflict',
]);
export type SavedCredentialErrorCode = z.infer<typeof SavedCredentialErrorCodeSchema>;

export const SavedCredentialIdRequestSchema = z.object({ id: z.string().min(1).max(100) });
export type SavedCredentialIdRequest = z.infer<typeof SavedCredentialIdRequestSchema>;

export const SavedCredentialRevealResponseSchema = z.object({
    id: z.string().min(1),
    secret: z.string(),
});
export type SavedCredentialRevealResponse = z.infer<typeof SavedCredentialRevealResponseSchema>;

export const CredentialLoginStateSchema = z.enum([
    'starting',
    'waiting-user',
    'succeeded',
    'failed',
    'canceled',
    'expired',
]);
export type CredentialLoginState = z.infer<typeof CredentialLoginStateSchema>;

export const CredentialLoginFlowSchema = z.object({
    id: z.string().min(1),
    provider: ManagedCredentialProviderSchema,
    name: z.string().min(1).max(64),
    state: CredentialLoginStateSchema,
    verificationUrl: z.string().url().optional(),
    userCode: z.string().min(1).max(64).optional(),
    requiresCodeEntry: z.boolean(),
    error: z.string().max(500).optional(),
    expiresAt: z.number().int().positive(),
});
export type CredentialLoginFlow = z.infer<typeof CredentialLoginFlowSchema>;

export const CredentialLoginStartRequestSchema = z.object({
    provider: ManagedCredentialProviderSchema,
    name: z.string().min(1).max(64),
    id: z.string().uuid().optional(),
    expectedCredentialVersion: z.number().int().positive().optional(),
}).refine(
    (request) => Boolean(request.id) === (request.expectedCredentialVersion !== undefined),
    'Existing-account login requires both id and expectedCredentialVersion',
);
export type CredentialLoginStartRequest = z.infer<typeof CredentialLoginStartRequestSchema>;
export const CredentialLoginFlowRequestSchema = z.object({ id: z.string().min(1).max(100) });
export const CredentialLoginSubmitCodeRequestSchema = CredentialLoginFlowRequestSchema.extend({
    code: z.string().min(1).max(4_096),
});
