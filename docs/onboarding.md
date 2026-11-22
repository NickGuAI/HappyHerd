# Connect your tools: the onboarding checklist

Use this checklist on the computer where your agents work, right after the
installer prints **HappyHerd installed.** It ends when Google Workspace,
GitHub and TickTick are ready on that computer, your task tracker is picked,
and each of your account's Projects has a place for its tasks.

You can follow it alone in a terminal. Run `happyherd machine auth login` once
and, within two minutes, approve it in the HappyHerd app (Settings → Account →
Link New Device): scan its QR code with the phone app, or paste its `- URL:`
link in the web or desktop app. Setup then keeps the task tracker and each
Project's place with your account. Then run `happyherd setup`. For each tool
that is not signed in, it asks first: your Google email address, then `(Y/n)`
before the GitHub sign-in and before the TickTick sign-in. Enter starts each
sign-in, and you finish it in the browser. At the end it asks for the task
tracker, then for the place of each Project's tasks: a TickTick list, or a
GitHub repository as `OWNER/REPO`. Then do step 6.

You can also hand this page to the agent you already work with, such as your
HappyHerd assistant (OldBlue unless you named it otherwise) or the agent in
Cursor, the Codex app on macOS, Claude Cowork, agy or a similar tool. The
agent runs the commands, and you do the sign-ins. No app page is needed.

```text
 agent: setup, integration and                      you, at the computer
 tracker always with --json                         ────────────────────
 1  happyherd setup --help
 2  happyherd setup --json ── exit 0 ─────────────────────────────▶ done
      installs missing tools and their skills
      exit 2: lists your next steps ─────────────▶ 3  happyherd setup <name>
                                                      in your own terminal: it asks
                                                      first, then the browser sign-in
    happyherd integration check <name> --json ◀──── "done"
                                                   4  happyherd machine auth login
                                                      in your own terminal: approve its
                                                      QR code or link in the HappyHerd app
    happyherd machine auth status ◀──────────────── "done"
 5  happyherd setup --tracker ticktick|github --json ◀── your pick
    happyherd setup --project ID --place PLACE --json ◀── a list or OWNER/REPO
                                                          for each Project
 6  happyherd setup --json ── exit 0 ──▶ done        exit 2: back to step 3, 4 or 5
```

## Rules for every step

1. **No secret ever goes into a conversation.** Never paste or type a
   password, a two-factor code, a token, an API key, a recovery code or the
   contents of an OAuth client file into a chat with an agent, or into a
   command that an agent runs. Type them only into the tool's own browser
   page, or into a terminal that you opened yourself.
2. **Each tool keeps its own sign-in.** HappyHerd starts the tool's own
   sign-in only in your terminal. It stores no token and prints no secret.
   An agent checks with `happyherd integration check` and never runs a
   tool's own sign-in or status command: `ticktick auth status`, for
   example, prints part of the token. Nobody uses a tool's paste-a-token
   option, such as `gh auth login --with-token`, `ticktick auth token`,
   `gog auth import` or gog's `--access-token`.
3. **Who does what.** The agent runs each `happyherd setup`, `integration` and
   `tracker` command with `--json`, and shows you each next step exactly as
   printed. You run each sign-in and the account link in your own terminal,
   finish them in the browser or the HappyHerd app, and choose the accounts,
   the tracker and the places. Tell the agent when a step is done.

## The checklist

### 1. Check that setup is here

- **Run:** `happyherd setup --help`
- **You:** nothing.
- **Done when:** its first line of text is
  `happyherd setup - Connect Google Workspace, GitHub and TickTick on this machine`.
- **If it fails:** if the general help prints instead, whose first line of
  text is `happyherd - Claude Code On the Go`, with no `happyherd setup`
  line, this HappyHerd is older than this checklist. It still exits `0`. Do
  not run step 2: on that version `happyherd setup --json` starts a Claude
  Code session instead. Update HappyHerd with the
  [installer](public-launcher-release.md), then start again.
  `command not found` means this terminal cannot find HappyHerd yet: open a
  new terminal, and see the [first-run guide](first-run.md).

### 2. Install the tools and their skills

- **Run:** `happyherd setup --json`. It runs the check of `google-workspace`
  (the `gog` tool), `github` (`gh`) and `ticktick` (`ticktick`). It installs
  a missing tool with Homebrew or npm, never with `sudo`, and copies each
  tool's usage skill into the skills folder of Claude Code, and of Codex and
  Antigravity when they are on this computer. It starts no sign-in and asks
  nothing.
- **You:** nothing yet. The agent shows you the next steps.
- **Done when:** it exits `0` and its `status` is `ready`: every
  integration is ready with its skill, a tracker is picked and every Project
  has a place, so onboarding is complete. Exit `2` lists the next steps for
  you in `nextSteps`: go to step 3 for a sign-in, to step 4 when a step names
  `happyherd machine auth login`, and to step 5 for the tracker or a place.
- **If it fails:** a next step that says to install a tool means that
  Homebrew or npm is missing or the install failed. Do the install step that
  it names, then run this step again. Exit `1` prints an `error` message:
  correct the command and run it again. If the command is right, see the
  sandbox row in [When a step fails](#when-a-step-fails).

### 3. Sign in to each tool that is not signed in

Do one integration at a time, in the order of the next steps.

- **Run, in a terminal that you opened yourself:** `happyherd setup <name>`,
  with `google-workspace`, `github` or `ticktick`. It asks first, then
  starts the tool's own sign-in:
  - `google-workspace`: `Google account to sign in (email, empty to skip):`
  - `github`: `Start the GitHub sign-in in your browser? (Y/n)`
  - `ticktick`: `Start the TickTick sign-in in your browser? (Y/n)`
- **You:** type your Google email address, or press Enter for GitHub and
  TickTick; an empty email or `n` skips the sign-in. Then finish the sign-in
  in the browser with the account that your agents should use, and tell the
  agent.
  - Google: the `gog` guide walks you through a Google Cloud project, its
    APIs and an OAuth client, and the browser sign-in. Allow every service
    it asks for: Google Workspace is ready only when one sign-in grants
    Gmail, Calendar, Drive, Docs, Sheets, Slides and Contacts. If it asks
    for an OAuth client file, download a Desktop OAuth client from the
    Google Cloud console, then run
    `happyherd setup google-workspace --credentials FILE` in that terminal,
    with the file's path, never its contents.
  - GitHub: sign in to GitHub and authorize the GitHub CLI.
  - TickTick: sign in to TickTick and allow access.
- **Done when:** the agent runs `happyherd integration check <name> --json`,
  and it exits `0` and shows the integration as `ready`. Then do the next
  one. `happyherd integration list --json` shows all three at once:
  `ready`, `not-signed-in` or `not-installed`.
- **If it fails:** see [When a step fails](#when-a-step-fails).

### 4. Link account control

Setup keeps the task tracker and each Project's place with your account, so
every computer reads the same values. It needs this link to read and save
them, and to list your account's Projects.

- **Run, in a terminal that you opened yourself:**
  `happyherd machine auth login`. It shows a one-time QR code, prints the
  same link on its `- URL:` line, and waits two minutes.
- **You:** in the HappyHerd app, open Settings → Account → Link New Device.
  Scan the QR code with the phone app, or paste the `- URL:` link in the web
  or desktop app. Approve within two minutes. The link lets this computer act
  for your whole account, so approve only the code that you just started.
  Then tell the agent.
- **Done when:** the agent runs `happyherd machine auth status` (it takes no
  `--json`), and it prints `- Status: Authenticated`.
- **If it fails:** `- Status: Not authenticated` means the approval did not
  finish, for example because the two minutes passed. Run the login again
  and approve the new code.

### 5. Pick the task tracker and each Project's place

- **Run:** `happyherd setup --tracker ticktick --json` or
  `happyherd setup --tracker github --json`. Then, for each next step that
  says `Choose the TickTick list for Project …` or
  `Choose the GitHub repository for Project …`, run the command it names
  with your place: `happyherd setup --project ID --place PLACE --json`.
- **You:** choose TickTick or GitHub. Your agents keep your tasks there.
  Then choose, for each Project, the TickTick list or the GitHub repository
  (`OWNER/REPO`) that holds its tasks.
- **Done when:** `happyherd tracker show --json` prints your tracker and a
  `place` for every Project, for example
  `{"tracker":"ticktick","projects":[{"id":"…","name":"Alpha","place":"Work"}]}`.
  The setup command still exits `2` while something else is left, but each
  pick is saved. They are kept with your account, so every computer reads
  the same values. Change them later with the same commands, or by running
  `happyherd setup` in a terminal.
- **If it fails:** exit `1` prints an `error`. The tracker must be
  `ticktick` or `github`. A GitHub place looks like `OWNER/REPO`. When
  several Projects share a name, use the Project ID. When the error says
  that account control is not linked, do step 4; `tracker show` also exits
  `1` until then. When it says that the HappyHerd server could not be
  reached, did not answer or answered with an error, check this computer's
  network and server address, or see the sandbox row, then try again.

### 6. Check the whole computer

- **Run:** `happyherd setup --json`
- **You:** nothing.
- **Done when:** it exits `0` and its `status` is `ready`. Every
  integration is ready with its skill, the tracker is picked and every
  Project has a place, so onboarding is complete.
- **If it fails:** exit `2` lists what is left in `nextSteps`: go back to
  step 3, 4 or 5.

## When a step fails

| What you see | What to do |
| --- | --- |
| Still `not-signed-in` after the browser | The sign-in did not finish, or its page expired. Run `happyherd setup <name>` again in your terminal and finish the new page. The `detail` field says what the tool's check found. |
| Google reads `the stored sign-in lacks …` | The Google sign-in did not grant every service. Run `happyherd setup google-workspace` again in your own terminal: it signs in again and asks Google to grant all seven. |
| GitHub stays `not-signed-in` although you signed in | `gh` checks every github.com account that it holds, so one whose sign-in no longer works keeps GitHub not ready. In your own terminal, `gh auth status --hostname github.com` shows which one. Sign it out with `gh auth logout --hostname github.com --user NAME`, or sign it in again, then run step 2 again. |
| Google stays `not-signed-in` for the agent although you signed in, on a Linux computer without a desktop keyring | gog then keeps its sign-in in a file keyring, and the `detail` shows gog's message. Set `GOG_KEYRING_PASSWORD` in the environment that your agents run in, never in a conversation. |
| Google stops at the project or its APIs | In your own terminal, run `happyherd setup google-workspace --gcloud-project ID --enable-apis` to turn on the APIs in your project, and add `--create-project` to make that project first. Both use the `gcloud` command. These options work only in a terminal: with `--json` they change nothing. |
| No browser opens, for example on a remote computer | GitHub: `gh` prints a one-time code and an address. Open the address in a browser on any computer and type the code there. Google: once setup has made the project and the OAuth client, run `gog auth add <email> --services gmail,calendar,drive,docs,sheets,slides,contacts --remote` in your own terminal and follow what it prints; anything it asks you to paste goes only into that terminal. TickTick: its sign-in has no browserless option yet and needs a browser on this computer. Then do step 2 again. |
| A next step says `Link account control …` or `List the account's Projects …` | Setup could not read your account's settings or list its Projects. Read the reason in parentheses. If it says that account control is not linked, do step 4. If it says that the HappyHerd server could not be reached, did not answer or answered with an error, a new link does not help: check this computer's network and server address, or see the sandbox row. Then do step 5 again. |
| Your agent cannot run commands on this computer, or a command works in your own terminal but not from the agent: a permission error, "could not be reached", a `Copy the … usage skill` next step, or an install that fails | The agent tool runs its commands in a sandbox that blocks network access or writes outside the project folder; Codex's default sandbox, for example, blocks network access. Let the agent run `happyherd` outside its sandbox, with your approval, or run each command yourself in a terminal on this computer. The steps are the same. A skills folder that stays read-only for you too must be made writable before `happyherd setup <name>` can copy the skill. |
| Signed in with the wrong account | Sign that tool out in your terminal (`gh auth logout`, `ticktick auth logout` or `gog auth remove <email>`), then run `happyherd setup <name>` again. |

The tools' own sign-in and check, which `happyherd setup` runs for you. Use
them only in your own terminal:

| Integration | Sign-in | Check |
| --- | --- | --- |
| Google Workspace | `gog auth setup <email> --services gmail,calendar,drive,docs,sheets,slides,contacts --login` | `gog auth doctor --check`, then `gog auth list`: one account must list all seven services |
| GitHub | `gh auth login --hostname github.com --web` | `gh auth status --hostname github.com` |
| TickTick | `ticktick auth login` | `ticktick auth status` prints part of the token, so check with `happyherd integration check ticktick` instead |

After a sign-in by hand, do step 2 again so that each tool's skill is in
place, then step 6.
