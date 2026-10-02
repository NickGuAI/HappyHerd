import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from "node:crypto";

import type { HappyEncryptionVariant } from "../HappyCredentials.js";
import {
    NACL_BOX_PUBLIC_KEY_BYTES,
    NACL_BOX_SECRET_KEY_BYTES,
    NACL_NONCE_BYTES,
    NACL_SECRETBOX_OVERHEAD_BYTES,
    nobleBoxKeyPairFromSecretKey,
    nobleBoxOpen,
    nobleBoxSeal,
    nobleSecretBoxOpen,
    nobleSecretBoxSeal,
} from "./nobleNaCl.js";

/** The bytes an AES-GCM bundle spends on its version byte, nonce and authentication tag. */
const AES_GCM_OVERHEAD_BYTES = 29;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

type RandomBytes = (size: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (size) => new Uint8Array(nodeRandomBytes(size));

/**
 * Encrypts a JSON payload for Happy.
 *
 * Legacy accounts use NaCl secretbox with a 24-byte nonce prefix. Data-key
 * accounts use AES-256-GCM behind a zero version byte.
 */
export function encryptHappyPayload(
    key: Uint8Array,
    variant: HappyEncryptionVariant,
    value: unknown,
    randomBytes: RandomBytes = defaultRandomBytes,
): Uint8Array {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    if (variant === "legacy") {
        const nonce = randomBytes(NACL_NONCE_BYTES);
        return concatenate(nonce, nobleSecretBoxSeal(plaintext, nonce, key));
    }
    const nonce = randomBytes(AES_GCM_NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return concatenate(new Uint8Array([0]), nonce, ciphertext, cipher.getAuthTag());
}

/** Decrypts a Happy payload, returning `undefined` for anything that does not open cleanly. */
export function decryptHappyPayload(
    key: Uint8Array,
    variant: HappyEncryptionVariant,
    bundle: Uint8Array,
): unknown | undefined {
    try {
        let plaintext: Uint8Array | undefined;
        if (variant === "legacy") {
            if (bundle.length < NACL_NONCE_BYTES + NACL_SECRETBOX_OVERHEAD_BYTES) {
                return undefined;
            }
            plaintext = nobleSecretBoxOpen(
                bundle.slice(NACL_NONCE_BYTES),
                bundle.slice(0, NACL_NONCE_BYTES),
                key,
            );
        } else {
            if (bundle[0] !== 0 || bundle.length < AES_GCM_OVERHEAD_BYTES) return undefined;
            const decipher = createDecipheriv(
                "aes-256-gcm",
                key,
                bundle.slice(1, 1 + AES_GCM_NONCE_BYTES),
            );
            decipher.setAuthTag(bundle.slice(-AES_GCM_TAG_BYTES));
            plaintext = new Uint8Array(
                Buffer.concat([
                    decipher.update(bundle.slice(1 + AES_GCM_NONCE_BYTES, -AES_GCM_TAG_BYTES)),
                    decipher.final(),
                ]),
            );
        }
        if (plaintext === undefined) return undefined;
        return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    } catch {
        return undefined;
    }
}

/**
 * Seals a data key to the account public key so only the account can unwrap it.
 *
 * The bundle is a zero version byte, the ephemeral public key, the nonce and
 * the sealed key.
 */
export function wrapHappyDataKey(
    dataKey: Uint8Array,
    recipientPublicKey: Uint8Array,
    randomBytes: RandomBytes = defaultRandomBytes,
): Uint8Array {
    const ephemeral = nobleBoxKeyPairFromSecretKey(randomBytes(NACL_BOX_SECRET_KEY_BYTES));
    const nonce = randomBytes(NACL_NONCE_BYTES);
    const encrypted = nobleBoxSeal(dataKey, nonce, recipientPublicKey, ephemeral.secretKey);
    return concatenate(new Uint8Array([0]), ephemeral.publicKey, nonce, encrypted);
}

/**
 * Opens the bundle Happy returns when a phone authorizes a terminal.
 *
 * Unlike a wrapped data key this bundle carries no version byte.
 */
export function decryptHappyAuthBundle(
    bundle: Uint8Array,
    recipientSecretKey: Uint8Array,
): Uint8Array | undefined {
    if (bundle.length < NACL_BOX_PUBLIC_KEY_BYTES + NACL_NONCE_BYTES) return undefined;
    return nobleBoxOpen(
        bundle.slice(NACL_BOX_PUBLIC_KEY_BYTES + NACL_NONCE_BYTES),
        bundle.slice(NACL_BOX_PUBLIC_KEY_BYTES, NACL_BOX_PUBLIC_KEY_BYTES + NACL_NONCE_BYTES),
        bundle.slice(0, NACL_BOX_PUBLIC_KEY_BYTES),
        recipientSecretKey,
    );
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}
