import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
const [mode, first, second, target] = process.argv.slice(2);
if (mode === 'build') {
  const version = (path) => JSON.parse(readFileSync(path, 'utf8')).version;
  // Informational provenance only; the installer does not enforce this data.
  const info = {
    revision: execFileSync('git', ['-C', first, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    target,
    cliVersion: version(join(second, 'package.json')),
    serverVersion: version(join(second, 'node_modules/happyherd-server-self-host/package.json')),
    nodeVersion: process.version,
  };
  writeFileSync(join(second, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
} else if (mode === 'notes') {
  const repository = 'https://github.com/NickGuAI/HappyHerd';
  const rows = targets.map((platform) => {
    const asset = `happyherd-${platform}.tar.gz`;
    const info = JSON.parse(execFileSync('tar', ['-xOf', join(second, asset), 'happyherd/runtime/build-info.json'], { encoding: 'utf8' }));
    return `| [${platform}](${repository}/releases/download/${first}/${asset}) | [\`${info.revision}\`](${repository}/tree/${info.revision}) | ${info.cliVersion} | ${info.serverVersion} | ${info.nodeVersion} |`;
  });
  console.log(`## Installer release: \`${first}\`

These archives contain the HappyHerd CLI, self-host server, bundled Web app,
platform tools, and Node runtime. The installer release tag and bundled package
versions are separate identities. The following values come from each archive.

| Download | Built source revision | Bundled CLI | Server | Node |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

Install on supported macOS/Linux arm64/x64 machines:

\`\`\`sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh -s -- --version ${first.replace(/^happyherd-v/, '')}
\`\`\`

The default README command selects the latest stable release; a prerelease must
be selected explicitly. Use the bundled Web client with your own server.
HappyHerd macOS GUI, iOS, Android, Windows installer, and npm channels are not distributed by this workflow.
Native source builds and CI artifacts are not public app downloads.

Archive build/install verification does not establish the real-account first-task
journey. Release-specific onboarding evidence belongs to [#378](${repository}/issues/378);
native distribution and journey dependencies remain [#369](${repository}/issues/369)
and [#375](${repository}/issues/375).
`);
} else {
  throw new Error('usage: native-release-info.mjs build SOURCE RUNTIME TARGET | notes TAG ASSET_DIRECTORY');
}
