import { Value } from "@sinclair/typebox/value";

import {
    linuxSupervisorArchitectureSchema,
    type LinuxSupervisorArchitecture,
    type PlatformKey,
} from "./platform.js";
import { resolveBinaryForTarget } from "./impl/resolveBinaryForTarget.js";

export function resolveLinuxSupervisorBinary(
    architecture: LinuxSupervisorArchitecture,
    binaryPath?: string,
): string {
    if (!Value.Check(linuxSupervisorArchitectureSchema, architecture)) {
        throw new Error(`Unsupported Linux supervisor architecture: ${String(architecture)}.`);
    }
    const key: PlatformKey =
        architecture === "arm64" || architecture === "aarch64" ? "linux-arm64" : "linux-x64";
    return resolveBinaryForTarget(key, binaryPath);
}
