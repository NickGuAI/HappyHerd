import * as z from 'zod';

export const MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES = 10 * 1024 * 1024;

export type HappyHerdCommanderAvatarMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_FORMAT_SIGNATURE = [0x57, 0x45, 0x42, 0x50] as const;

function matchesBytes(content: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => content[offset + index] === byte);
}

function readUint32BigEndian(content: Uint8Array, offset: number): number {
  return (
    content[offset] * 0x1000000
    + content[offset + 1] * 0x10000
    + content[offset + 2] * 0x100
    + content[offset + 3]
  ) >>> 0;
}

function readUint32LittleEndian(content: Uint8Array, offset: number): number {
  return (
    content[offset]
    + content[offset + 1] * 0x100
    + content[offset + 2] * 0x10000
    + content[offset + 3] * 0x1000000
  ) >>> 0;
}

function chunkName(content: Uint8Array, offset: number): string {
  return String.fromCharCode(
    content[offset],
    content[offset + 1],
    content[offset + 2],
    content[offset + 3],
  );
}

function isPngContainer(content: Uint8Array): boolean {
  if (!matchesBytes(content, PNG_SIGNATURE) || content.byteLength < 45) return false;
  let offset: number = PNG_SIGNATURE.length;
  let sawHeader = false;
  let sawImageData = false;

  while (offset + 12 <= content.byteLength) {
    const length = readUint32BigEndian(content, offset);
    const type = chunkName(content, offset + 4);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > content.byteLength) return false;

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = readUint32BigEndian(content, offset + 8);
      const height = readUint32BigEndian(content, offset + 12);
      if (width === 0 || height === 0) return false;
      sawHeader = true;
    } else if (type === 'IHDR') {
      return false;
    }

    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      return length === 0 && sawImageData && chunkEnd === content.byteLength;
    }
    offset = chunkEnd;
  }
  return false;
}

function isJpegContainer(content: Uint8Array): boolean {
  return content.byteLength >= 6
    && matchesBytes(content, JPEG_SIGNATURE)
    && content[content.byteLength - 2] === 0xff
    && content[content.byteLength - 1] === 0xd9;
}

function isWebpContainer(content: Uint8Array): boolean {
  if (
    content.byteLength < 20
    || !matchesBytes(content, WEBP_RIFF_SIGNATURE)
    || !matchesBytes(content, WEBP_FORMAT_SIGNATURE, 8)
    || readUint32LittleEndian(content, 4) + 8 !== content.byteLength
  ) {
    return false;
  }

  let offset = 12;
  let sawImageData = false;
  while (offset + 8 <= content.byteLength) {
    const type = chunkName(content, offset);
    const length = readUint32LittleEndian(content, offset + 4);
    const dataEnd = offset + 8 + length;
    const chunkEnd = dataEnd + (length % 2);
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > content.byteLength) return false;
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') sawImageData = true;
    offset = chunkEnd;
  }
  return offset === content.byteLength && sawImageData;
}

/**
 * Recognize a bounded avatar only when its outer image container is complete.
 * Platform image decoders remain the final authority for pixel-level validity.
 */
export function detectHappyHerdCommanderAvatarMimeType(
  content: Uint8Array,
): HappyHerdCommanderAvatarMimeType | null {
  if (isPngContainer(content)) return 'image/png';
  if (isJpegContainer(content)) return 'image/jpeg';
  if (isWebpContainer(content)) return 'image/webp';
  return null;
}

export const HappyHerdCommanderAvatarSchema = z.object({
  path: z.string().trim().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byteLength: z.number().int().positive().max(MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type HappyHerdCommanderAvatar = z.infer<typeof HappyHerdCommanderAvatarSchema>;

export const HappyHerdCommanderSummarySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  workspace: z.string().trim().min(1),
  commanderPath: z.string().trim().min(1),
  agentContextPath: z.string().trim().min(1),
  avatar: HappyHerdCommanderAvatarSchema.optional(),
}).strict();

export type HappyHerdCommanderSummary = z.infer<typeof HappyHerdCommanderSummarySchema>;

export const HappyHerdCommanderListResponseSchema = z.object({
  commanders: z.array(HappyHerdCommanderSummarySchema),
  globalAgentsPath: z.string().trim().min(1).nullable(),
}).strict();

export type HappyHerdCommanderListResponse = z.infer<typeof HappyHerdCommanderListResponseSchema>;
