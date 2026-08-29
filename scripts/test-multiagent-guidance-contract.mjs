#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const rootGuidance = read('AGENTS.md');
for (const term of [
  'Human',
  'Main Agent',
  'Orchestrating Agent',
  'Worker Agent',
  'Provider-native subagent',
  'HappyHerd side chat',
]) {
  assert(rootGuidance.includes(term), `AGENTS.md must define ${term}`);
}
assert(
  rootGuidance.includes('default mechanism for bounded parallel work'),
  'AGENTS.md must make provider-native subagents the bounded fan-out default',
);
assert(
  rootGuidance.includes('explicitly creates every delegated task'),
  'AGENTS.md must assign explicit task creation to the Orchestrating Agent',
);
assert(
  /The Human launches a side chat/.test(rootGuidance)
    && /The\s+Main Agent launches a delegated Worker Agent/.test(rootGuidance),
  'AGENTS.md must preserve both Human app and Main Agent CLI creation surfaces',
);

for (const path of [
  'AGENTS.md',
  '.dev/VERIFY.md',
  '.dev/COUPLINGS.md',
  '.dev/playbooks/side-chat-lifecycle.md',
  'server/packages/happyherd-cli/README.md',
]) {
  const content = read(path);
  const normalized = content.replace(/\s+/g, ' ');
  assert.match(normalized, /\bHuman\b/, `${path} must name the Human creation surface`);
  assert.match(normalized, /\bMain Agent\b/, `${path} must name the Main Agent creation surface`);
  assert.match(normalized, /\bone[- ]click\b/i, `${path} must preserve one-click Human creation`);
  assert.match(normalized, /\bno fields\b/i, `${path} must preserve zero-field Human creation`);
  assert.match(normalized, /\bsix(?:-field| non-empty| brief)/i, `${path} must preserve the six-field Main Agent brief`);
  assert(
    content.includes('happyherd-side-chat-create'),
    `${path} must preserve the dedicated Human side-chat RPC`,
  );
  assert.match(normalized, /normal composer/i, `${path} must preserve the empty child's normal composer`);
}

const playbook = read('.dev/playbooks/side-chat-lifecycle.md');
for (const option of [
  '--outcome',
  '--scope',
  '--dependencies',
  '--write-ownership',
  '--verification',
  '--handoff',
]) {
  assert(playbook.includes(option), `side-chat playbook must require ${option}`);
}
for (const lifecycle of ['list', 'status', 'stop', 'close', 'reopen']) {
  assert(
    playbook.includes(`happyherd session side-chat ${lifecycle}`),
    `side-chat playbook must document ${lifecycle} through happyherd`,
  );
}
for (const alias of ['inspect', 'pause', 'resume']) {
  assert(
    playbook.includes(`happyherd session side-chat ${alias}`),
    `side-chat playbook must document the ${alias} lifecycle alias`,
  );
}

const appOps = read('server/packages/happy-app/sources/sync/ops.ts');
assert(!appOps.includes('spawnSideChat'), 'the app must not expose a generic side-chat spawn helper');
assert(!appOps.includes('isSideChat?: boolean'), 'generic app spawn options must not accept isSideChat');
const machineCreateSideChatStart = appOps.indexOf('export async function machineCreateSideChat');
const machineCreateSideChatEnd = appOps.indexOf('\nexport async function', machineCreateSideChatStart + 1);
const machineCreateSideChat = appOps.slice(
  machineCreateSideChatStart,
  machineCreateSideChatEnd === -1 ? undefined : machineCreateSideChatEnd,
);
assert(
  machineCreateSideChat.includes("'happyherd-side-chat-create', { parentSessionId }")
    && !machineCreateSideChat.includes('brief'),
  'the Human app must send only parentSessionId through the dedicated side-chat RPC',
);
const machineApi = read('server/packages/happy-cli/src/api/apiMachine.ts');
assert(
  machineApi.includes('if (isSideChat === true)')
    && machineApi.includes('happyherd session side-chat create'),
  'generic spawn-happy-session must reject side-chat creation before provider launch',
);
assert(
  machineApi.includes('params?.brief === undefined || params.brief === null')
    && machineApi.includes('normalizeSideChatDelegationBrief'),
  'the dedicated RPC must accept an omitted Human brief and validate any supplied Main Agent brief',
);

const sideChatCommand = read('server/packages/happy-cli/src/commands/sideChat.ts');
for (const option of [
  '--outcome',
  '--scope',
  '--dependencies',
  '--write-ownership',
  '--verification',
  '--handoff',
]) {
  assert(sideChatCommand.includes(option), `Main Agent side-chat creation must require ${option}`);
}
assert(
  sideChatCommand.includes('brief: normalizeSideChatDelegationBrief(briefValues)'),
  'the Main Agent CLI must normalize and require its complete brief',
);

const sideChatLifecycle = read('server/packages/happy-cli/src/daemon/sideChatLifecycle.ts');
assert(
  sideChatLifecycle.includes("if (result === null) return phase('deliver-brief', 'skipped')"),
  'Human side-chat creation must record deliver-brief as skipped',
);
const daemonRun = read('server/packages/happy-cli/src/daemon/run.ts');
assert(
  daemonRun.includes('if (brief === null)')
    && daemonRun.includes('return { ...created, briefDelivery: null }')
    && daemonRun.includes('api.postSideChatBrief'),
  'the daemon must skip Human brief delivery and retain Main Agent brief delivery',
);

const canonicalCommandFiles = [
  'server/packages/happy-cli/src/commands/sideChat.ts',
  'server/packages/happy-cli/README.md',
  'server/packages/happyherd-cli/README.md',
  '.dev/COUPLINGS.md',
  '.dev/SOP_INDEX.md',
  '.dev/playbooks/side-chat-lifecycle.md',
];
for (const path of canonicalCommandFiles) {
  const content = read(path);
  assert(
    content.includes('happyherd session side-chat'),
    `${path} must use the canonical happyherd side-chat command`,
  );
  assert(
    !content.includes('happy session side-chat'),
    `${path} must not advertise the retired side-chat command surface`,
  );
}

for (const path of [
  'deploy/happyherd-agent-runtime/happy-home/AGENTS.md',
  'deploy/happyherd-agent-runtime/workspace/AGENTS.md',
  'examples/pmai-happyherd-agent/happy-home/AGENTS.md',
  'examples/pmai-happyherd-agent/workspace/AGENTS.md',
]) {
  const content = read(path);
  assert(content.includes('provider-native subagents'), `${path} must use the canonical subagent term`);
  assert(!content.includes('built-in Codex subagents'), `${path} must not retain the provider-specific term`);
}

for (const path of [
  'deploy/happyherd-agent-runtime/happy-home/agentcontext/USER.md',
  'examples/pmai-happyherd-agent/happy-home/agentcontext/USER.md',
]) {
  assert(read(path).includes('The Human is'), `${path} must name the person as Human`);
}

process.stdout.write('multiagent-guidance-contract: ok\n');
