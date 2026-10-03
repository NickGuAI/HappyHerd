import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
    DEFAULT_OBSERVATION_SETTINGS,
    OBSERVATION_LOG_LEVELS,
    observationEndpointSchema,
    observationSettingsSchema,
    resolveObservationSettings,
} from "../../sources/observation/ObservationSettings.js";

describe("observation settings edge cases", () => {
    it("freezes both the defaults and every resolved result", () => {
        const resolved = resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {});

        expect(Object.isFrozen(DEFAULT_OBSERVATION_SETTINGS)).toBe(true);
        expect(Object.isFrozen(resolved)).toBe(true);
        expect(resolved).not.toBe(DEFAULT_OBSERVATION_SETTINGS);
    });

    it.each([
        ["0", false],
        ["1", true],
        ["false", false],
        ["true", true],
        ["no", false],
        ["yes", true],
        ["off", false],
        ["on", true],
        ["  YeS  ", true],
    ])("parses the boolean spelling %j as %j", (raw, expected) => {
        expect(
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_LOGS: raw,
            }).logs,
        ).toBe(expected);
    });

    it.each(OBSERVATION_LOG_LEVELS)("accepts the configured log level %s", (level) => {
        expect(
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_LOG_LEVEL: ` ${level.toUpperCase()} `,
            }).logLevel,
        ).toBe(level);
    });

    it("does not let a blank environment variable erase a configured value", () => {
        const configured = {
            ...DEFAULT_OBSERVATION_SETTINGS,
            logs: false,
            tracesEndpoint: "https://collector.example/v1/traces",
        };

        expect(
            resolveObservationSettings(configured, {
                HAPPY_OBSERVATION_LOGS: " \t",
                HAPPY_OBSERVATION_TRACES_ENDPOINT: " ",
            }),
        ).toEqual(configured);
    });

    it.each([
        "http://",
        "https://",
        "https:///",
        "https://?query-only",
        "https://#fragment-only",
        "ftp://collector.example/v1/traces",
        "collector.example/v1/traces",
        "http://collector example/v1/traces",
    ])("rejects an endpoint that is not an HTTP URL with a host: %s", (endpoint) => {
        expect(Value.Check(observationEndpointSchema, endpoint)).toBe(false);
        expect(() =>
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_TRACES_ENDPOINT: endpoint,
            }),
        ).toThrow("HAPPY_OBSERVATION_TRACES_ENDPOINT");
    });

    it("rejects unknown configured fields as well as invalid values", () => {
        expect(() =>
            resolveObservationSettings(
                { ...DEFAULT_OBSERVATION_SETTINGS, unexpected: true } as never,
                {},
            ),
        ).toThrow("configured observation settings are invalid");
        expect(() =>
            resolveObservationSettings(
                { ...DEFAULT_OBSERVATION_SETTINGS, tracesEndpoint: "not-a-url" },
                {},
            ),
        ).toThrow("configured observation settings are invalid");
    });

    it("rejects unknown environment boolean spellings without changing the configured value", () => {
        expect(() =>
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_HISTORY_DUMP: "enabled",
            }),
        ).toThrow('HAPPY_OBSERVATION_HISTORY_DUMP must be one of "true", "false", "1", or "0".');
    });

    it("keeps the runtime schema closed to unknown settings", () => {
        expect(
            Value.Check(observationSettingsSchema, {
                ...DEFAULT_OBSERVATION_SETTINGS,
                extra: "nope",
            }),
        ).toBe(false);
    });
});
