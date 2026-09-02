import { execSync } from 'child_process';
import os from 'os';
import { findAgyBin } from '@/agy/constants';

export interface CLIAvailability {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  grok: boolean;
  dsh: boolean;
  agy: boolean;
  detectedAt: number;
}

/**
 * Detects which CLI tools are available on this machine.
 * Cross-platform: uses `command -v` on POSIX, `Get-Command` on Windows.
 */
export function detectCLIAvailability(): CLIAvailability {
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    return detectWindows();
  }
  return detectPosix();
}

function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${command} >/dev/null 2>&1`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectPosix(): CLIAvailability {
  const claude = commandExists('claude');
  const codex = commandExists('codex');
  const gemini = commandExists('gemini');
  const grok = commandExists('grok');
  const dsh = commandExists('dsh');
  const agy = findAgyBin() !== undefined;

  return { claude, codex, gemini, grok, dsh, agy, detectedAt: Date.now() };
}

function detectWindows(): CLIAvailability {
  const checkCommand = (name: string): boolean => {
    try {
      execSync(`powershell -NoProfile -Command "Get-Command ${name} -ErrorAction SilentlyContinue"`, { stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  };

  const claude = checkCommand('claude');
  const codex = checkCommand('codex');
  const gemini = checkCommand('gemini');
  const grok = checkCommand('grok');
  const dsh = checkCommand('dsh');
  const agy = findAgyBin() !== undefined;

  return { claude, codex, gemini, grok, dsh, agy, detectedAt: Date.now() };
}
