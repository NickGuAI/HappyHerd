// Claims the npm name with a version that contains nothing.
//
// npm's trusted publishing is configured on an existing package: the publisher settings live on the
// package page, so the name has to exist before the workflow that will own every later release can
// be pointed at it. This publishes the smallest thing that can hold the name — a manifest and a
// README saying what it is — under the `placeholder` dist-tag, so `latest` stays unset and nobody
// installs it by accident.
//
// Run once, by hand, with an npm account that may create the package:
//
//     pnpm --filter @slopus/happy-agent-supervisor release:placeholder
//
// Afterwards the package has no releasable version, and `.github/workflows/publish-sandbox.yml`
// publishes every real one over OIDC with no token anywhere.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_VERSION = "0.0.0";
const PLACEHOLDER_TAG = "placeholder";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const stage = mkdtempSync(path.join(tmpdir(), "happy-agent-supervisor-placeholder-"));

try {
    mkdirSync(stage, { recursive: true });
    writeFileSync(
        path.join(stage, "package.json"),
        `${JSON.stringify(
            {
                name: manifest.name,
                version: PLACEHOLDER_VERSION,
                description: `${manifest.description} Placeholder release.`,
                license: manifest.license,
                repository: manifest.repository,
                files: ["README.md"],
                publishConfig: { access: "public", tag: PLACEHOLDER_TAG },
            },
            null,
            2,
        )}\n`,
    );
    writeFileSync(
        path.join(stage, "README.md"),
        [
            `# ${manifest.name}`,
            "",
            `Version ${PLACEHOLDER_VERSION} holds the name and contains no code.`,
            "",
            "It exists so that npm trusted publishing can be configured for this package.",
            "Real releases are published from the `publish-sandbox` GitHub Actions workflow in",
            "[slopus/rig](https://github.com/slopus/rig).",
            "",
        ].join("\n"),
    );

    console.log(`Publishing the ${manifest.name} placeholder as ${PLACEHOLDER_VERSION}...`);
    // npm rather than pnpm, because this is the same publisher the release workflow uses and npm is
    // the only client that speaks npm's OIDC trusted publishing.
    const result = spawnSync("npm", ["publish", "--access", "public", "--tag", PLACEHOLDER_TAG], {
        cwd: stage,
        stdio: "inherit",
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
        throw new Error(`npm publish exited with ${String(result.status)}.`);
    }
    console.log(
        `Published ${manifest.name}@${PLACEHOLDER_VERSION}. Configure the trusted publisher next: ` +
            "npmjs.com → the package → Settings → Trusted publisher → GitHub Actions, " +
            "repository slopus/rig, workflow publish-sandbox.yml, environment npm.",
    );
} finally {
    rmSync(stage, { force: true, recursive: true });
}
