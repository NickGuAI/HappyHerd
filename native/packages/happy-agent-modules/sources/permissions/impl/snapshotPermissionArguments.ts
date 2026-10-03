import { Value } from "@sinclair/typebox/value";

import {
    MAX_PERMISSION_ARGUMENT_BYTES,
    MAX_PERMISSION_ARGUMENT_DEPTH,
    MAX_PERMISSION_ARGUMENT_ITEMS,
    MAX_PERMISSION_ARGUMENT_STRING,
    permissionReviewArgumentsSchema,
} from "../PermissionReviewer.js";

const textEncoder = new TextEncoder();

/**
 * Validate, detach, freeze, and bound the arguments shown to a reviewer. The agent keeps the
 * original validated arguments for execution; a reviewer can only see this independent snapshot.
 */
export function snapshotPermissionArguments(value: unknown): unknown {
    const snapshot = clone(value, 0, new WeakSet<object>());
    if (!Value.Check(permissionReviewArgumentsSchema, snapshot)) {
        throw new Error("Permission arguments have an unsupported shape.");
    }
    const encoded = JSON.stringify(snapshot) ?? "";
    if (textEncoder.encode(encoded).byteLength > MAX_PERMISSION_ARGUMENT_BYTES) {
        throw new Error("Permission arguments exceed the reviewer size limit.");
    }
    return snapshot;
}

function clone(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (depth > MAX_PERMISSION_ARGUMENT_DEPTH) {
        throw new Error("Permission arguments exceed the reviewer nesting limit.");
    }
    if (value === undefined || value === null) return value;
    if (typeof value === "string") {
        if (value.length > MAX_PERMISSION_ARGUMENT_STRING) {
            throw new Error("Permission arguments contain an oversized string.");
        }
        return value;
    }
    if (typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object") {
        throw new Error("Permission arguments contain an unsupported value.");
    }
    if (seen.has(value)) throw new Error("Permission arguments contain a cycle.");
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            if (value.length > MAX_PERMISSION_ARGUMENT_ITEMS) {
                throw new Error("Permission arguments contain too many items.");
            }
            const result = value.map((item) => clone(item, depth + 1, seen));
            return Object.freeze(result);
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error("Permission arguments must contain plain objects.");
        }
        const keys = Object.keys(value);
        if (keys.length > MAX_PERMISSION_ARGUMENT_ITEMS) {
            throw new Error("Permission arguments contain too many properties.");
        }
        const source = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            if (key.length > 256) {
                throw new Error("Permission arguments contain an oversized property name.");
            }
            Object.defineProperty(result, key, {
                configurable: false,
                enumerable: true,
                value: clone(source[key], depth + 1, seen),
                writable: false,
            });
        }
        return Object.freeze(result);
    } finally {
        seen.delete(value);
    }
}
