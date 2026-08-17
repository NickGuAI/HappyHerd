# August 17 — Install, connect, and verify HappyHerd locally

HappyHerd now ships a generic end-user launcher and traceable installers for macOS, Windows, and Linux.

- `happyherd doctor` verifies the installed runtime, supported platform, Node.js, and operating-system secret-store adapter.
- `happyherd connect <issuer>` discovers an organization through a standard well-known document and completes a ten-minute, one-time browser approval with PKCE and device proof.
- Long-lived organization credentials stay in Keychain, Credential Manager, or Secret Service; there is no plaintext fallback and credentials never enter agent prompts or URLs.
- `happyherd install-skills` verifies the ZIP, raw manifest, declared file inventory, minimum version, and canonical content digest before atomically publishing a generic bundle.
- Verified Skills appear in both local Claude and Codex discovery roots through owned receipts; HappyHerd refuses collisions with user-managed Skills and blocks launch if a managed copy becomes stale.
- `happyherd run-tool` re-verifies a manifest-declared script and supplies the issuer credential only to that child as `HAPPYHERD_ACCESS_TOKEN`, never to the agent session, arguments, registry, or receipts.
- `happyherd launch claude` and `happyherd launch codex` use the bundled maintained Happy runtime.
- Bundled Node.js and Python runtimes keep installation independent of host-language runtimes, while pinned offline installation accepts only an explicit local manifest and matching platform asset.
- macOS installation and removal verify hidden service identities through structured Directory Service records, including paths and ownership markers that contain spaces.
- Per-owner broker capabilities, isolated tool identities, bounded output, operation locks, provider-tree integrity checks, and detached-child containment keep organization access outside agent prompts and unrelated user sessions.
- `happyherd upgrade` checks a source-traceable release manifest and reports the verified platform installer without replacing a running session.
- Tagged `happyherd-v*` releases publish five native-platform assets, two installers, `SHA256SUMS`, and a manifest tied to the exact Git source SHA; SemVer prereleases are explicitly marked as prereleases instead of stable/latest releases.

# August 16 — Governed agents without organization lock-in

HappyHerd now provides a manifest-driven Discord agent runtime that any organization can configure without adding its identity or provider routes to generic core code.

- Claude, Codex, Automation, and governed-agent sessions now default to maximum available reasoning effort across the app, CLI, and deployment profiles.
- Ordinary and governed Codex sessions can delegate proactively; governed child agents inherit the exact same read-only sandbox and manifest-only tool boundary.
- Commander sessions automatically receive the selected `COMMANDER.md`, bounded L2 working memory, bounded L3 long-term memory, and nearest project guidance; L1 evidence remains on demand.
- `/goal OBJECTIVE` now sets the Codex goal and immediately starts one normal turn for that objective, while `/goal clear` remains state-only.
- Automation sessions are one-shot: they close only after authoritative provider and goal completion, preserve exact run provenance across daemon handoff, and automatically recycle after verified completion, failure, or timeout without touching ordinary sessions.
- Daemon upgrades now preserve independent provider processes, rebuild only transient live registration, accept provider re-registration, and verify the exact release SHA before readiness.
- `happy --version` is a pure query with immutable release identity, and unit tests no longer inherit Commander, reconnect, automation, or session state from the invoking shell.
- Each deployment declares its own named tools, operation paths, scopes, shared-read policy, and write behavior in a validated manifest.
- Every Discord surface maps to an encrypted HappyHerd Codex session carrying only an actor-bound capability and the declared tool descriptions.
- Personal reads and confirmed writes stay in DM; guild conversations remain mention-gated and read-only.
- Shell, filesystem mutation, arbitrary web access, undeclared connectors, and missing or expired authorization fail closed.
- Dedicated bridge and agent service accounts keep Discord, service, HappyHerd, and Codex credentials separate from operator runtimes.
- A first-time member can now send an exact one-time `link CODE` command in the bot DM; the runtime verifies it through the organization service without creating an agent session or retaining the code.
- Organization authorization signatures now bind the configured agent ID together with the timestamp, replay nonce, and exact request-body hash.
- Public-boundary verification now rejects embedded personal paths, private infrastructure, secret material, and organization-specific logic outside named examples.

# August 15 — Focused automations and memory observation

Automations stay in their own workflow, while historical observation remains bounded and reviewable.

- Unmanaged files outside HappyHerd's automation namespace no longer produce a legacy-system warning.
- Automation listing remains confined to native manifests without scanning or claiming unrelated definitions.
- Automation-created sessions stay out of Home and Web Recent even when only part of their provenance is available; open successful runs from Automation History instead.
- A bounded Observer can review up to 14 local days of Claude and Codex conversations and append L1 evidence to each owning Commander without distilling higher memory tiers.

# August 13 — Guided Commander onboarding

Create a Commander through a normal, visible HappyHerd session instead of assembling its files by hand.

- The Command Palette and the touch-accessible Commander picker on Web start the same localized onboarding session on the selected machine.
- The main agent interviews one question at a time, shows a confirmation summary, and authors the exact identity, memory, and learning content.
- A host-local `happy commander create --manifest <file>` command validates containment and identity, rejects collisions, and atomically publishes the canonical Commander tree.
- The filesystem remains the only Commander registry, so the new identity appears in New Session without a daemon restart or central CRUD service.

# August 13 — Upload into real workspaces

Files can now move from the phone or browser directly into a connected machine workspace.

- Machine Workspace uploads multiple files into the directory you are currently browsing without overwriting existing files.
- New Session can upload and attach workspace files before the agent starts; current sessions reuse the same Workspace attachment flow.
- Every batch reports per-file progress, can be cancelled after the current atomic host write, and retries only the unfinished files without reopening the picker.
- Text files can be included directly as message context, while images, PDFs, and other binary files stay at their exact host path for Claude Code or Codex to inspect with native file tools.
- Upload publication is atomic, byte-exact, size-bounded, and shared by every interface instead of introducing another file store.

# August 13 — Live conversation catch-up

Returning to a conversation now catches up without a manual browser refresh.

- Visible sessions reconcile immediately when the browser regains network access.
- Readers who are reviewing older messages keep their scroll position and see a new-message count instead of being pulled away.
- “Jump to latest” returns to the live edge in one action on mobile and desktop.

# August 11 — Full access follows through

Codex full-access sessions can now complete policy-gated commands without stopping for an approval they cannot display.

- Explicit `full access` / `yolo` sessions keep Codex's approval request channel open.
- HappyHerd automatically accepts those requests through its existing host approval bridge, so external actions authorized by full access can run.
- Read-only, workspace-sandboxed, and ask-first modes keep their existing permission boundaries.

# August 10 — Consistent sidebar actions

Machine Workspace and Automations now use the same compact sidebar control as New Session.

- Primary sidebar destinations share one width, height, spacing, typography, and pressed state.
- Navigation controls no longer stretch vertically when the session list is short or empty.

# August 10 — Lean runtime state

HappyHerd's persistent home now contains durable user state instead of disposable provider transport files.

- `agentcontext/` and `commanders/` remain the canonical AgentContext stores.
- Generated Commander prompt bundles use the operating system's temporary directory and are removed after delivery.
- Claude hook settings also use isolated operating-system temporary directories with automatic cleanup.
- Codex's image cache remains available for local-image inputs and thread-history previews.

# August 10 — Compact automation cards

Automation lists stay scannable while full controls remain one tap away.

- Automation cards now default to a compact name-and-status summary.
- Open any card to inspect its schedule, type, instruction, provider, workspace, actions, and run history.
- Each card expands independently with accessible controls across mobile, desktop, light, and dark themes.

# August 10 — Flexible machine setup

Machines can come online with the providers they actually have, while Commander instructions stay synchronized automatically.

- The host daemon no longer requires both Claude Code and Codex to be installed before a machine can connect.
- Missing providers stay unavailable for new sessions instead of blocking the whole machine.
- Commander sessions repair a stale or misdirected `CLAUDE.md` mirror from the canonical `AGENTS.md` automatically.
- Encryption, machine identity, path containment, and context-bundle integrity checks are unchanged.

# August 9 — HappyHerd dogfood foundation

HappyHerd's owned product features are now recorded alongside the Happy updates we inherit.

- Create or restore a self-hosted account with one visible, reusable account key.
- Browse host-machine workspaces, preview images, PDFs, HTML, and Markdown, edit supported files, and attach workspace files to a session.
- Use Claude Code and Codex subscriptions with canonical model choices, remembered effort, native steering, explicit queued messages, and provider-native resume.
- Choose a Commander identity when starting a session; canonical `AGENTS.md` instructions and visible heartbeat or scheduled automations follow that identity.
- Start sessions with text, images, or gated OpenAI voice dictation from the same composer capabilities used in chat.
- Returning tabs and reconnected clients reconcile new conversation messages automatically; subagent activity is grouped and collapsed by default.
- English, Simplified Chinese, and German UI catalogs are checked against a generated route, panel, modal, state, and accessibility inventory.
- HappyHerd support links, reproducible releases, rollback contracts, and detached host-daemon lifecycle are maintained independently from upstream Happy.

# August 9 — Rich agent replies

Agent and subagent replies now render safe Markdown and responsive images.

- Main-agent and subagent replies share the same Markdown renderer.
- Headings, lists, block quotes, code, tables, links, task lists, and strikethrough render in chat.
- HTTP(S) images render responsively with alt text, lazy loading, failure feedback, and full-size preview.
- Unsafe image schemes fail closed; existing attachment and file-viewer behavior is unchanged.

# August 7 — Gemini 3.6 Flash, Rig sessions

A new Gemini model, Rig as a first-class agent, and web scrolling fixes.

- Gemini 3.6 Flash in the Antigravity model picker — High, Medium, and Low effort.
- Start and manage native Rig sessions from Happy — connected Rig machines offer their models, permission modes, and effort levels right in the composer.
- New sessions no longer launch with a stale agent after switching machines.
- On web, wide tables and code blocks in chat scroll sideways with the trackpad.
- Community Credits: [@abhisheksoni27](https://github.com/abhisheksoni27), [@charliezong18](https://github.com/charliezong18)

# August 3 — Composer and tool calls

Shorter tool output and a composer that behaves again.

- Tool calls show as one-line rows you can open for details — turn it off with Compact Tool Calls in Settings → Appearance.
- The mic is back in the send button — voice when the composer is empty, send once you've typed, stop while the agent works.
- Model and effort sit together next to the send button, and no longer get cut off when you switch.
- Model, effort, and permission pickers are legible again on iOS 26.
- The send button is visible again on the light theme.
- Composer pickers stay tappable while the keyboard is open.

# July 28 — Liquid glass, Opus 5

A full mobile refresh and a new top model.

- Liquid-glass mobile UI — glass surfaces across navigation, headers, modals, and session lists.
- Opus 5 in the Claude model picker.
- Side chats — fork a parallel conversation right next to your session.
- Redesigned new-session screen — prompt, attachments, voice, model, effort, and permissions in one place. Drafts are preserved.
- Pick your own sidebar panels, with keyboard shortcuts.
- Session launch and resume are more reliable.

# July 11 — GPT-5.6, Antigravity, bugfixes

New models, a new agent, and live subagent rendering.

- GPT-5.6 Sol, Terra, and Luna in the Codex model picker.
- New agent: Antigravity (agy) — Google's CLI (update the CLI first: `npm i -g happy`).
- Claude and Codex subagents render live in chat.
- Codex yolo actually stops asking for permissions.
- New status bar — branch, model, effort, context. Tap to switch model or effort.
- Your first machine appears immediately during onboarding.
- Resuming phone-created sessions works reliably.
- Message bubble colors in Settings → Appearance.
- Model/permission/effort picks reset once — they now sync across devices.

# July 2 — Fable in Claude Code

Fable is available from the Claude Code model picker.

# June 22 — Goals and cleaner commands

Agent goals and slash commands are easier to follow, with steadier remote sessions.

- Active goals appear above the composer for supported Claude and Codex sessions.
- `/goal` and skill commands render cleanly in chat instead of showing raw command internals.
- Codex skills now appear in the slash-command menu.
- Remote sessions handle first messages and resumed transcripts more reliably.

# May 15 — Cleaner, steadier chat

Less clutter in the conversation, fewer stuck states, smoother scrolling.

- Slash commands render as a clean chip — no more raw command markup or duplicated text.
- Skill runs no longer dump a wall of raw instructions into the chat.
- Chats pick up their real title instead of staying stuck on "New chat".
- The view stays put while the agent streams — no more scroll jumps when you've scrolled up to read.
- "Permission required" prompts clear properly after a session is interrupted.
- Resumed sessions no longer replay your whole history as duplicate messages.
- Slash-command and file autocomplete shows more results and keeps the highlighted item in view.

# May 13 — Faster long chats

Long sessions open instantly. Messages load latest-first with older history streaming in on scroll.

- Parallel decryption — no more freezing on sessions with thousands of messages.
- Backward pagination — scroll up to load history on demand.

# May 7 — Session retention, new sidebar, code editor, session branching

Desktop got a full refresh with a file browser, built-in editor, and zen mode. Sessions can now be branched or rewound.

**Session retention: 2 months.** Older sessions are cleaned up automatically to keep storage costs manageable.

## Features and fixes

- Thinking effort selection bug fixed.
- Smarter push notifications — suppressed when you're already in the app.
- Unread dots persist on sessions until you open them.
- Redesigned sidebar with file browser, code editor, and zen mode.
- Fixed stale sessions refusing to load, blank screen on launch, dual cursors in remote mode, `claude --resume` not finding Happy sessions.

## Experimental

Enable in Settings → Features:

- File diffs sidebar — see git changes next to chat on desktop.
- Session fork & rewind — branch off any session or roll back to any message.

# April 26 — Voice fixes, diffs, scroll

Voice actually works reliably now, plus better content rendering.

- Voice calls no longer break on second session.
- Tables and code blocks scroll horizontally.
- New diff viewer with syntax highlighting and unified/split toggle.
- Model and effort choices persist on mobile.
- Permission prompts no longer get lost.
- Settings stop randomly resetting during sync.
- Scroll-to-bottom button in chat.
- Delete machines from settings.

# April 8 — Gemini models, voice onboarding, CLI fixes

New models, smoother onboarding, fewer CLI hangs.

- Latest Gemini models in the picker.
- Better voice onboarding — clearer first-run prompts.
- CLI plan approval buttons actually show up now.
- CLI background tasks and Codex turns no longer hang.

# March 19 — New session screen, git worktrees, more agents

Completely new way to start sessions, plus worktree support and more agents.

- New session composer — pick machine, worktree, draft persists.
- Git worktree management from the app. Auto-cleanup on delete.
- Auto plan mode when your agent enters planning.
- OpenClaw as a selectable agent.
- Session quick actions, resume, delete from info screen.
- "Bypass" renamed to "yolo".

# December 22 — Agent updates, voice changes, tables

Agent config changes and voice pricing heads-up.

- Gemini support coming via ACP.
- Model config removed from app — use CLI defaults.
- Voice going subscription after 3 free trials.
- Markdown tables render properly now.

# September 12 — Codex, daemon mode, one-tap launch

Sessions start instantly now. No more manual CLI startup.

- Codex support for code completion and generation.
- Daemon mode — sessions start instantly without manual CLI startup.
- One-tap launch from mobile.
- Connect Anthropic and GPT accounts.

# August 29 — GitHub integration

Your GitHub identity in Happy.

- Connect your GitHub account via OAuth.
- Avatar, name, and bio sync to the app.
- Encrypted token storage.

# June 26 — QR login, dark mode, voice

Link devices instantly, look good doing it.

- QR code auth for instant device linking.
- Dark theme with system preference detection.
- Faster voice responses.
- Modified file indicators in session list.
- 15+ languages for voice.

# May 12 — Hello world

First release. Everything is new.

- E2E encrypted sessions.
- Voice assistant.
- File manager with syntax highlighting.
- Real-time sync across devices.
