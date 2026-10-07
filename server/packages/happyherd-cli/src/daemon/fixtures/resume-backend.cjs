// IPC owns this fixture's lifetime even if the owner fails before normal cleanup.
process.on('disconnect', () => process.exit(0));
process.send({ ready: true });
setInterval(() => {}, 1000);
