import { z } from 'zod';

export const CredentialProviderSchema = z.enum(['claude', 'codex', 'grok']);
export type CredentialProvider = z.infer<typeof CredentialProviderSchema>;

const CredentialAccountBaseSchema = z.object({
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  limitedUntil: z.number().int().positive().nullable().default(null),
});

export const CredentialAccountSchema = z.discriminatedUnion('provider', [
  CredentialAccountBaseSchema.extend({
    provider: z.literal('claude'),
    credential: z.object({
      type: z.literal('oauth-token'),
      token: z.string().min(1),
    }),
  }),
  CredentialAccountBaseSchema.extend({
    provider: z.literal('codex'),
    credential: z.object({
      type: z.literal('auth-file'),
      path: z.string().min(1),
    }),
  }),
  CredentialAccountBaseSchema.extend({
    provider: z.literal('grok'),
    credential: z.object({
      type: z.literal('auth-file'),
      path: z.string().min(1),
    }),
  }),
]);

export type CredentialAccount = z.infer<typeof CredentialAccountSchema>;

export const CredentialPoolStateSchema = z.object({
  schemaVersion: z.literal(1),
  current: z.object({
    claude: z.string().optional(),
    codex: z.string().optional(),
    grok: z.string().optional(),
  }),
  accounts: z.array(CredentialAccountSchema),
});

export type CredentialPoolState = z.infer<typeof CredentialPoolStateSchema>;

export type CredentialPoolSelection =
  | { type: 'unconfigured' }
  | { type: 'available'; account: CredentialAccount }
  | { type: 'all-limited'; limitedUntil: number };

export type CredentialPoolRotation =
  | { type: 'ignored' }
  | { type: 'next-account'; account: CredentialAccount }
  | { type: 'all-limited'; limitedUntil: number };
