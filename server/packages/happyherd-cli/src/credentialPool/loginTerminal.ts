import xterm from '@xterm/headless';

export const LOGIN_TERMINAL_SIZE = { cols: 4_096, rows: 24 };

/** Reads the screen Claude paints, including cells omitted by incremental redraws. */
export class LoginTerminal {
  private readonly terminal = new xterm.Terminal({
    ...LOGIN_TERMINAL_SIZE,
    allowProposedApi: true,
    scrollback: 32,
  });
  private pending: Promise<void> = Promise.resolve();

  write(chunk: string | Uint8Array): Promise<void> {
    this.pending = new Promise((resolve) => this.terminal.write(chunk, resolve));
    return this.pending;
  }

  async read(): Promise<string> {
    // Writes are queued by xterm. Include anything queued while we were waiting,
    // especially the final output immediately followed by process close.
    let pending: Promise<void>;
    do {
      pending = this.pending;
      await pending;
    } while (pending !== this.pending);
    const buffer = this.terminal.buffer.active;
    let text = '';
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row)!;
      if (row > 0 && !line.isWrapped) text += '\n';
      text += line.translateToString(!buffer.getLine(row + 1)?.isWrapped);
    }
    return text;
  }

  async dispose(): Promise<void> {
    await this.pending;
    this.terminal.dispose();
  }
}
