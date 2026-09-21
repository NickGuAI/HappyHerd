export function testCliEnvironment(homeDir: string, serverUrl: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        HAPPYHERD_SERVER_URL: serverUrl,
        HAPPYHERD_HOME_DIR: homeDir,
        /* rename:preserve */
        HAPPY_SERVER_URL: serverUrl,
        HAPPY_HOME_DIR: homeDir,
        /* /rename:preserve */
    };
}
