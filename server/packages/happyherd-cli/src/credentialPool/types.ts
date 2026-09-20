import { z } from 'zod';

export const CredentialProviderSchema = z.enum(['claude', 'codex', 'grok']);
export type CredentialProvider = z.infer<typeof CredentialProviderSchema>;

const LegacyCredentialAccountBaseSchema = z.object({
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  limitedUntil: z.number().int().positive().nullable().default(null),
});

const credentialVariants = <T extends z.ZodRawShape>(base: z.ZodObject<T>) => [
  base.extend({
    provider: z.literal('claude'),
    credential: z.object({
      type: z.literal('oauth-token'),
      token: z.string().min(1),
    }),
  }),
  base.extend({
    provider: z.literal('codex'),
    credential: z.object({
      type: z.literal('auth-file'),
      path: z.string().min(1),
    }),
  }),
  base.extend({
    provider: z.literal('grok'),
    credential: z.object({
      type: z.literal('auth-file'),
      path: z.string().min(1),
    }),
  }),
] as const;

const CredentialAccountBaseSchema = LegacyCredentialAccountBaseSchema.extend({
  id: z.string().uuid(),
  credentialVersion: z.number().int().positive(),
});

export const CredentialAccountSchema = z.discriminatedUnion('provider', credentialVariants(CredentialAccountBaseSchema));

export type CredentialAccount = z.infer<typeof CredentialAccountSchema>;

export const CredentialPoolStateSchema = z.object({
  schemaVersion: z.literal(2),
  current: z.object({
    claude: z.string().optional(),
    codex: z.string().optional(),
    grok: z.string().optional(),
  }),
  accounts: z.array(CredentialAccountSchema),
});

export const LegacyCredentialPoolStateSchema = z.object({
  schemaVersion: z.literal(1),
  current: z.object({
    claude: z.string().optional(),
    codex: z.string().optional(),
    grok: z.string().optional(),
  }),
  accounts: z.array(z.discriminatedUnion('provider', credentialVariants(LegacyCredentialAccountBaseSchema))),
});

export type CredentialPoolState = z.infer<typeof CredentialPoolStateSchema>;

export type CredentialPoolSelection =
  | { type: 'unconfigured' }
  | { type: 'available'; account: CredentialAccount }
  | { type: 'all-limited'; limitedUntil: number };

export type CredentialPoolRotation =
  | { type: 'ignored' }
  | { type: 'credential-changed'; account: string }
  | { type: 'next-account'; account: CredentialAccount; fromAccount: string }
  | { type: 'all-limited'; limitedUntil: number; fromAccount: string };
