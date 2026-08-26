import type { MarkdownBlock, MarkdownSpan } from "./parseMarkdown";
import { parseMarkdownSpans } from "./parseMarkdownSpans";
import { isHttpMarkdownLink, isWorkspaceRelativeMarkdownLink } from "./linkUtils";

// Split a pipe-delimited table row into cells, stripping only the leading/trailing
// empty strings caused by outer pipes while preserving interior empty cells.
function splitTableRow(line: string): string[] {
    let cells = line.trim().split('|').map(cell => cell.trim());
    if (cells.length > 0 && cells[0] === '') cells = cells.slice(1);
    if (cells.length > 0 && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
    return cells;
}

function parseTable(lines: string[], startIndex: number): { table: MarkdownBlock | null; nextIndex: number } {
    let index = startIndex;
    const tableLines: string[] = [];

    // Collect consecutive lines that contain pipe characters, skipping blank lines
    // that LLMs often insert between table rows
    while (index < lines.length) {
        if (lines[index].includes('|')) {
            tableLines.push(lines[index]);
            index++;
        } else if (lines[index].trim() === '') {
            index++;
        } else {
            break;
        }
    }

    if (tableLines.length < 2) {
        return { table: null, nextIndex: startIndex };
    }

    // Validate that the second line is a separator containing dashes, which distinguishes tables from plain text
    const separatorLine = tableLines[1].trim();
    const isSeparator = /^[|\s\-:=]*$/.test(separatorLine) && separatorLine.includes('-');

    if (!isSeparator) {
        return { table: null, nextIndex: startIndex };
    }

    const headers = splitTableRow(tableLines[0])
        .map(cell => parseMarkdownSpans(cell, false));

    if (headers.length === 0) {
        return { table: null, nextIndex: startIndex };
    }

    // Extract data rows from remaining lines (skipping the separator line)
    const rows: MarkdownSpan[][][] = [];
    for (let i = 2; i < tableLines.length; i++) {
        const rowCells = splitTableRow(tableLines[i])
            .map(cell => parseMarkdownSpans(cell, false));
        if (rowCells.length > 0) {
            rows.push(rowCells);
        }
    }

    const table: MarkdownBlock = {
        type: 'table',
        headers,
        rows
    };

    return { table, nextIndex: index };
}

export function parseMarkdownBlock(markdown: string) {
    const blocks: MarkdownBlock[] = [];
    const lines = markdown.split('\n');
    let index = 0;
    outer: while (index < lines.length) {
        const line = lines[index];
        index++;

        // Headers
        for (let i = 1; i <= 6; i++) {
            if (line.startsWith(`${'#'.repeat(i)} `)) {
                blocks.push({ type: 'header', level: i as 1 | 2 | 3 | 4 | 5 | 6, content: parseMarkdownSpans(line.slice(i + 1).trim(), true) });
                continue outer;
            }
        }

        // Trim
        let trimmed = line.trim();

        // Code block
        if (trimmed.startsWith('```')) {
            const language = trimmed.slice(3).trim() || null;
            let content = [];
            while (index < lines.length) {
                const nextLine = lines[index];
                if (nextLine.trim() === '```') {
                    index++;
                    break;
                }
                content.push(nextLine);
                index++;
            }
            const contentString = content.join('\n');

            // Detect mermaid diagram language and route to appropriate block type
            if (language === 'mermaid') {
                blocks.push({ type: 'mermaid', content: contentString });
            } else {
                blocks.push({ type: 'code-block', language, content: contentString });
            }
            continue;
        }

        // Horizontal rule
        if (trimmed === '---') {
            blocks.push({ type: 'horizontal-rule' });
            continue;
        }

        // Options block
        if (trimmed.startsWith('<options>')) {
            let items: string[] = [];
            while (index < lines.length) {
                const nextLine = lines[index];
                if (nextLine.trim() === '</options>') {
                    index++;
                    break;
                }
                // Extract content from <option> tags
                const optionMatch = nextLine.match(/<option>(.*?)<\/option>/);
                if (optionMatch) {
                    items.push(optionMatch[1]);
                }
                index++;
            }
            if (items.length > 0) {
                blocks.push({ type: 'options', items });
            }
            continue;
        }

        // Image block. Remote images keep their existing HTTP(S) path. Relative
        // targets are resolved later from the originating session provenance;
        // schemes and absolute paths remain inert Markdown text.
        const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imageMatch) {
            const url = imageMatch[2].trim();
            if (isHttpMarkdownLink(url)) {
                blocks.push({ type: 'image', alt: imageMatch[1], url });
            } else if (isWorkspaceRelativeMarkdownLink(url)) {
                blocks.push({
                    type: 'workspace-image',
                    alt: imageMatch[1],
                    url,
                    fallback: [{ styles: [], text: trimmed, url: null }],
                });
            } else {
                blocks.push({ type: 'text', content: [{ styles: [], text: trimmed, url: null }] });
            }
            continue;
        }

        // Block quotes. Consecutive quote lines are one semantic block so
        // streaming replies do not produce a separate border for every line.
        if (/^>\s?/.test(trimmed)) {
            const quotedLines = [trimmed.replace(/^>\s?/, '')];
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
                quotedLines.push(lines[index].trim().replace(/^>\s?/, ''));
                index++;
            }
            blocks.push({ type: 'quote', content: parseMarkdownSpans(quotedLines.join('\n'), false) });
            continue;
        }

        // GFM task lists must be recognized before ordinary bullet lists.
        const taskListMatch = trimmed.match(/^([-*+])\s+\[([ xX])\]\s+(.*)$/);
        if (taskListMatch) {
            const indent = line.length - line.trimStart().length;
            const allLines = [{
                checked: taskListMatch[2].toLowerCase() === 'x',
                indent,
                content: taskListMatch[3],
            }];
            while (index < lines.length) {
                const nextRaw = lines[index];
                const nextTrimmed = nextRaw.trim();
                const nextMatch = nextTrimmed.match(/^([-*+])\s+\[([ xX])\]\s+(.*)$/);
                if (!nextMatch) break;
                allLines.push({
                    checked: nextMatch[2].toLowerCase() === 'x',
                    indent: nextRaw.length - nextRaw.trimStart().length,
                    content: nextMatch[3],
                });
                index++;
            }
            const baseIndent = allLines[0].indent;
            blocks.push({
                type: 'task-list',
                items: allLines.map((item) => ({
                    checked: item.checked,
                    depth: Math.floor((item.indent - baseIndent) / 2),
                    spans: parseMarkdownSpans(item.content, false),
                })),
            });
            continue;
        }

        // If it is a numbered list
        const numberedListMatch = trimmed.match(/^(\d+)\.\s+/);
        if (numberedListMatch) {
            const indent = line.length - line.trimStart().length;
            let allLines = [{ number: parseInt(numberedListMatch[1]), indent, content: trimmed.slice(numberedListMatch[0].length) }];
            while (index < lines.length) {
                const nextRaw = lines[index];
                const nextTrimmed = nextRaw.trim();
                const nextMatch = nextTrimmed.match(/^(\d+)\.\s+/);
                if (!nextMatch) break;
                const nextIndent = nextRaw.length - nextRaw.trimStart().length;
                allLines.push({ number: parseInt(nextMatch[1]), indent: nextIndent, content: nextTrimmed.slice(nextMatch[0].length) });
                index++;
            }
            const baseIndent = allLines[0].indent;
            blocks.push({ type: 'numbered-list', items: allLines.map((l) => ({ number: l.number, depth: Math.floor((l.indent - baseIndent) / 2), spans: parseMarkdownSpans(l.content, false) })) });
            continue;
        }

        // If it is a list
        const listMatch = trimmed.match(/^([-*+])\s+/);
        if (listMatch) {
            const indent = line.length - line.trimStart().length;
            let allLines = [{ indent, content: trimmed.slice(listMatch[0].length) }];
            while (index < lines.length) {
                const nextRaw = lines[index];
                const nextTrimmed = nextRaw.trim();
                const nextMatch = nextTrimmed.match(/^([-*+])\s+/);
                if (!nextMatch) break;
                const nextIndent = nextRaw.length - nextRaw.trimStart().length;
                allLines.push({ indent: nextIndent, content: nextTrimmed.slice(nextMatch[0].length) });
                index++;
            }
            const baseIndent = allLines[0].indent;
            blocks.push({ type: 'list', items: allLines.map((l) => ({ depth: Math.floor((l.indent - baseIndent) / 2), spans: parseMarkdownSpans(l.content, false) })) });
            continue;
        }

        // Check for table
        if (trimmed.includes('|') && !trimmed.startsWith('```')) {
            const { table, nextIndex } = parseTable(lines, index - 1);
            if (table) {
                blocks.push(table);
                index = nextIndex;
                continue outer;
            }
        }

        // Fallback
        if (trimmed.length > 0) {
            blocks.push({ type: 'text', content: parseMarkdownSpans(trimmed, false) });
        }
    }
    return blocks;
}
