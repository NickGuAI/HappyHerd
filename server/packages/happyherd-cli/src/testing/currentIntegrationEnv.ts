import type { IntegrationEnvironment } from './integrationEnvironment';

declare global {
    // eslint-disable-next-line no-var
    var __happyherdIntegrationEnv: IntegrationEnvironment | undefined;
}

export function getIntegrationEnv(): IntegrationEnvironment {
    if (!globalThis.__happyherdIntegrationEnv) {
        throw new Error('No active integration environment');
    }

    return globalThis.__happyherdIntegrationEnv;
}
