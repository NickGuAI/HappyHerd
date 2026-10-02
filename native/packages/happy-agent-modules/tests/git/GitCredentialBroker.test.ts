import { request } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { GitCredentialBroker } from "../../sources/git/GitCredentialBroker.js";

const creator = { instanceId: "instance-1", profileId: "profile-1" };
const brokers: GitCredentialBroker[] = [];

afterEach(() => {
    for (const broker of brokers.splice(0)) broker.close();
});

describe("GitCredentialBroker", () => {
    it("keeps tokens in memory and expires command-scoped capabilities", async () => {
        const seen: string[] = [];
        const broker = new GitCredentialBroker({
            forward: async (input) => {
                seen.push(input.token);
                input.response.end("ok");
            },
        });
        brokers.push(broker);
        const authentication = await broker.register({
            creator,
            projectId: "project-1",
            repository: "slopus/rig",
            token: "secret-token",
        });
        expect(JSON.stringify(authentication.environment)).not.toContain("secret-token");
        const command = broker.authentication("project-1", creator);
        if (command === undefined) throw new Error("Expected authentication.");
        const lease = command.activate();
        const prefix = (lease.environment.GIT_CONFIG_KEY_1 ?? "")
            .replace("url.", "")
            .replace(".insteadOf", "");
        expect(await send(`${prefix}/info/refs?service=git-upload-pack`)).toBe(200);
        expect(seen).toEqual(["secret-token"]);
        lease.release();
        expect(await send(`${prefix}/info/refs?service=git-upload-pack`)).toBe(404);
    });
});

async function send(url: string): Promise<number> {
    return await new Promise((resolve, reject) => {
        const outgoing = request(url, (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode ?? 0));
        });
        outgoing.once("error", reject);
        outgoing.end();
    });
}
