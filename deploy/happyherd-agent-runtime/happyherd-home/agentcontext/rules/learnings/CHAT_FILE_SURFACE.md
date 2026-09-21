# Chat file surface

Use explicit Markdown when an agent needs to expose a local file, directory, image, or locally hosted page in HappyHerd chat.

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

## Locally hosted pages

After starting and verifying a page's HTTP server on the chat's machine, return
an explicit Markdown link, for example:

`[validation map](http://localhost:8766/validation-map.html)`

Prefer `localhost` for readability; keep the actual scheme, port, path, query,
and fragment. The supported loopback authorities are `localhost`, `127.0.0.1`,
and `[::1]` over HTTP or HTTPS. Do not return only a code-formatted URL or require
copy/paste into the Workspace URL input or laptop port forwarding for this flow.

In a Web chat with an integrated Workspace, clicking the link opens the existing
live page tab on that chat's originating machine. The page and its requests use
the daemon's encrypted machine transport, never the Human browser's localhost.
The server must still be running and the originating machine reachable. A link
cannot select another session or machine. Ordinary non-loopback web links remain
external; native and contexts without the integrated host retain their existing
external-link behavior. This does not change the scriptless Preview for local
HTML file links.

## Inline images

Write `![alt](relative/path.png)`. Inline image destinations must be relative and remain inside the originating session root. Supported extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`, and `ico`.

Absolute paths, `~/`, `../`, and `data:` image targets are rejected before any machine read.

## Forms that do not open the file viewer

- `file://` is rejected by the URL-scheme guard.
- A bare prose path is not linked.
- A path inside backticks is inline code, not a link.
- Non-loopback `http://` and `https://` open the external browser; hosted loopback pages use the Web Workspace flow above.

A click opens the integrated Workspace when the active chat can host it. Cross-session links, or contexts without the integrated host, use the standalone Workspace link viewer. The originating machine must be online so HappyHerd can read the target over its existing machine transport.
