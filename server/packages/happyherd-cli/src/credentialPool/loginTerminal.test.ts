import { describe, expect, it } from 'vitest';

import fixture from './fixtures/claudeSetupToken.json';
import { LoginTerminal, LOGIN_TERMINAL_SIZE } from './loginTerminal';

describe('Claude login terminal', () => {
  it('reads the complete link and invalid-code screen from native cursor updates', async () => {
    const terminal = new LoginTerminal();
    try {
      // Split every escape sequence and UTF-8 character across writes.
      for (const byte of Buffer.from(fixture.prompt)) void terminal.write(Uint8Array.of(byte));
      expect((await terminal.read()).split('\n').map((line) => line.trim())).toContain(fixture.url);
      for (const byte of Buffer.from(fixture.invalidCode)) void terminal.write(Uint8Array.of(byte));
      const screen = await terminal.read();
      expect(screen.split('\n').map((line) => line.trim())).toContain(
        'OAuth error: Invalid code. Please make sure the full code was copied',
      );
      expect(screen).not.toContain(fixture.url);
    } finally {
      await terminal.dispose();
    }
  });

  it('retains a token in scrollback and joins soft-wrapped lines after queued writes', async () => {
    const terminal = new LoginTerminal();
    const token = `sk-ant-oat01-${'FIXTURE'.repeat(600)}`;
    try {
      void terminal.write(`${token}\r\n`);
      for (let row = 0; row < LOGIN_TERMINAL_SIZE.rows + 3; row++) {
        void terminal.write(`line ${row}\r\n`);
      }
      expect(await terminal.read()).toContain(`${token}\nline 0`);
    } finally {
      await terminal.dispose();
    }
  });

  it('does not retain token text erased from the screen', async () => {
    const terminal = new LoginTerminal();
    try {
      void terminal.write('sk-ant-oat01-FIXTURE\r\u001b[2KNo token returned');
      const screen = await terminal.read();
      expect(screen).toContain('No token returned');
      expect(screen).not.toContain('sk-ant-');
    } finally {
      await terminal.dispose();
    }
  });
});
