// A credential-free stand-in for a HappyHerd owner and its Codex app-server child.
const { fork } = require('node:child_process');
let backend;
let finishing = false;
const send = (message) => {
  if (process.connected) process.send(message, (error) => { if (error) finish(); });
};
const finish = () => {
  if (finishing) return;
  finishing = true;
  if (!backend || backend.exitCode !== null || backend.signalCode !== null) process.exit(0);
  backend.kill('SIGTERM');
};
// Readiness must never precede these handlers: the parent can signal immediately.
process.on('SIGTERM', () => send({ stopping: true }));
process.on('message', (message) => { if (message === 'finish') finish(); });
process.on('disconnect', finish);
backend = fork(require.resolve('./resume-backend.cjs'), [], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {}, execArgv: [],
});
backend.on('error', (error) => {
  send({ error: error.message });
  process.exit(1);
});
backend.on('exit', (code, signal) => {
  const done = () => process.exit(finishing ? 0 : 1);
  if (process.connected) process.send({ backendExited: true, code, signal }, done);
  else done();
});
send({ backendStarted: true, backendPid: backend.pid });
backend.once('message', () => {
  if (!finishing) send({ ready: true, backendPid: backend.pid });
});
