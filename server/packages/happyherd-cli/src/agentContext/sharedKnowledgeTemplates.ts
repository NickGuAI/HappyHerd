/** Portable seed content. Existing user files are never replaced with these templates. */
export const SHARED_ENTRY_MARKDOWN = `# HappyHerd shared knowledge

Read [HappyHerd operations and CLI](happyherd-cli.md) before operating sessions,
Commanders, the daemon, automations, authentication, or credentials. Use the
installed command's help for exact options and current provider capabilities.

This directory is the shared AgentContext entry point for the configured
HappyHerd home. It is separate from each Commander's private definition and
AgentContext. Keep shared operational guidance here; keep Commander memory in
that Commander's existing tree. The selected Commander definition, existing
global instructions, project guidance, and user authority retain their roles.
This guide does not authorize actions or replace those instructions.
`;

export function globalAgentsMarkdown(): string {
  return `# HappyHerd shared instructions

Read the canonical [shared knowledge entry](agentcontext/README.md), then the
relevant [HappyHerd operations and CLI guidance](agentcontext/happyherd-cli.md)
before operating HappyHerd. These paths are relative to this global AGENTS.md
in the configured HappyHerd home, not to a project or Commander directory.

Preserve user authority, applicable project guidance, and the selected
Commander's definition and private memory/context composition. Shared guidance
does not grant permission to change other Commanders or machine-owned state.
`;
}

export const SHARED_CLI_MARKDOWN = `# HappyHerd operations and CLI

Return to the [shared entry point](README.md). This portable guide accompanies
installed HappyHerd; it does not require a source checkout or an author's home.

## Locate the shared and private context

<!-- rename:preserve -->
The configured HappyHerd home is selected by HAPPYHERD_HOME_DIR (legacy
HAPPY_HOME_DIR remains readable), otherwise ~/.happyherd, with an existing
~/.happy used in place when ~/.happyherd does not exist. Never copy or merge
homes to upgrade.
<!-- /rename:preserve -->
Paths below are relative to the effective home:

- AGENTS.md: user-global instructions.
- agentcontext/README.md: canonical shared entry point (this guide's sibling).
- agentcontext/happyherd-cli.md: this operations guide.
- commanders/<id>/COMMANDER.md: private Commander definition.
- commanders/<id>/agentcontext/: private Commander context and memory.

Commander context injection is supported by Claude and Codex. Gemini Commander
launch is disabled; generic ACP routes do not consume this context bundle.
Do not infer cross-provider context delivery from the existence of these files.

Use the paths in context receipts and commander list results rather than
assuming the default home. Shared operational knowledge is not Commander
memory. Keep the existing authority order and memory composition; never copy
another Commander's private memory into shared knowledge.

## Safe command discovery

The installed public command is happyherd. From a source checkout, its maintained
entry is node server/packages/happyherd-cli/bin/happyherd.mjs (relative to the
repository root), not a global-home script path. These help commands show usage
without starting a provider, logging in, or starting a daemon:

~~~sh
happyherd --help
happyherd session --help
happyherd session create --help
happyherd session inspect --help
happyherd session send --help
happyherd session side-chat --help
happyherd resume --help
happyherd machine --help
happyherd daemon --help
happyherd commander --help
happyherd automation --help
happyherd server --help
happyherd auth --help
happyherd connect --help
happyherd accounts --help
happyherd credentials --help
happyherd doctor --help
happyherd sandbox --help
happyherd notify --help
~~~

Top-level help may also invoke claude --help to display its native options.
Do not probe provider launch routes such as acp, agy, or gemini with --help:
these can launch real sessions. Use top-level help. Launch routes include the
default Claude session, codex, agy, grok, dsh, and generic acp; gemini is
deprecated in favor of agy. Provider model, effort, and permission catalogs
belong to the selected machine/provider; do not invent or substitute values.

## Sessions and resume

For a local task, use the existing machine login and an existing absolute
workspace. Select the intended Commander from happyherd commander list and
read its returned commanderPath definition. Example forms (replace placeholders):

~~~sh
happyherd session create --local --path ABSOLUTE_PATH --provider PROVIDER --commander ID --json
happyherd session create --machine ID_OR_HOST --path ABSOLUTE_PATH --provider PROVIDER --commander ID --json
happyherd session inspect SESSION_ID --limit 20 --json
happyherd session send SESSION_ID --text-file ABSOLUTE_FILE --message-id ID --json
happyherd resume SESSION_ID
happyherd session set-commander SESSION_ID COMMANDER_ID --json
~~~

Creation returns the tracked HappyHerd session ID but sends no task prompt.
Retain that ID and deliver the actual instructions file with send. Reuse the
same message ID after an uncertain send result; inspect the recent response.
Send and inspect use the owning local daemon. Inspect defaults to 20 messages
and accepts limits 1..100; its output is private session context, not a public
artifact. An accepted send receipt does not prove task completion.

--local uses the local daemon's existing machine login. --machine uses an exact
account machine ID or unambiguous hostname from happyherd machine list --json
and requires account-control authentication. The target must be online and
support the native machine-session protocol. --create-dir explicitly allows a
missing target directory. --model, --effort, and --permission are optional;
use only the target's advertised values. Omit --super-session for ordinary
tasks; that flag requires --commander. session ensure-assistant --json reuses
the account's persistent Assistant through the local daemon.

Resume takes a HappyHerd session ID (or supported unique prefix), not a provider
thread ID, and restores the saved workspace and provider resume state when
supported. Preserve the original machine, provider state home, encryption,
context, and session identity; reconnect-record age alone does not make a
session invalid. set-commander takes effect on the next resume; use none to
detach without changing the current live conversation context.

## Side chats and delegation

Prefer provider-native subagents for bounded inline work. Use a durable side
chat when work needs a visible resumable conversation. On the parent's owning
machine, use happyherd session side-chat create PARENT_SESSION_ID with all six
non-empty brief flags: --outcome, --scope, --dependencies, --write-ownership,
--verification, and --handoff. Optional --model, --effort, --permission, and
--json follow category help. This path uses the local daemon's existing login,
does not need machine auth login, and queues the brief as the child's first
message. Human one-click creation in the app opens an empty child instead.

Use side-chat list PARENT_SESSION_ID, status CHILD_SESSION_ID, stop
CHILD_SESSION_ID, close CHILD_SESSION_ID, or reopen CHILD_SESSION_ID. inspect,
pause, and resume alias status, stop, and reopen. close PARENT_SESSION_ID --all
closes that parent's children. Retain child IDs and inspect lifecycle receipts;
a post-spawn brief delivery failure can leave a real child ID to reconcile.
The parent owns scope, child lifecycle, verification, and the final handoff.

## Daemon, Commanders, and automations

happyherd daemon status and daemon list inspect the local daemon; list is not a
complete historical session catalog. daemon start starts the background
service; daemon stop stops it while sessions stay alive. Neither restart nor
doctor clean is a routine read-only diagnostic. Use authority for the target
before changing its lifecycle.

happyherd commander list returns canonical Commander definitions. commander
create --manifest ABSOLUTE_FILE installs a new agent-authored Commander
atomically; it is not an update mechanism for another Commander's private tree.
The create manifest requires id, name, absolute workspace, role, and
commanderMarkdown with matching identity fields; optional observationsJsonl,
workingMemoryMarkdown, longTermMemoryMarkdown, and learnings retain the existing
private context layout. Use commander --help for command usage and migration.

happyherd automation --help documents machine-local list, create, update,
pause, resume, run-now, history, delete, stop-run, and abandon-run. Definitions
live at agentcontext/automations/happyherd and run through the local daemon.
Even automation list/history can ensure the daemon is running; use help alone
for side-effect-free discovery. Agent schedules require name, kind,
instruction, cron schedule, IANA timezone, workspace, and claude/codex rail.
Exec schedules use rail exec, a fixed absolute executable, and exact arguments.
Use list --json and history ID --json to read back authorized changes. Pausing
a definition, stopping a run, and abandoning a run are distinct operations;
consult current help before changing any of them.

## Server and authentication boundaries

happyherd server runs a local sync server and web app (when bundled), defaulting
to 127.0.0.1:3005. It stores data in server-data under the configured home.
Use server --help before starting it. --no-persist avoids writing the default
server/webapp URL settings; --reset wipes local server data. Starting a server
is not necessary for help or guide migration. Packaged local serving requires
the server package/artifact; a remote server remains a separate deployment.

happyherd auth login/status/logout manages ordinary HappyHerd authentication.
happyherd machine auth login/status/logout manages a separate app-approved
account-wide machine-control link. Native session authentication does not grant
control of other account machines. Local session and side-chat operations reuse
the local daemon's machine login. Provider authentication is a third boundary:
install and authenticate the selected provider using its supported flow.

happyherd connect claude|codex|gemini without --acct registers provider OAuth
tokens with the HappyHerd server using ordinary HappyHerd sign-in; Gemini also
updates its local provider credentials. connect status reports these vendor
connections. This is distinct from named local accounts:

~~~text
happyherd connect claude --acct NICKNAME
happyherd connect codex --acct NICKNAME
happyherd connect grok --acct NICKNAME
happyherd accounts list [claude|codex|grok] [--json]
happyherd accounts use [PROVIDER] NICKNAME
happyherd accounts remove [PROVIDER] NICKNAME
~~~

Named connections run provider authentication, store a local named account,
and select it. Disambiguate duplicate nicknames by provider. Account mutation
can affect running provider work; use authority for the exact account.

Saved Credentials are separate encrypted account secrets managed in Settings
> Credentials & Accounts. happyherd credentials list --json returns secret-free
summaries with the existing ordinary sign-in and does not start a login flow
or daemon. credentials run --env VAR=NAME_OR_ID -- COMMAND injects selected
values into the child environment; it executes COMMAND. Never copy secrets
into prompts, arguments, URLs, logs, AgentContext, or artifacts.

## Diagnostics and preserving existing installations

Use doctor --help before diagnostics; doctor clean kills HappyHerd-related
processes and is not a harmless probe. sandbox configures OS sandboxing; notify
sends notifications. Neither is needed for ordinary context discovery. Runtime
registries, databases, credentials, logs, and transcripts are machine-owned;
use supported CLI owners instead of editing their files as an API.

For an existing installation, run happyherd commander guide --json to seed only
missing shared guides and the global AGENTS.md in the configured home. Inspect
the returned paths/statuses. Existing files are preserved byte-for-byte, even
if customized or obsolete; private Commander definitions and state are not
rewritten. Review any old global/shared references and manually correct only
the obsolete references to the canonical paths above, retaining every
user-authored instruction. Do not delete or overwrite files to force an
upgrade. The standalone guide command does not restart the daemon. Native
installer upgrades stop the managed daemon and can start services afterward;
--no-start prevents startup, not the upgrade stop. Neither seeding nor installation proves that an old live
conversation has reloaded context. Resume through the
supported route to obtain a fresh context receipt; do not fabricate historical
session continuation evidence.
`;
