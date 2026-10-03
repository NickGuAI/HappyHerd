import {
    createGhosttyTerminal,
    type GhosttyColor,
    type GhosttySnapshot as WasmGhosttySnapshot,
    type GhosttyTerminal,
} from "@slopus/ghostty-wasm/node";
import type { GhosttySnapshot, GhosttyTerminalLike } from "@slopus/ghostty-web";

import type { TerminalColorScheme } from "../Terminal.js";

/**
 * The canonical emulator: the one authoritative screen a terminal has.
 *
 * Every attachment is a replica of this, not a picture of it. The protocol keeps the two in step by
 * replaying the same ordered bytes into the same emulator on the other side, so the only thing this
 * class has to be is the server's half of that pair.
 */
export class GhosttyTerminalState implements GhosttyTerminalLike {
    readonly #terminal: GhosttyTerminal;

    private constructor(terminal: GhosttyTerminal) {
        this.#terminal = terminal;
    }

    static async create(options: {
        readonly cols: number;
        readonly colorScheme: TerminalColorScheme;
        readonly maxScrollback: number;
        readonly rows: number;
    }): Promise<GhosttyTerminalState> {
        return new GhosttyTerminalState(await createGhosttyTerminal(options));
    }

    close(): void {
        this.#terminal.dispose();
    }

    /** Bumped by anything that shifts history, so a stale scrollback basis is refused. */
    historyRevision(): number {
        return this.#terminal.snapshot().outputRevision;
    }

    onPtyWrite(handler: (data: string) => void): () => void {
        return this.#terminal.onPtyWrite((data) => handler(Buffer.from(data).toString("utf8")));
    }

    resize(cols: number, rows: number): void {
        this.#terminal.resize(cols, rows);
    }

    snapshot(): GhosttySnapshot {
        return adaptSnapshot(this.#terminal.snapshot());
    }

    snapshotPage(start: number, count: number): GhosttySnapshot {
        return adaptSnapshot(this.#terminal.snapshotPage(start, count));
    }

    writeBytes(data: Uint8Array): void {
        this.#terminal.write(data);
    }
}

function adaptSnapshot(snapshot: WasmGhosttySnapshot): GhosttySnapshot {
    return {
        cells: snapshot.rows.flatMap((row, y) =>
            row.cells.map((cell) => ({
                background: cell.style.background ?? snapshot.defaultBackground,
                blink: cell.style.blink,
                bold: cell.style.bold,
                dim: cell.style.dim,
                foreground: cell.style.foreground ?? snapshot.defaultForeground,
                hyperlink: cell.hyperlink,
                invisible: cell.style.invisible,
                inverse: cell.style.inverse,
                italic: cell.style.italic,
                overline: cell.style.overline,
                strikethrough: cell.style.strikethrough,
                text: cell.text,
                underline: cell.style.underline,
                underlineColor: cell.style.underlineColor,
                width: cell.width,
                x: cell.x,
                y,
            })),
        ),
        cursor: snapshot.cursor ?? { visible: false, x: 0, y: 0 },
        palette: snapshot.palette.map(colorToCss),
        rows: snapshot.rows.map(rowText),
        scroll: {
            offset: snapshot.startRow,
            totalRows: snapshot.totalRows,
            visibleRows: snapshot.visibleRows,
        },
        title: snapshot.title,
        wrappedRows: snapshot.rows.map((row) => row.wrapped),
    };
}

function colorToCss(color: GhosttyColor): string {
    if (color.kind === "palette") return `palette:${color.index}`;
    return `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`;
}

function hex(value: number): string {
    return value.toString(16).padStart(2, "0");
}

/** One row as plain text, bounded by the widest column an emulator row can reach. */
function rowText(row: WasmGhosttySnapshot["rows"][number]): string {
    const cells = Array.from({ length: 1_000 }, () => " ");
    let width = 0;
    for (const cell of row.cells) {
        cells[cell.x] = cell.text;
        width = Math.max(width, cell.x + cell.width);
    }
    return cells.slice(0, width).join("").trimEnd();
}
