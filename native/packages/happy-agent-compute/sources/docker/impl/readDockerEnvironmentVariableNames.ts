import type Dockerode from "dockerode";

/**
 * The names of the environment variables the container was configured with.
 *
 * A command's environment is layered on top of what the image already sets, so a caller that needs
 * to reason about which names the image defines can read them without pulling their values out of
 * the container. Only the names are returned; their values stay inside the container.
 */
export async function readDockerEnvironmentVariableNames(
    container: Dockerode.Container,
): Promise<readonly string[]> {
    const details = await container.inspect();
    return (details.Config.Env ?? []).map((entry) => {
        const separator = entry.indexOf("=");
        return separator === -1 ? entry : entry.slice(0, separator);
    });
}
