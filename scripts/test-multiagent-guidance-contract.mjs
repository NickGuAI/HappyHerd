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
  rootGuidance.includes('Delegated Worker Agents must be launched through'),
  'AGENTS.md must reserve delegated Worker creation for the briefed happyherd command',
);

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
assert(!appOps.includes('spawnSideChat'), 'the app must not expose an unbriefed side-chat helper');
assert(!appOps.includes('isSideChat?: boolean'), 'generic app spawn options must not accept isSideChat');
assert(
  !read('server/packages/happy-app/sources/-session/SessionView.tsx').includes('spawnSideChat'),
  'SessionView must remain presentation-only for side chats',
);
const machineApi = read('server/packages/happy-cli/src/api/apiMachine.ts');
assert(
  machineApi.includes('if (isSideChat === true)')
    && machineApi.includes('happyherd session side-chat create'),
  'generic spawn-happy-session must reject side-chat creation before provider launch',
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
