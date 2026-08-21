import { describe, expect, it } from 'vitest';
import {
  detectHappyHerdCommanderAvatarMimeType,
  HappyHerdCommanderAvatarSchema,
  HappyHerdCommanderSummarySchema,
  MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES,
} from './commanderContext';

describe('HappyHerd Commander wire contracts', () => {
  it('recognizes complete avatar containers and rejects signature-only files', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
    const webp = Buffer.alloc(22);
    webp.write('RIFF', 0);
    webp.writeUInt32LE(webp.byteLength - 8, 4);
    webp.write('WEBP', 8);
    webp.write('VP8 ', 12);
    webp.writeUInt32LE(2, 16);

    expect(detectHappyHerdCommanderAvatarMimeType(png)).toBe('image/png');
    expect(detectHappyHerdCommanderAvatarMimeType(jpeg)).toBe('image/jpeg');
    expect(detectHappyHerdCommanderAvatarMimeType(webp)).toBe('image/webp');
    expect(detectHappyHerdCommanderAvatarMimeType(png.subarray(0, 8))).toBeNull();
    expect(detectHappyHerdCommanderAvatarMimeType(jpeg.subarray(0, 3))).toBeNull();
    expect(detectHappyHerdCommanderAvatarMimeType(webp.subarray(0, 12))).toBeNull();
  });

  it('accepts a Commander summary without exposing instruction contents', () => {
    const parsed = HappyHerdCommanderSummarySchema.parse({
      id: 'athena',
      name: 'Athena',
      role: 'Engineering commander',
      workspace: '/srv/app',
      commanderPath: '/home/me/.happyherd/commanders/athena/COMMANDER.md',
      agentContextPath: '/home/me/.happyherd/commanders/athena/agentcontext',
      avatar: {
        path: '/home/me/.happyherd/commanders/athena/avatar.png',
        mimeType: 'image/png',
        byteLength: 1024,
        sha256: 'a'.repeat(64),
      },
    });
    expect(parsed.name).toBe('Athena');
    expect(parsed.avatar?.mimeType).toBe('image/png');
    expect(parsed).not.toHaveProperty('content');
  });

  it('bounds Commander avatar descriptors to supported raster images', () => {
    expect(() => HappyHerdCommanderAvatarSchema.parse({
      path: '/tmp/avatar.jpg',
      mimeType: 'image/gif',
      byteLength: 128,
      sha256: 'a'.repeat(64),
    })).toThrow();
    expect(() => HappyHerdCommanderAvatarSchema.parse({
      path: '/tmp/avatar.png',
      mimeType: 'image/webp',
      byteLength: MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES + 1,
      sha256: 'a'.repeat(64),
    })).toThrow();
  });
});
