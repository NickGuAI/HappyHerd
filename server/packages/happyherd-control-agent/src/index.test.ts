import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { resolve, dirname, join } from 'path';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { testCliEnvironment } from './test-support/cliEnvironment';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(__dirname, '..', 'bin', 'happyherd-control-agent.mjs');

function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const home = mkdtempSync(join(tmpdir(), 'control-cli-index-'));
    try {
        const stdout = execFileSync(process.execPath, [
            '--no-warnings',
            '--no-deprecation',
            binPath,
            ...args,
        ], { encoding: 'utf-8', env: testCliEnvironment(home, 'http://127.0.0.1:1') });
        return { stdout, stderr: '', exitCode: 0 };
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? '',
            exitCode: e.status ?? 1,
        };
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

describe('happy-agent CLI', () => {
    it.each(['status', 'create', 'logout'])('isolates %s from inherited authenticated homes', (command) => {
        const home = mkdtempSync(join(tmpdir(), 'control-parent-home-'));
        const credential = join(home, 'agent.key');
        const bytes = JSON.stringify({ token: 'synthetic-parent-token', secret: Buffer.alloc(32, 7).toString('base64') });
        writeFileSync(credential, bytes);
        vi.stubEnv('HAPPYHERD_HOME_DIR', home);
        vi.stubEnv('HAPPYHERD_SERVER_URL', 'http://127.0.0.1:1');
        /* rename:preserve */
        vi.stubEnv('HAPPY_HOME_DIR', home);
        vi.stubEnv('HAPPY_SERVER_URL', 'http://127.0.0.1:1');
        /* /rename:preserve */
        try {
            if (command === 'create') {
                const result = runCli('create', '--tag', 'isolated-test');
                expect(result.exitCode).not.toBe(0);
                expect(result.stderr).toContain('happy-agent auth login');
            } else {
                const result = runCli('auth', command);
                expect(result.exitCode).toBe(0);
                expect(result.stdout).toContain(command === 'status' ? 'Not authenticated' : 'Logged out');
            }
            expect(readFileSync(credential, 'utf8')).toBe(bytes);
        } finally {
            vi.unstubAllEnvs();
            rmSync(home, { recursive: true, force: true });
        }
    });

    it('should display help output', () => {
        const { stdout } = runCli('--help');
        expect(stdout).toContain('happyherd-control-agent');
        expect(stdout).toContain('CLI client for controlling HappyHerd Coder agents remotely');
    });

    it('should display version', () => {
        const { stdout } = runCli('--version');
        expect(stdout.trim()).toBe('0.1.0');
    });

    it('should list all expected commands in help', () => {
        const { stdout } = runCli('--help');
        expect(stdout).toContain('auth');
        expect(stdout).toContain('machines');
        expect(stdout).toContain('list');
        expect(stdout).toContain('status');
        expect(stdout).toContain('spawn');
        expect(stdout).toContain('resume');
        expect(stdout).toContain('create');
        expect(stdout).toContain('send');
        expect(stdout).toContain('history');
        expect(stdout).toContain('stop');
        expect(stdout).toContain('wait');
    });

    describe('list command', () => {
        it('should show list help with --active and --json options', () => {
            const { stdout } = runCli('list', '--help');
            expect(stdout).toContain('List all sessions');
            expect(stdout).toContain('--active');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('list');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('machines command', () => {
        it('should show machines help with --active and --json options', () => {
            const { stdout } = runCli('machines', '--help');
            expect(stdout).toContain('List all machines');
            expect(stdout).toContain('--active');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('machines');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('status command', () => {
        it('should show status help with session-id argument and --json option', () => {
            const { stdout } = runCli('status', '--help');
            expect(stdout).toContain('session-id');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('status', 'fake-session-id');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('create command', () => {
        it('should show create help with --tag, --path, and --json options', () => {
            const { stdout } = runCli('create', '--help');
            expect(stdout).toContain('Create a new session');
            expect(stdout).toContain('--tag');
            expect(stdout).toContain('--path');
            expect(stdout).toContain('--json');
        });

        it('should require --tag option', () => {
            const { stderr, exitCode } = runCli('create');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('--tag');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('create', '--tag', 'my-tag');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('spawn command', () => {
        it('should show spawn help with machine, path, agent, and json options', () => {
            const { stdout } = runCli('spawn', '--help');
            expect(stdout).toContain('Spawn a new session on a machine');
            expect(stdout).toContain('--machine');
            expect(stdout).toContain('--path');
            expect(stdout).toContain('--agent');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('spawn', '--machine', 'fake-machine');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('resume command', () => {
        it('should show resume help with session-id argument and --json option', () => {
            const { stdout } = runCli('resume', '--help');
            expect(stdout).toContain('Resume a session on its original machine');
            expect(stdout).toContain('session-id');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('resume', 'fake-id');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('send command', () => {
        it('should show send help with session-id, message arguments and --yolo, --wait, --json options', () => {
            const { stdout } = runCli('send', '--help');
            expect(stdout).toContain('Send a message to a session');
            expect(stdout).toContain('session-id');
            expect(stdout).toContain('message');
            expect(stdout).toContain('--yolo');
            expect(stdout).toContain('--wait');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('send', 'fake-id', 'hello');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('history command', () => {
        it('should show history help with session-id argument, --limit, and --json options', () => {
            const { stdout } = runCli('history', '--help');
            expect(stdout).toContain('Read message history');
            expect(stdout).toContain('session-id');
            expect(stdout).toContain('--limit');
            expect(stdout).toContain('--json');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('history', 'fake-id');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('stop command', () => {
        it('should show stop help with session-id argument', () => {
            const { stdout } = runCli('stop', '--help');
            expect(stdout).toContain('Stop a session');
            expect(stdout).toContain('session-id');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('stop', 'fake-id');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });

    describe('wait command', () => {
        it('should show wait help with session-id argument and --timeout option', () => {
            const { stdout } = runCli('wait', '--help');
            expect(stdout).toContain('Wait for agent to become idle');
            expect(stdout).toContain('session-id');
            expect(stdout).toContain('--timeout');
        });

        it('should fail with auth error when not authenticated', () => {
            const { stderr, exitCode } = runCli('wait', 'fake-id');
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain('happyherd-control-agent auth login');
        });
    });
});
