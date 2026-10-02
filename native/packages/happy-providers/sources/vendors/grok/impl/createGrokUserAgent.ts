import { arch, platform } from "node:process";

import { GROK_BUILD_CLIENT_VERSION } from "@/vendors/grok/impl/grokConstants.js";

/** Reproduces the grok-build user agent unless the caller chooses to identify itself instead. */
export function createGrokUserAgent(userAgent?: string): string {
    const override = userAgent?.trim();
    if (override !== undefined && override.length > 0) return override;
    const operatingSystem = platform === "darwin" ? "macos" : platform;
    const architecture = arch === "arm64" ? "aarch64" : arch;
    return `grok-shell/${GROK_BUILD_CLIENT_VERSION} (${operatingSystem}; ${architecture})`;
}
