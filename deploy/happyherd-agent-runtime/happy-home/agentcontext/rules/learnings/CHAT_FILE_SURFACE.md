# Chat file surface

Use explicit Markdown when an agent needs to expose a local file, directory, or image in HappyHerd chat.

## Clickable files and directories

- Write `[label](relative/or/absolute/path)`.
- Add `:LINE` or `:LINE:COL` to open a specific position.
- Percent-encode spaces in the destination, or wrap the destination in angle brackets.
- Directories are valid targets.
- Relative links in a viewed Markdown file resolve from that file's directory.

Examples:

- `[notes](docs/notes.md)`
- `[parser](src/parser.ts:42:7)`
- `[my report](<reports/My Report.md>)`
- `[designs](designs/)`

A file link selects only a path. The rendering host supplies immutable session and machine provenance; link text cannot replace either value.

## Inline images

Write `![alt](relative/path.png)`. Inline image destinations must be relative and remain inside the originating session root. Supported extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`, and `ico`.

Absolute paths, `~/`, `../`, and `data:` image targets are rejected before any machine read.

## Forms that do not open the file viewer

- `file://` is rejected by the URL-scheme guard.
- A bare prose path is not linked.
- A path inside backticks is inline code, not a link.
- `http://` and `https://` open the external browser.

A click opens the integrated Workspace when the active chat can host it. Cross-session links, or contexts without the integrated host, use the standalone Workspace link viewer. The originating machine must be online so HappyHerd can read the target over its existing machine transport.
