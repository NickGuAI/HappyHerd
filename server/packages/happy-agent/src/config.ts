import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
    serverUrl: string;
    homeDir: string;
    credentialPath: string;
};

export function loadConfig(): Config {
    /* rename:preserve */
    const serverUrl = (process.env.HAPPYHERD_SERVER_URL ?? process.env.HAPPY_SERVER_URL ?? 'https://api.cluster-fluster.com').replace(/\/+$/, '');
    const homeDir = process.env.HAPPYHERD_HOME_DIR ?? process.env.HAPPY_HOME_DIR ?? join(homedir(), '.happy');
    /* /rename:preserve */
    const credentialPath = join(homeDir, 'agent.key');
    return { serverUrl, homeDir, credentialPath };
}
