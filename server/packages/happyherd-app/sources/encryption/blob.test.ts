import { describe, it, expect, vi } from 'vitest';

// Mock expo-crypto to use Node.js crypto
vi.mock('expo-crypto', () => ({
    getRandomBytes: (n: number) => {
        const { randomBytes } = require('crypto');
        return new Uint8Array(randomBytes(n));
    },
}));

// Mock the libsodium.lib import to use the Node.js libsodium-wrappers
vi.mock('@/encryption/libsodium.lib', async () => {
    const { default: s } = await import('libsodium-wrappers');
    // The blob helper is synchronous, so initialize the exact wrapper object
    // injected into it before the module under test is evaluated. Waiting on a
    // separate ESM/CJS view makes clean CI workers depend on module warm-up
    // order and can leave the injected object without secretbox functions.
    await s.ready;
    // Model runtimes where wrapper metadata is not available when the
    // synchronous blob helper runs. The 24-byte nonce is a wire-format
    // invariant, not something encryptBlob should discover at runtime.
    return {
        default: new Proxy(s, {
            get(target, property, receiver) {
                if (property === 'crypto_secretbox_NONCEBYTES') {
                    return undefined;
                }
                return Reflect.get(target, property, receiver);
            },
        }),
    };
});

import { encryptBlob, decryptBlob } from './blob';

// 32-byte key for crypto_secretbox (NaCl symmetric encryption)
const TEST_KEY = new Uint8Array(32);
for (let i = 0; i < 32; i++) TEST_KEY[i] = i;

describe('blob encryption', () => {
    it('should encrypt and decrypt a small blob', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const encrypted = encryptBlob(data, TEST_KEY);
        const decrypted = decryptBlob(encrypted, TEST_KEY);

        expect(decrypted).not.toBeNull();
        expect(new Uint8Array(decrypted!)).toEqual(data);
    });

    it('should encrypt and decrypt an empty blob', () => {
        const data = new Uint8Array(0);
        const encrypted = encryptBlob(data, TEST_KEY);
        const decrypted = decryptBlob(encrypted, TEST_KEY);

        expect(decrypted).not.toBeNull();
        expect(new Uint8Array(decrypted!)).toEqual(data);
    });

    it('should encrypt and decrypt a large blob (1MB)', () => {
        const data = new Uint8Array(1024 * 1024);
        for (let i = 0; i < data.length; i++) data[i] = i % 256;

        const encrypted = encryptBlob(data, TEST_KEY);
        const decrypted = decryptBlob(encrypted, TEST_KEY);

        expect(decrypted).not.toBeNull();
        expect(new Uint8Array(decrypted!)).toEqual(data);
    }, 15_000);

    it('should handle binary data with null bytes', () => {
        const data = new Uint8Array([0, 0, 0, 255, 0, 128, 0]);
        const encrypted = encryptBlob(data, TEST_KEY);
        const decrypted = decryptBlob(encrypted, TEST_KEY);

        expect(decrypted).not.toBeNull();
        expect(new Uint8Array(decrypted!)).toEqual(data);
    });

    it('should produce different ciphertexts for same plaintext (random nonce)', () => {
        const data = new Uint8Array([1, 2, 3]);
        const encrypted1 = encryptBlob(data, TEST_KEY);
        const encrypted2 = encryptBlob(data, TEST_KEY);

        // Nonces differ, so ciphertexts should differ
        expect(encrypted1).not.toEqual(encrypted2);

        // But both decrypt to the same plaintext
        expect(new Uint8Array(decryptBlob(encrypted1, TEST_KEY)!)).toEqual(data);
        expect(new Uint8Array(decryptBlob(encrypted2, TEST_KEY)!)).toEqual(data);
    });

    it('should return null for wrong key', () => {
        const data = new Uint8Array([1, 2, 3]);
        const encrypted = encryptBlob(data, TEST_KEY);

        const wrongKey = new Uint8Array(32);
        wrongKey.fill(99);

        const decrypted = decryptBlob(encrypted, wrongKey);
        expect(decrypted).toBeNull();
    });

    it('should return null for corrupted ciphertext', () => {
        const data = new Uint8Array([1, 2, 3]);
        const encrypted = encryptBlob(data, TEST_KEY);

        // Corrupt a byte in the ciphertext (after the nonce)
        const corrupted = new Uint8Array(encrypted);
        corrupted[encrypted.length - 1] ^= 0xff;

        const decrypted = decryptBlob(corrupted, TEST_KEY);
        expect(decrypted).toBeNull();
    });

    it('should return null for truncated data', () => {
        const data = new Uint8Array([1, 2, 3]);
        const encrypted = encryptBlob(data, TEST_KEY);

        // Truncate to just 5 bytes (less than nonce)
        const truncated = encrypted.slice(0, 5);
        const decrypted = decryptBlob(truncated, TEST_KEY);
        expect(decrypted).toBeNull();
    });

    it('encrypted blob should be larger than original (nonce + auth tag overhead)', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const encrypted = encryptBlob(data, TEST_KEY);

        // crypto_secretbox: 24-byte nonce + 16-byte auth tag + plaintext
        expect(encrypted.length).toBe(data.length + 24 + 16);
    });
});
