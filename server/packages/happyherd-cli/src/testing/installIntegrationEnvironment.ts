import { afterAll } from 'vitest';
import {
    applyEnvironmentToProcess,
    createIntegrationEnvironment,
    destroyIntegrationEnvironment,
    type EnvironmentTemplate,
    type IntegrationEnvironment,
} from './integrationEnvironment';

type IntegrationEnvironmentProfile = {
    template: EnvironmentTemplate;
    up: boolean;
};

declare global {
    // eslint-disable-next-line no-var
    var __happyherdIntegrationEnv: IntegrationEnvironment | undefined;
}

export async function installIntegrationEnvironment(profile: IntegrationEnvironmentProfile) {
    const previousEnv = {
        HAPPYHERD_SERVER_URL: process.env.HAPPYHERD_SERVER_URL,
        HAPPYHERD_WEBAPP_URL: process.env.HAPPYHERD_WEBAPP_URL,
        HAPPYHERD_HOME_DIR: process.env.HAPPYHERD_HOME_DIR,
        HAPPYHERD_PROJECT_DIR: process.env.HAPPYHERD_PROJECT_DIR,
        HAPPYHERD_VARIANT: process.env.HAPPYHERD_VARIANT,
        DEBUG: process.env.DEBUG,
    };

    const env = await createIntegrationEnvironment(profile);
    applyEnvironmentToProcess(env);
    globalThis.__happyherdIntegrationEnv = env;

    afterAll(async () => {
        try {
            await destroyIntegrationEnvironment(env);
        } finally {
            for (const [key, value] of Object.entries(previousEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }

            if (globalThis.__happyherdIntegrationEnv?.name === env.name) {
                globalThis.__happyherdIntegrationEnv = undefined;
            }
        }
    });
}
