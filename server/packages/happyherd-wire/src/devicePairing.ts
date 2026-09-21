import { z } from 'zod';

// A short-lived identifier for an already authenticated machine. This code
// never grants account access: all remote calls use the existing machine RPC.
export const DEVICE_PAIRING_TTL_MS = 120_000;
export const DevicePairingCodeSchema = z.string().regex(/^\d{8}$/);
export const DevicePairingIdentitySchema = z.object({
  machineId: z.string().min(1),
  host: z.string().min(1),
});
export const DevicePairingCheckRequestSchema = z.object({
  code: DevicePairingCodeSchema,
}).strict();
export const DevicePairingConfirmRequestSchema = z.object({
  code: DevicePairingCodeSchema,
  requestId: z.string().min(1).max(128),
}).strict();

const unavailable = [
  z.object({ status: z.literal('not_found') }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('used') }),
] as const;

export const DevicePairingCheckResponseSchema = z.discriminatedUnion('status', [
  DevicePairingIdentitySchema.extend({
    status: z.literal('pending'),
    expiresAt: z.number(),
  }),
  ...unavailable,
]);
export const DevicePairingConfirmResponseSchema = z.discriminatedUnion('status', [
  DevicePairingIdentitySchema.extend({ status: z.literal('connected') }),
  ...unavailable,
]);
export const DevicePairingCreateResponseSchema = DevicePairingIdentitySchema.extend({
  code: DevicePairingCodeSchema,
  serverUrl: z.string().url(),
  expiresAt: z.number(),
});
export const DevicePairingCancelResponseSchema = z.discriminatedUnion('status', unavailable);

export type DevicePairingIdentity = z.infer<typeof DevicePairingIdentitySchema>;
export type DevicePairingCheckResponse = z.infer<typeof DevicePairingCheckResponseSchema>;
export type DevicePairingConfirmRequest = z.infer<typeof DevicePairingConfirmRequestSchema>;
export type DevicePairingConfirmResponse = z.infer<typeof DevicePairingConfirmResponseSchema>;
export type DevicePairingCreateResponse = z.infer<typeof DevicePairingCreateResponseSchema>;
export type DevicePairingCancelResponse = z.infer<typeof DevicePairingCancelResponseSchema>;
