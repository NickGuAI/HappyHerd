import { describe, expect, it } from "vitest";

import {
    DEFAULT_OBSERVATION_SETTINGS,
    resolveObservationSettings,
} from "../../sources/observation/ObservationSettings.js";

describe("resolveObservationSettings", () => {
    it("keeps the configured settings when the environment says nothing", () => {
        const configured = {
            ...DEFAULT_OBSERVATION_SETTINGS,
            historyDump: true,
            logLevel: "debug" as const,
        };

        expect(resolveObservationSettings(configured, {})).toEqual(configured);
    });

    it("lets the environment override one setting for a single debugging run", () => {
        const resolved = resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
            HAPPY_OBSERVATION_HISTORY_DUMP: "yes",
            HAPPY_OBSERVATION_LOG_LEVEL: "TRACE",
            HAPPY_OBSERVATION_TRACES: "1",
            HAPPY_OBSERVATION_TRACES_ENDPOINT: "https://collector.internal:4318/v1/traces",
        });

        expect(resolved).toEqual({
            historyDump: true,
            logLevel: "trace",
            logs: true,
            traces: true,
            tracesEndpoint: "https://collector.internal:4318/v1/traces",
        });
    });

    it("ignores an override that is present but empty", () => {
        const resolved = resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
            HAPPY_OBSERVATION_LOG_LEVEL: "   ",
            HAPPY_OBSERVATION_TRACES: "",
        });

        expect(resolved).toEqual(DEFAULT_OBSERVATION_SETTINGS);
    });

    it("refuses an override it cannot understand rather than quietly dropping it", () => {
        expect(() =>
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_TRACES: "maybe",
            }),
        ).toThrow("HAPPY_OBSERVATION_TRACES");
        expect(() =>
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_LOG_LEVEL: "verbose",
            }),
        ).toThrow("HAPPY_OBSERVATION_LOG_LEVEL");
        expect(() =>
            resolveObservationSettings(DEFAULT_OBSERVATION_SETTINGS, {
                HAPPY_OBSERVATION_TRACES_ENDPOINT: "collector.internal",
            }),
        ).toThrow("HAPPY_OBSERVATION_TRACES_ENDPOINT");
    });

    it("refuses configured settings that are not settings at all", () => {
        expect(() =>
            resolveObservationSettings(
                { ...DEFAULT_OBSERVATION_SETTINGS, logLevel: "loud" } as never,
                {},
            ),
        ).toThrow("configured observation settings are invalid");
    });
});
