# Your first HappyHerd task

Follow this guide on the macOS or Linux computer where your agent will work.
You will choose a server, create or restore a HappyHerd account, authorize that
computer, and ask Codex to summarize a small file. Keep the same account,
machine, folder, and conversation to continue afterward.

This guide distinguishes the public **1.2.4** CLI/server/Web archives (bundled
CLI **1.2.3**, latest checked October 8, 2026) from newer source. It is not a
claim that every platform has completed onboarding acceptance: see the
[verification matrix](acceptance/issue-378/README.md). Download only from
[HappyHerd releases](https://github.com/NickGuAI/HappyHerd/releases).
No native graphical Mac, iOS, Android, or Windows installer is distributed in
that release. A mobile browser uses the Web client, not a native app.

<!-- rename:preserve -->
The 1.2.4 Web header still says **Happy**. Check the selected server and the
HappyHerd release asset you installed; the branding alone does not identify
the distribution.
<!-- /rename:preserve -->

## 1. Choose where your server runs

The **server** synchronizes your account and conversations. A **machine** runs
the agent and owns the working files. The browser controls that machine; its
folder picker does not choose a folder on the phone or browser computer.

| Choice | Open in your browser | What to expect |
| --- | --- | --- |
| Local server, simplest for one computer | `http://127.0.0.1:3005` on that computer | The installer starts the bundled server. Keep the computer and server running. |
| An existing remote server | Its actual Web URL, supplied by its operator | The browser and CLI must use the same server. The remote server does not replace the agent machine. |

`127.0.0.1` on a phone refers to the phone. To use another device, use a server
that device can reach; follow the [deployment guide](deployment.md) for a
remote deployment and HTTPS. No HappyHerd hosted service is assumed here.

**Next:** install on the agent computer, with the chosen server address ready.

## 2. Install the public terminal/server distribution

Run as your normal user on macOS or Linux (arm64 or x64):

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh
```

The installer needs `curl` and `tar`. It downloads a prepared release and puts
`happyherd` in `~/.local/bin`. It does not require a compiler or a package
manager. In an interactive terminal, accept the local default or enter your
remote server URL. To choose a remote endpoint explicitly, replace the example:

```sh
curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | \
  sh -s -- --server https://happy.example.com
```

**Expected:** the program files and selected server are prepared. An interactive
installer can now pause at the authentication-method selector and wait for
approval. Leave that terminal waiting: complete steps 3–4 in the browser and
a second terminal, then return to the original prompt in step 5. It starts the
daemon after authorization succeeds. A noninteractive install instead prints
the remaining authentication command.

Open a new terminal if `happyherd` is not yet on your `PATH`. In that terminal,
check the installed CLI:

```sh
happyherd --version
```

Release 1.2.4 reporting CLI 1.2.3 is the known published version combination.
The script fetched from `main` and the downloaded archive are separate
revisions; a new script does not put newer source features into an old archive.
For an existing installation, the installer stops the managed daemon/server
while replacing program files, even with `--no-start`. See the
[installer guide](public-launcher-release.md) before an upgrade.

**Next:** open your chosen Web address before approving the terminal.

## 3. Create or restore your HappyHerd account, and keep its key

On the welcome screen, open the server-shaped button in the header to check
the selected server, then return to the welcome screen. Choose one path:

- **New account:** click **Create account**. On **Backup**, tap the secret key
  to copy it, save it privately in your password manager, then click
  **Continue**. Continue becomes available after copying.
- **Existing account:** click **Restore with Secret Key**, paste your saved
  account key, and click **Restore Account**. Use the server where that account
  and its conversations belong.

**Expected:** the signed-in session screen opens. A new account has no machines
or conversations yet; that is normal. Account creation does not log Codex in.

The account key is the recovery credential, not a password you can reset by
email. Keep it out of chats, screenshots, issue reports, and terminal commands.
An existing signed-in browser can show **Settings → Account → Backup**. If all
signed-in clients and the saved key are lost, creating another account does not
recover the old conversations. A CLI machine cannot display your account's
backup key.

**Next:** make Codex ready before starting the machine daemon.

## 4. Check the provider separately

This example uses **Codex**. On the same machine, under the same operating-system
user that runs the daemon, follow the official
[Codex CLI setup](https://learn.chatgpt.com/docs/codex/cli) and
[authentication guidance](https://learn.chatgpt.com/docs/auth).
Check its supported login status:

```sh
codex --version
codex login status
```

If it is not signed in, run `codex login` and complete its normal provider
sign-in. HappyHerd account creation and terminal authorization do not purchase
provider access or supply provider credentials. Do not copy authentication files
between users or machines.

**Expected:** Codex reports a configured login. Once the daemon is online in
step 5, select Codex explicitly in the machine's provider picker. Use only
models and permissions actually offered for that machine; a provider name in
the picker alone does not prove its login or quota is usable.

Other providers have their own installation and authentication requirements.
The public release and current source differ; use the selected release notes
and the actual machine's provider choices, rather than assuming every provider
in current source is installed. This guide's task and acceptance use Codex.

**Next:** return to the waiting installer to authorize it, or run the login
command in this shell if installation already finished. If installing Codex
required changing `PATH` in this second terminal, that change does not reach
the waiting installer. After authorization, restart the first-run daemon from
this terminal, where `codex --version` succeeds:

```sh
happyherd daemon stop
happyherd daemon start
```

## 5. Authorize the terminal, then bring the machine online

If the installer is still waiting at its authentication selector, return to
that terminal. Otherwise, on the agent computer run:

```sh
happyherd auth login
```

Choose **Web Browser**. Open the printed browser URL if the browser does not
open automatically. Use the same signed-in browser and server as step 3. On
**Connect Terminal**, choose **Accept Connection** only for the terminal
request you just started. **Reject** leaves it unapproved.

This authorizes that terminal to access your HappyHerd account; it is more than
selecting a machine for one chat. It is separate from Codex authentication.
Do not send the authorization URL to someone else.

**Expected:** the terminal reports successful authentication. The interactive
installer then starts the daemon. If authentication was deferred, start it
yourself; `daemon start` also checks an already running daemon. Run:

```sh
happyherd auth status
happyherd daemon start
happyherd daemon status
```

Return to the Web client and open the machine selector. The actual agent
computer should appear **online**. A successful authorization message alone
does not prove that the daemon is running or reachable.

On newer source, **No machine → Add a machine** opens a checklist in
**Connections**, and **Account devices** lists the connected computer. Those
newer checklist entries are not promised by the 1.2.4 archive; the terminal's
**Web Browser** route above also exists in that release.

**Device selection is different:** `happyherd machine pair` on versions that
support it selects an already authenticated, running account device. A device
code cannot bootstrap the first machine or transfer it to another account.
See [existing-device selection](device-pairing.md) if you already have machines.
You do not need `happyherd machine auth login` for this first local task.

**Next:** prepare a small folder whose contents you can verify yourself.

## 6. Choose the machine and folder, then send a useful first task

Create a new, empty folder named `happyherd-first-task` on the agent computer.
Inside it, use your text editor to save `notes.txt` containing:

```text
Buy ingredients for dinner.
Finish the project outline by Friday.
Water the plants.
```

In the 1.2.4 Web client, click **New session** in the desktop sidebar, or the
**+** in the narrow/mobile session header. The page is titled
**Start New Session**; newer source also exposes **New Chat** with **Advanced**
options. Select your online machine, the existing `happyherd-first-task` folder,
and **Codex**. Check the full folder path so you do not select another machine
or an unrelated project. On versions with **Working folder → Choose folder**,
use that picker. In 1.2.4, use the folder/path row and the picker titled
**Project**.

Send:

> Read notes.txt in this folder. Summarize the three tasks as three bullets,
> preserving any deadline. Do not modify files or run anything unrelated.

If a provider permission prompt appears, inspect the requested action and
approve only the intended read. Choose a less permissive advertised mode when
you want to review actions individually; you do not need unrestricted mode for
this example.

**Expected:** the conversation shows a completed Codex reply with the three
tasks and Friday deadline. Compare it with `notes.txt` and confirm that the
file is unchanged. A queued message, spinner, or online machine is not the
completed result. If an authentication or quota error appears, use the recovery
table below and keep the original failure visible when reporting it.

**Next:** prove that you can return to this conversation.

## 7. Reopen and continue the same conversation

Leave the server, daemon, and provider session running. Close the browser tab,
reopen the same Web address with the same browser profile, and select the
existing conversation from the session list. Verify its earlier reply and
machine/folder, then send:

> Which task had a deadline, and what was it?

**Expected:** the same conversation accepts the message and replies that the
project outline is due Friday. Do not start another chat to test continuity.
If you use another browser, restore the same account first. If the provider
process has ended, newer supported machine versions can offer **Resume
Session**; this requires retained provider state and the original machine and
folder. It is not a promise that every older release can automatically resume
all stopped sessions.

## If a step does not work

| Visible state | Check and recovery | Successful next outcome |
| --- | --- | --- |
| `happyherd` not found | Open a new terminal after installation; confirm the installer finished and `~/.local/bin` is on `PATH`. | `happyherd --version` prints a version. |
| Welcome screen cannot create an account | Check server address and connectivity, then retry once connectivity is restored. Newer source shows **Retry**; older builds may only stop the spinner. Do not assume a new account was created. | Signed-in screen and account backup appear. |
| Restore rejects a key | Check the saved key, selected server, and connection. The message can also cover a network failure; do not discard the backup solely because it says the key is invalid. | Your existing account's conversations reappear. |
| Wrong server or empty unexpected account | Compare the Web server selection with the server chosen during installation, and check which browser account approved the terminal. `happyherd auth status` checks CLI authentication but does not identify the server or account. Restore the intended account on its server. Do not create another account to recover old history. | Browser and machine use the intended server/account. |
| Authorization cancelled, failed, or stale | Cancel the waiting CLI attempt and rerun `happyherd auth login`; open its fresh URL. Refreshing the confirmation page may discard its request fragment and show **Invalid Connection Link**. | Approving the fresh request completes CLI authentication. |
| CLI already belongs to another account | Check `happyherd auth status` before changing anything. An intentional `happyherd auth login --force` clears credentials and machine ID and stops the daemon; it is not a routine retry. Preserve the old setup until you intend that change. | Intended account is authorized, then its daemon is started. |
| No machine / machine offline | On that machine, check `happyherd daemon status`, then `happyherd daemon start`; check its network and server/account and refresh the client. | The actual machine appears online and can accept a task. |
| No Codex choice or provider sign-in error | Install/authenticate Codex for the daemon's user and check `codex login status`. If it was installed after the first-run daemon started, or its directory was added only to a new shell’s `PATH`, run `happyherd daemon stop` then `happyherd daemon start` from a shell that finds Codex; refresh the choices. This restarts that user's daemon, so coordinate it on a machine already in use. Follow any provider quota message. | Codex actually replies to the task. |
| Device code expired or cancelled | For an already authenticated machine on a supporting version, generate a fresh `happyherd machine pair` code; verify the same server/account and online daemon. | The intended existing device is selected. No new account is created. |
| Reopened conversation cannot send | Check server and daemon reachability. Keep the original machine, folder, and provider state; use **Resume Session** only where offered. | Another reply arrives in the same conversation. |

For help, include your release/CLI version, operating system, selected server
kind (local or remote), the step, and the visible error in a
[HappyHerd issue](https://github.com/NickGuAI/HappyHerd/issues). Never include
account keys, provider tokens, or authorization URLs. The
[acceptance record](acceptance/issue-378/README.md) identifies existing owners
for known release and setup gaps.
