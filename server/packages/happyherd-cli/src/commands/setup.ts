/**
 * Connects the tools that agents use on this machine: Google Workspace through
 * gog, GitHub through gh and TickTick through the ticktick CLI. Each tool keeps
 * its own sign-in. HappyHerd installs a missing tool, starts the tool's sign-in
 * in a terminal, reads the tool's own check and copies the tool's usage skill
 * into each agent's skills folder. It also keeps the task tracker pick and the
 * place of each account Project's tasks in the account settings, so every
 * machine reads the same values. A tool's output can carry a token, so it is
 * never printed or kept.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import spawn from 'cross-spawn';
import tweetnacl from 'tweetnacl';
import { z } from 'zod';
import { decodeBase64, encodeBase64 } from '@/api/encryption';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import { readLocalHappyHerdAgentCredentials } from '@/resume/localHappyHerdAgentAuth';
import { createDefaultClient } from './machine';

type State = 'ready' | 'not-signed-in' | 'not-installed';
type Tracker = 'ticktick' | 'github';
type Check = { state: State; detail?: string; reauthorize?: boolean };
type GoogleOptions = { credentials?: string; 'gcloud-project'?: string; 'create-project'?: boolean; 'enable-apis'?: boolean };
type Ask = (question: string) => Promise<string | undefined>;
type Result = { integration: Integration; check: Check; skillInstalled?: boolean; skillError?: string };
type Project = { id: string; name: string };
type Places = Record<string, { name: string; place?: string }>;
type AccountSettings = Record<string, unknown>;

export type SetupDependencies = {
    /** The account's Projects; by default through the account-control link. */
    listProjects?: () => Promise<Project[]>;
    /** Terminal questions and whether a terminal is attached; by default the process's own. */
    ask?: Ask;
    interactive?: boolean;
};

interface Integration {
    name: string;
    title: string;
    tool: string;
    install: { command: string; args: string[]; manual: string };
    signInNote?: string;
    check(): Promise<Check>;
    /** Asks first, then runs the tool's own sign-in; false when the User skipped it. */
    signIn(context: { google: GoogleOptions; check: Check; ask: Ask }): Promise<boolean>;
}

const TRACKERS: readonly Tracker[] = ['ticktick', 'github'];
const STATE_LABELS: Record<State, string> = { ready: 'ready', 'not-signed-in': 'not signed in', 'not-installed': 'not installed' };
const GOOGLE_SERVICES = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'contacts'];
const CHECK_TIMEOUT_MS = 60_000;
const NETWORK_TIMEOUT_MS = 15_000;
const TRACKER_STEP = 'Choose the task tracker: `happyherd setup --tracker ticktick` or `happyherd setup --tracker github`.';
const PLACES: Record<Tracker, { label: string; example: string; valid: (place: string) => boolean }> = {
    ticktick: { label: 'TickTick list', example: 'LIST', valid: (place) => place.length > 0 },
    github: { label: 'GitHub repository', example: 'OWNER/REPO', valid: (place) => /^[\w.-]+\/[\w.-]+$/.test(place) },
};
const doctorSchema = z.object({
    checks: z.array(z.object({ name: z.string(), status: z.string(), detail: z.string().optional(), hint: z.string().optional() })),
});
const accountsSchema = z.object({
    accounts: z.array(z.object({ services: z.array(z.string()).optional(), error: z.string().optional() })),
});
const placesSchema = z.record(z.string(), z.object({ name: z.string(), place: z.string().optional() }));
const settingsResponseSchema = z.object({ settings: z.string().nullable(), settingsVersion: z.number() });
const settingsUpdateSchema = z.union([
    z.object({ success: z.literal(true) }),
    z.object({ success: z.literal(false), error: z.string(), currentVersion: z.number().optional(), currentSettings: z.string().nullable().optional() }),
]);
const NOT_LINKED = 'Account-level machine control is not linked. Run `happyherd machine auth login` and approve the one-time link in the HappyHerd app.';

/**
 * Runs a tool. `capture` keeps stdout in memory for classification only;
 * `terminal` hands the terminal to the tool; `stderr` sends the tool's output
 * to stderr.
 */
function run(command: string, args: string[], output: 'capture' | 'terminal' | 'stderr'): Promise<{ missing: boolean; code: number | null; stdout: string }> {
    return new Promise((resolve) => {
        const stream = output === 'capture' ? 'pipe' : 2;
        const child = spawn(command, args, { stdio: output === 'terminal' ? 'inherit' : ['ignore', stream, stream] });
        let stdout = '';
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
        child.stderr?.resume();
        // A hung check is stopped. Unlike spawn's own timeout, this timer never
        // outlives a tool that is missing.
        const timer = output === 'capture' ? setTimeout(() => child.kill(), CHECK_TIMEOUT_MS).unref() : undefined;
        const done = (missing: boolean, code: number | null) => {
            clearTimeout(timer);
            resolve({ missing, code, stdout });
        };
        child.on('error', (error: NodeJS.ErrnoException) => done(error.code === 'ENOENT', null));
        child.on('close', (code) => done(false, code));
    });
}

/** Asks one question in the terminal; Ctrl+C or end of input gives undefined. */
async function askInTerminal(question: string): Promise<string | undefined> {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const skip = new AbortController();
    prompt.on('SIGINT', () => skip.abort());
    prompt.on('close', () => skip.abort());
    try {
        return (await prompt.question(question, { signal: skip.signal })).trim();
    } catch {
        process.stdout.write('\n');
        return undefined;
    } finally {
        prompt.close();
    }
}

/** Asks before a sign-in starts: Enter or y starts it; n, Ctrl+C or end of input skips it. */
async function confirm(ask: Ask, question: string): Promise<boolean> {
    const answer = (await ask(`${question} (Y/n) `))?.toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
}

const INTEGRATIONS: Integration[] = [
    {
        name: 'google-workspace',
        title: 'Google Workspace',
        tool: 'gog',
        install: {
            command: 'brew',
            args: ['install', 'openclaw/tap/gogcli'],
            manual: 'brew install openclaw/tap/gogcli, or download gog from https://github.com/openclaw/gogcli/releases',
        },
        signInNote: 'It asks for your Google account. If gog asks for an OAuth client, follow its steps, then run `happyherd setup google-workspace --credentials FILE`.',
        async check() {
            const doctor = await run('gog', ['auth', 'doctor', '--check', '--json', '--no-input'], 'capture');
            if (doctor.missing) return { state: 'not-installed' };
            let checks: z.infer<typeof doctorSchema>['checks'] = [];
            try {
                checks = doctorSchema.parse(JSON.parse(doctor.stdout)).checks;
            } catch {
                return { state: 'not-signed-in', detail: 'gog auth doctor gave no result.' };
            }
            // A stored sign-in and no failing check; gog's other warnings do not block it.
            const tokens = checks.find((check) => check.name === 'tokens');
            const problem = checks.find((check) => check.status === 'error') ?? (tokens?.status === 'ok' ? undefined : tokens);
            if (!tokens || problem) {
                const detail = problem ? [problem.detail, problem.hint].filter(Boolean).join('; ') : 'no sign-in is stored';
                return { state: 'not-signed-in', detail: `gog: ${detail}` };
            }
            // Ready also needs one stored sign-in that grants all seven services.
            const list = await run('gog', ['auth', 'list', '--json', '--no-input'], 'capture');
            let accounts: z.infer<typeof accountsSchema>['accounts'] = [];
            try {
                accounts = accountsSchema.parse(JSON.parse(list.stdout)).accounts;
            } catch {
                return { state: 'not-signed-in', detail: 'gog auth list gave no result.' };
            }
            const missing = accounts
                .filter((account) => !account.error)
                .map((account) => GOOGLE_SERVICES.filter((service) => !account.services?.includes(service)))
                .sort((left, right) => left.length - right.length)[0] ?? GOOGLE_SERVICES;
            if (missing.length === 0) return { state: 'ready' };
            return { state: 'not-signed-in', detail: `gog: the stored sign-in lacks ${missing.join(', ')}`, reauthorize: true };
        },
        async signIn({ google, check, ask }) {
            const email = await ask('Google account to sign in (email, empty to skip): ');
            if (!email) return false;
            await run('gog', [
                'auth', 'setup', email, '--services', GOOGLE_SERVICES.join(','), '--login',
                // A new consent grants the missing services and a refresh token that covers them.
                ...(check.reauthorize ? ['--force-consent'] : []),
                ...(google['gcloud-project'] ? ['--gcloud-project', google['gcloud-project']] : []),
                ...(google['create-project'] ? ['--create-project'] : []),
                ...(google['enable-apis'] ? ['--enable-apis'] : []),
                ...(google.credentials ? ['--credentials', google.credentials] : []),
            ], 'terminal');
            return true;
        },
    },
    {
        name: 'github',
        title: 'GitHub',
        tool: 'gh',
        install: { command: 'brew', args: ['install', 'gh'], manual: 'see https://cli.github.com for your system' },
        async check() {
            // gh checks every github.com account it holds; `--active` would narrow that but needs gh 2.57.
            const result = await run('gh', ['auth', 'status', '--hostname', 'github.com'], 'capture');
            if (result.missing) return { state: 'not-installed' };
            return result.code === 0
                ? { state: 'ready' }
                : { state: 'not-signed-in', detail: 'gh: a github.com account has no working sign-in, or GitHub could not be reached' };
        },
        async signIn({ ask }) {
            if (!(await confirm(ask, 'Start the GitHub sign-in in your browser?'))) return false;
            await run('gh', ['auth', 'login', '--hostname', 'github.com', '--web'], 'terminal');
            return true;
        },
    },
    {
        name: 'ticktick',
        title: 'TickTick',
        tool: 'ticktick',
        install: {
            command: 'npm',
            args: ['install', '--global', '@ticktick/ticktick-cli'],
            manual: 'install Node.js 20 or later, then run npm install --global @ticktick/ticktick-cli',
        },
        async check() {
            // When signed in, `ticktick auth status` also prints part of the access token.
            const result = await run('ticktick', ['auth', 'status'], 'capture');
            if (result.missing) return { state: 'not-installed' };
            const signedIn = result.code === 0 && /signed in/i.test(result.stdout) && !/not signed in/i.test(result.stdout);
            return signedIn ? { state: 'ready' } : { state: 'not-signed-in', detail: 'ticktick: no sign-in is stored' };
        },
        async signIn({ ask }) {
            if (!(await confirm(ask, 'Start the TickTick sign-in in your browser?'))) return false;
            await run('ticktick', ['auth', 'login'], 'terminal');
            return true;
        },
    },
];

function select(name: string | undefined): Integration[] {
    if (name === undefined) return INTEGRATIONS;
    const integration = INTEGRATIONS.find((candidate) => candidate.name === name);
    if (!integration) throw new Error(`Unknown integration: ${name}. Choose google-workspace, github or ticktick.`);
    return [integration];
}

function isTracker(value: unknown): value is Tracker {
    return TRACKERS.includes(value as Tracker);
}

/*
 * The tracker pick and the places are the keys taskTracker and taskPlaces of
 * the account settings that the app syncs through the server (its Features
 * switches live there too). The app seals them with the account secret, which
 * the account-control link holds and the CLI's own sign-in does not, and it
 * keeps keys it does not know when it saves.
 */
function accountLink(): { token: string; secret: Uint8Array } {
    const credentials = readLocalHappyHerdAgentCredentials();
    if (!credentials) throw new Error(NOT_LINKED);
    return credentials;
}

async function accountSettingsRequest(link: { token: string }, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(`${configuration.serverUrl.replace(/\/+$/, '')}/v1/account/settings`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                Authorization: `Bearer ${link.token}`,
                'Content-Type': 'application/json',
                'X-Happy-Client': `cli/${configuration.currentCliVersion}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        });
    } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        throw new Error(timedOut
            ? `The HappyHerd server did not answer within ${NETWORK_TIMEOUT_MS / 1000} seconds.`
            : `The HappyHerd server could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`The HappyHerd server answered ${response.status} for the account settings.`);
    return response.json();
}

function openSettings(sealed: string | null, secret: Uint8Array): AccountSettings {
    if (!sealed) return {};
    const bytes = decodeBase64(sealed);
    const nonceLength = tweetnacl.secretbox.nonceLength;
    const opened = tweetnacl.secretbox.open(bytes.slice(nonceLength), bytes.slice(0, nonceLength), secret);
    if (!opened) throw new Error('The account settings could not be opened with the account-control link. Run `happyherd machine auth login` again.');
    const settings: unknown = JSON.parse(new TextDecoder().decode(opened));
    return settings && typeof settings === 'object' ? settings as AccountSettings : {};
}

function sealSettings(settings: AccountSettings, secret: Uint8Array): string {
    const nonce = tweetnacl.randomBytes(tweetnacl.secretbox.nonceLength);
    const box = tweetnacl.secretbox(new TextEncoder().encode(JSON.stringify(settings)), nonce, secret);
    const sealed = new Uint8Array(nonce.length + box.length);
    sealed.set(nonce);
    sealed.set(box, nonce.length);
    return encodeBase64(sealed);
}

async function readAccountSettings(): Promise<AccountSettings> {
    const link = accountLink();
    const current = settingsResponseSchema.parse(await accountSettingsRequest(link));
    return openSettings(current.settings, link.secret);
}

/** Saves onto the latest account settings with the server's version check, keeping every other key. */
async function updateAccountSettings(update: (settings: AccountSettings) => AccountSettings): Promise<void> {
    const link = accountLink();
    let current = settingsResponseSchema.parse(await accountSettingsRequest(link));
    for (let attempt = 0; attempt < 3; attempt++) {
        const settings = update(openSettings(current.settings, link.secret));
        const result = settingsUpdateSchema.parse(await accountSettingsRequest(link, {
            settings: sealSettings(settings, link.secret),
            expectedVersion: current.settingsVersion,
        }));
        if (result.success) return;
        if (result.error !== 'version-mismatch' || result.currentVersion === undefined) {
            throw new Error(`The HappyHerd server did not save the account settings: ${result.error}`);
        }
        current = { settings: result.currentSettings ?? null, settingsVersion: result.currentVersion };
    }
    throw new Error('The account settings kept changing while setup saved them. Run happyherd setup again.');
}

function trackerOf(settings: AccountSettings | undefined): Tracker | null {
    return isTracker(settings?.taskTracker) ? settings.taskTracker : null;
}

function placesOf(settings: AccountSettings | undefined, tracker: Tracker): Places {
    const all = settings?.taskPlaces;
    const places = placesSchema.safeParse(all && typeof all === 'object' ? (all as Record<string, unknown>)[tracker] : undefined);
    return places.success ? places.data : {};
}

/** Reads the account settings, or gives the reason they cannot be read. */
async function tryAccountSettings(): Promise<{ settings?: AccountSettings; reason?: string }> {
    try {
        return { settings: await readAccountSettings() };
    } catch (error) {
        return { reason: error instanceof Error ? error.message : String(error) };
    }
}

function linkStep(reason: string | undefined): string {
    return `Link account control so the task tracker and each Project's place are kept with the account, then run \`happyherd setup\` again. (${reason})`;
}

async function listAccountProjects(): Promise<Project[]> {
    const client = await createDefaultClient();
    return (await client.listProjects({ timeoutMs: NETWORK_TIMEOUT_MS })).map(({ id, name }) => ({ id, name }));
}

/** Finds a Project by exact ID, or by a name that only one Project has. */
function findProject<T extends { id: string; name: string }>(projects: T[], reference: string): T | undefined {
    const byName = projects.filter((project) => project.name === reference);
    const found = projects.find((project) => project.id === reference) ?? byName[0];
    if (found && found.id !== reference && byName.length > 1) throw new Error(`Several Projects are named ${reference}. Use the Project ID.`);
    return found;
}

/** Skills folders of the agents on this machine. Claude Code comes with HappyHerd. */
function skillFolders(): { provider: string; dir: string }[] {
    const home = homedir();
    const codexHome = process.env.CODEX_HOME || join(home, '.codex');
    const folders = [{ provider: 'claude', dir: join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills') }];
    if (existsSync(codexHome)) folders.push({ provider: 'codex', dir: join(codexHome, 'skills') });
    if (['antigravity', 'antigravity-cli'].some((name) => existsSync(join(home, '.gemini', name)))) {
        folders.push({ provider: 'agy', dir: join(home, '.gemini', 'config', 'skills') });
    }
    return folders;
}

/**
 * Copies the usage skill shipped with this CLI into each folder, skipping an
 * identical copy. A folder that cannot be written does not stop the others;
 * the reason is returned.
 */
async function installSkill(integration: Integration, folders: { dir: string }[]): Promise<string | undefined> {
    const skill = `happyherd-${integration.name}`;
    const source = await readFile(join(projectPath(), 'skills', skill, 'SKILL.md'), 'utf8');
    const failures: string[] = [];
    for (const { dir } of folders) {
        const target = join(dir, skill, 'SKILL.md');
        try {
            if (await readFile(target, 'utf8').catch(() => undefined) === source) continue;
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, source);
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
        }
    }
    return failures.length > 0 ? failures.join('; ') : undefined;
}

function nextSteps({ integration, check, skillError }: Result, installAttempted: boolean): string[] {
    const steps: string[] = [];
    if (check.state === 'not-installed') {
        steps.push(installAttempted
            ? `Install ${integration.tool} (${integration.install.manual}), then run \`happyherd setup ${integration.name}\`.`
            : `Run \`happyherd setup ${integration.name}\` to install ${integration.tool} and its usage skill.`);
    } else if (check.state === 'not-signed-in') {
        steps.push([
            `Run \`happyherd setup ${integration.name}\` in a terminal on this machine and finish the ${integration.title} sign-in in your browser.`,
            integration.signInNote,
            check.detail && `(${check.detail})`,
        ].filter(Boolean).join(' '));
    }
    if (skillError) {
        steps.push(`Copy the ${integration.tool} usage skill: ${skillError}. Make that folder writable, then run \`happyherd setup ${integration.name}\`.`);
    }
    return steps;
}

function placeStep(tracker: Tracker, project: Project): string {
    return `Choose the ${PLACES[tracker].label} for Project ${project.name}'s tasks: \`happyherd setup --project ${project.id} --place ${PLACES[tracker].example}\`.`;
}

/** Prints the result and returns the exit status: 0 ready, 2 the User must act. */
function report(results: Result[], options: {
    json: boolean;
    tracker: Tracker | null;
    /** false when the account settings could not be read. */
    trackerKnown?: boolean;
    trackerStep: boolean;
    installAttempted: boolean;
    skillProviders?: string[];
    moreSteps?: string[];
}): number {
    const steps = results.flatMap((result) => nextSteps(result, options.installAttempted));
    if (options.trackerStep && !options.tracker) steps.push(TRACKER_STEP);
    steps.push(...options.moreSteps ?? []);
    if (options.json) {
        console.log(JSON.stringify({
            status: steps.length ? 'action-required' : 'ready',
            integrations: results.map(({ integration, check, skillInstalled, skillError }) => ({
                name: integration.name,
                title: integration.title,
                tool: integration.tool,
                state: check.state,
                ...(check.detail ? { detail: check.detail } : {}),
                ...(skillInstalled === undefined ? {} : { skillInstalled }),
                ...(skillError ? { skillError } : {}),
            })),
            tracker: options.tracker,
            ...(options.skillProviders ? { skillProviders: options.skillProviders } : {}),
            nextSteps: steps,
        }));
    } else {
        const lines = [
            `${'Integration'.padEnd(18)}${'Tool'.padEnd(10)}State`,
            ...results.map(({ integration, check }) => `${integration.name.padEnd(18)}${integration.tool.padEnd(10)}${STATE_LABELS[check.state]}`),
            '',
            `Task tracker: ${options.tracker ?? (options.trackerKnown === false ? 'unknown' : 'not chosen')}`,
        ];
        if (options.skillProviders && results.some((result) => result.skillInstalled)) {
            lines.push(`Usage skills installed for: ${options.skillProviders.join(', ')}`);
        }
        if (steps.length) lines.push('', 'Next steps:', ...steps.map((step) => `- ${step}`));
        console.log(lines.join('\n'));
    }
    return steps.length ? 2 : 0;
}

async function reportErrors(json: boolean, action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        if (!json) throw error;
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        process.exitCode = 1;
    }
}

const INTEGRATION_NAMES = 'Integrations (NAME): google-workspace (gog), github (gh), ticktick (ticktick).';

const SETUP_HELP = `happyherd setup - Connect Google Workspace, GitHub and TickTick on this machine

Usage:
  happyherd setup [NAME] [--tracker ticktick|github] [--json]
  happyherd setup [NAME] --project PROJECT --place PLACE [--tracker ticktick|github] [--json]
  happyherd setup google-workspace [--credentials FILE] [--gcloud-project ID] [--create-project] [--enable-apis]

${INTEGRATION_NAMES}

setup runs the tool's own check for each integration, or only NAME. It installs
a missing tool with Homebrew or npm, or names the install step, and copies the
tool's usage skill into the skills folder of Claude Code, and of Codex and
Antigravity when they are on this machine. In a terminal it then asks before
it starts each tool's own sign-in in your browser; each question says how to
skip it. Google Workspace is ready only when one sign-in grants Gmail,
Calendar, Drive, Docs, Sheets, Slides and Contacts.

A full run in a terminal ends by asking for the task tracker, then for the
place of each account Project's tasks in it: a TickTick list, or a GitHub
repository as OWNER/REPO. Run setup again to change them. --tracker sets the
tracker, and --project with --place sets one Project's place (by Project ID or
name), without a question. Both are kept with the account, so every machine
reads the same values; listing the Projects and reading or saving these needs
the account-control link (happyherd machine auth login). A second run skips
integrations that are ready.

The Google options go to gog auth setup.

With --json, or without a terminal, setup starts no sign-in and asks nothing.
It prints each integration's state and the next steps for the User.
Agents: always pass --json.
Exit status: 0 ready, 2 the User must act (see the next steps), 1 error.
HappyHerd stores no token: each tool keeps its own sign-in.

Onboarding checklist: https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/docs/onboarding.md
See also: happyherd integration --help, happyherd tracker --help`;

const INTEGRATION_HELP = `happyherd integration - Show the integrations on this machine

Usage:
  happyherd integration list [--json]
  happyherd integration check [NAME] [--json]

${INTEGRATION_NAMES}

list runs each tool's own check and shows each integration as ready, not signed
in or not installed, with the task tracker and the next steps. It always exits 0.
check does the same for NAME, or for every integration, and exits 0 only when
they are ready, otherwise 2. Neither changes anything.
Set an integration up with: happyherd setup NAME`;

const TRACKER_HELP = `happyherd tracker - Show the task tracker chosen for the account

Usage:
  happyherd tracker show [--project PROJECT] [--json]

The task tracker holds tasks and their state: ticktick or github. Each account
Project keeps its tasks in one place there: a TickTick list, or a GitHub
repository. Both are kept with the account and read through the account-control
link (happyherd machine auth login). show prints the tracker and each Project's
place, or one Project's (by Project ID or name), with null for what is not
chosen. It changes nothing.
Choose or change them by running happyherd setup in a terminal, or with
happyherd setup --tracker ticktick|github and --project PROJECT --place PLACE.
Read and write tasks with the tracker's own tool: ticktick or gh.`;

export async function handleSetupCommand(args: string[], dependencies: SetupDependencies = {}): Promise<void> {
    const json = args.includes('--json');
    await reportErrors(json, async () => {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                json: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
                tracker: { type: 'string' },
                project: { type: 'string' },
                place: { type: 'string' },
                credentials: { type: 'string' },
                'gcloud-project': { type: 'string' },
                'create-project': { type: 'boolean' },
                'enable-apis': { type: 'boolean' },
            },
        });
        if (values.help || positionals[0] === 'help') {
            console.log(SETUP_HELP);
            return;
        }
        if (positionals.length > 1) throw new Error('Usage: happyherd setup [NAME] [--tracker ticktick|github] [--json]');
        const name = positionals[0];
        const selected = select(name);
        if (values.tracker !== undefined && !isTracker(values.tracker)) {
            throw new Error(`Unknown task tracker: ${values.tracker}. Choose ticktick or github.`);
        }
        const google: GoogleOptions = {
            credentials: values.credentials,
            'gcloud-project': values['gcloud-project'],
            'create-project': values['create-project'],
            'enable-apis': values['enable-apis'],
        };
        if (name && name !== 'google-workspace' && Object.values(google).some((value) => value !== undefined)) {
            throw new Error('--credentials, --gcloud-project, --create-project and --enable-apis apply to google-workspace.');
        }
        const listProjects = dependencies.listProjects ?? listAccountProjects;

        // A pick or a place given as an option is saved with the account: check
        // the link, the tracker, the place and the Project before anything changes.
        let account: AccountSettings | undefined;
        let accountReason: string | undefined;
        let givenPlace: { tracker: Tracker; project: Project; place: string } | undefined;
        let projects: Project[] | undefined;
        if (values.project !== undefined || values.place !== undefined) {
            if (values.project === undefined || values.place === undefined) throw new Error('--project and --place go together.');
        }
        if (values.tracker !== undefined || values.project !== undefined) account = await readAccountSettings();
        if (values.project !== undefined && values.place !== undefined) {
            const tracker = (values.tracker as Tracker | undefined) ?? trackerOf(account);
            if (!tracker) throw new Error('Choose the task tracker with --tracker ticktick or --tracker github before a place.');
            const place = values.place.trim();
            if (!PLACES[tracker].valid(place)) throw new Error(`A ${PLACES[tracker].label} place looks like ${PLACES[tracker].example}.`);
            projects = await listProjects();
            const project = findProject(projects, values.project);
            if (!project) throw new Error(`No Project ${values.project} in this account. Run happyherd project list.`);
            givenPlace = { tracker, project, place };
        }

        const interactive = dependencies.interactive ?? (!json && process.stdin.isTTY === true && process.stdout.isTTY === true);
        const ask = dependencies.ask ?? askInTerminal;
        const say = (line: string) => { if (interactive) console.log(line); };
        const folders = skillFolders();
        const results: Result[] = [];
        for (const integration of selected) {
            const label = `${integration.title} (${integration.tool})`;
            let check = await integration.check();
            if (check.state === 'not-installed') {
                say(`${label}: installing with ${[integration.install.command, ...integration.install.args].join(' ')}`);
                const installed = await run(integration.install.command, integration.install.args, interactive ? 'terminal' : 'stderr');
                if (installed.code === 0) check = await integration.check();
            }
            const skillError = check.state === 'not-installed' ? undefined : await installSkill(integration, folders);
            say(`${label}: ${STATE_LABELS[check.state]}`);
            if (check.state === 'not-signed-in' && interactive && await integration.signIn({ google, check, ask })) {
                check = await integration.check();
                say(`${label}: ${STATE_LABELS[check.state]}`);
            }
            results.push({ integration, check, skillInstalled: check.state !== 'not-installed' && !skillError, skillError });
        }

        if (!account) ({ settings: account, reason: accountReason } = await tryAccountSettings());
        const saved = trackerOf(account);
        let tracker = saved;
        const placeSteps: string[] = [];
        let places: Places | undefined;
        if (account) {
            // In a terminal a full run always offers the pick, so running setup again changes it.
            // Options set the pick and a place without a question.
            const askTracker = interactive && !name && values.tracker === undefined && values.project === undefined;
            let pick = values.tracker as Tracker | undefined;
            if (askTracker) {
                while (!pick) {
                    const answer = (await ask(`Task tracker (ticktick or github, empty ${saved ? `keeps ${saved}` : 'to choose later'}): `))?.toLowerCase();
                    if (!answer) break;
                    if (isTracker(answer)) pick = answer;
                }
            }
            tracker = pick ?? saved;

            // The place of each account Project's tasks in the tracker.
            if (tracker && (!name || givenPlace?.tracker === tracker)) {
                let reason: string | undefined;
                if (!projects) {
                    try {
                        projects = await listProjects();
                    } catch (error) {
                        reason = error instanceof Error ? error.message : String(error);
                    }
                }
                if (projects) {
                    const current = placesOf(account, tracker);
                    const chosen: Places = Object.fromEntries(projects.map((project) => {
                        const place = givenPlace?.tracker === tracker && givenPlace.project.id === project.id ? givenPlace.place : current[project.id]?.place;
                        return [project.id, { name: project.name, ...(place ? { place } : {}) }];
                    }));
                    if (askTracker) {
                        for (const project of projects) {
                            const kept = chosen[project.id].place;
                            for (;;) {
                                const answer = await ask(`${PLACES[tracker].label}${tracker === 'github' ? ' (OWNER/REPO)' : ''} for Project ${project.name} (empty ${kept ? `keeps ${kept}` : 'skips'}): `);
                                if (!answer) break;
                                if (PLACES[tracker].valid(answer)) {
                                    chosen[project.id].place = answer;
                                    break;
                                }
                            }
                        }
                    }
                    if (JSON.stringify(chosen) !== JSON.stringify(current)) places = chosen;
                    if (!name) placeSteps.push(...projects.filter((project) => !chosen[project.id].place).map((project) => placeStep(tracker!, project)));
                } else {
                    placeSteps.push(`List the account's Projects to choose where each keeps its tasks, then run \`happyherd setup\` again. (${reason})`);
                }
            }

            if (tracker !== saved || places) {
                const pickToSave = tracker;
                const placesToSave = places;
                await updateAccountSettings((latest) => ({
                    ...latest,
                    taskTracker: pickToSave,
                    ...(placesToSave && pickToSave ? {
                        taskPlaces: { ...(latest.taskPlaces && typeof latest.taskPlaces === 'object' ? latest.taskPlaces : {}), [pickToSave]: placesToSave },
                    } : {}),
                }));
            }
        } else if (!name) {
            placeSteps.push(linkStep(accountReason));
        }

        if (interactive) console.log('');
        process.exitCode = report(results, {
            json,
            tracker,
            trackerKnown: account !== undefined,
            trackerStep: !name && account !== undefined,
            installAttempted: true,
            skillProviders: folders.map((folder) => folder.provider),
            moreSteps: placeSteps,
        });
    });
}

export async function handleIntegrationCommand(args: string[]): Promise<void> {
    const json = args.includes('--json');
    await reportErrors(json, async () => {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
        });
        const [action, name, ...extra] = positionals;
        if (values.help || action === undefined || action === 'help') {
            console.log(INTEGRATION_HELP);
            return;
        }
        if (action !== 'list' && action !== 'check') throw new Error(`Unknown integration command: ${action}`);
        if (extra.length > 0 || (action === 'list' && name !== undefined)) {
            throw new Error(`Usage: happyherd integration ${action === 'list' ? 'list' : 'check [NAME]'} [--json]`);
        }
        const selected = select(action === 'check' ? name : undefined);
        const [checks, account] = await Promise.all([
            Promise.all(selected.map((integration) => integration.check())),
            tryAccountSettings(),
        ]);
        const status = report(selected.map((integration, index) => ({ integration, check: checks[index] })), {
            json,
            tracker: trackerOf(account.settings),
            trackerKnown: account.settings !== undefined,
            trackerStep: action === 'list' && account.settings !== undefined,
            installAttempted: false,
            moreSteps: action === 'list' && !account.settings ? [linkStep(account.reason)] : [],
        });
        process.exitCode = action === 'check' ? status : 0;
    });
}

export async function handleTrackerCommand(args: string[]): Promise<void> {
    const json = args.includes('--json');
    await reportErrors(json, async () => {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, project: { type: 'string' } },
        });
        if (values.help || positionals[0] === undefined || positionals[0] === 'help') {
            console.log(TRACKER_HELP);
            return;
        }
        if (positionals[0] !== 'show' || positionals.length > 1) throw new Error('Usage: happyherd tracker show [--project PROJECT] [--json]');
        const account = await readAccountSettings();
        const tracker = trackerOf(account);
        const projects = Object.entries(tracker ? placesOf(account, tracker) : {})
            .map(([id, entry]) => ({ id, name: entry.name, place: entry.place ?? null }))
            .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
        const line = (project: { name: string; place: string | null }) => `${project.name}: ${project.place ?? 'not chosen'}`;
        if (values.project !== undefined) {
            const project = findProject(projects, values.project) ?? null;
            console.log(json ? JSON.stringify({ tracker, project }) : project ? line(project) : `No place is chosen for Project ${values.project}.`);
            return;
        }
        if (json) {
            console.log(JSON.stringify({ tracker, projects }));
            return;
        }
        console.log(tracker ? [tracker, ...projects.map(line)].join('\n') : `No task tracker is chosen. ${TRACKER_STEP}`);
    });
}
