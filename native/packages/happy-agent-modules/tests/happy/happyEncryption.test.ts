import { describe, expect, it } from "vitest";

import {
    decryptHappyAuthBundle,
    decryptHappyPayload,
    encryptHappyPayload,
    wrapHappyDataKey,
} from "../../sources/happy/crypto/happyEncryption.js";
import { nobleBoxKeyPairFromSecretKey } from "../../sources/happy/crypto/nobleNaCl.js";

describe("Happy payload encryption", () => {
    it("matches Happy's versioned AES-256-GCM data-key layout", () => {
        const key = new Uint8Array(32).fill(7);
        const nonce = new Uint8Array(12).fill(9);

        const encrypted = encryptHappyPayload(
            key,
            "dataKey",
            { role: "session", value: "hello" },
            () => nonce,
        );

        expect(Buffer.from(encrypted).toString("hex")).toBe(
            "000909090909090909090909095ca7f6fbd295e35b8211ae4b9583ccb1f69c4185558282a54d9464ceb0186d15f1987c2209f00e194eb889a79ee3128dbf1b",
        );
        expect(decryptHappyPayload(key, "dataKey", encrypted)).toEqual({
            role: "session",
            value: "hello",
        });
    });

    it("matches Happy's nonce-prefixed NaCl secretbox legacy layout", () => {
        const key = new Uint8Array(32).fill(4);
        const nonce = new Uint8Array(24).fill(5);

        const encrypted = encryptHappyPayload(
            key,
            "legacy",
            { content: { text: "hello", type: "text" }, role: "user" },
            () => nonce,
        );

        expect(Buffer.from(encrypted).toString("hex")).toBe(
            "050505050505050505050505050505050505050505050505d8650b640e41ee9f0a250e22edcfd88c40675edb0ec662f74a66a47b3759e8da265370ee532ca05a1118748620d0cd57c3071e5884b4777a62393aa163f6933d999906413b17dbfd",
        );
        expect(decryptHappyPayload(key, "legacy", encrypted)).toEqual({
            content: { text: "hello", type: "text" },
            role: "user",
        });
    });

    it("refuses a payload that was tampered with", () => {
        const key = new Uint8Array(32).fill(11);
        const encrypted = encryptHappyPayload(key, "dataKey", { value: "hello" });
        encrypted.set([encrypted[encrypted.length - 1]! ^ 0xff], encrypted.length - 1);

        expect(decryptHappyPayload(key, "dataKey", encrypted)).toBeUndefined();
    });

    it("refuses a payload that is too short to hold an envelope", () => {
        expect(
            decryptHappyPayload(new Uint8Array(32), "dataKey", new Uint8Array(4)),
        ).toBeUndefined();
        expect(
            decryptHappyPayload(new Uint8Array(32), "legacy", new Uint8Array(4)),
        ).toBeUndefined();
    });
});

describe("Happy key exchange", () => {
    it("wraps a data key so only the account can open it", () => {
        const account = nobleBoxKeyPairFromSecretKey(new Uint8Array(32).fill(3));
        const dataKey = new Uint8Array(32).fill(8);

        const wrapped = wrapHappyDataKey(dataKey, account.publicKey);

        expect(wrapped[0]).toBe(0);
        // The authorization bundle is the same box without the leading version byte.
        expect(decryptHappyAuthBundle(wrapped.slice(1), account.secretKey)).toEqual(dataKey);
    });

    it("refuses an authorization bundle that is too short", () => {
        const account = nobleBoxKeyPairFromSecretKey(new Uint8Array(32).fill(3));

        expect(decryptHappyAuthBundle(new Uint8Array(16), account.secretKey)).toBeUndefined();
    });
});
