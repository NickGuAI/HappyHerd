export type AcpAgentConfig = {
  command: string;
  args: string[];
};

export const KNOWN_ACP_AGENTS: Record<string, AcpAgentConfig> = {
  dsh: { command: 'dsh', args: ['--profile', 'acp'] },
  gemini: { command: 'gemini', args: ['--experimental-acp'] },
  grok: { command: 'grok', args: ['--no-auto-update', 'agent', 'stdio'] },
  opencode: { command: 'opencode', args: ['acp'] },
};

const GROK_CHILD_ENV_KEYS = [
  // Local-login discovery and the process essentials verified by the ACP probe.
  'HOME', 'USERPROFILE', 'PATH', 'Path', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM',
  // Windows process essentials.
  'COMSPEC', 'ComSpec', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'APPDATA', 'LOCALAPPDATA',
  // Grok's local-home override and direct API authentication input.
  'GROK_HOME', 'XAI_API_KEY',
] as const;

/** Give Grok only its process essentials and documented authentication inputs. */
export function sanitizeGrokChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of GROK_CHILD_ENV_KEYS) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  return childEnv;
}

export type ResolvedAcpAgentConfig = {
  agentName: string;
  command: string;
  args: string[];
};

export type AcpLaunchConfig = ResolvedAcpAgentConfig & {
  startedBy?: 'daemon' | 'terminal';
  verbose: boolean;
  permissionMode?: string;
  model?: string;
  effort?: string;
  resumeSessionId?: string;
};

/** Identify the exact maintained dsh ACP invocation, with no passthrough arguments. */
export function usesBuiltInDshAcpProfile(config: ResolvedAcpAgentConfig): boolean {
  return config.agentName === 'dsh'
    && config.command === KNOWN_ACP_AGENTS.dsh.command
    && config.args.length === KNOWN_ACP_AGENTS.dsh.args.length
    && config.args.every((arg, index) => arg === KNOWN_ACP_AGENTS.dsh.args[index]);
}

/** Parse Happy-owned wrapper flags without leaking them into the ACP provider command. */
export function resolveAcpLaunchConfig(
  cliArgs: string[],
  namedAgent?: keyof typeof KNOWN_ACP_AGENTS,
): AcpLaunchConfig {
  let startedBy: 'daemon' | 'terminal' | undefined;
  let verbose = false;
  let permissionMode: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  let resumeSessionId: string | undefined;
  const providerArgs: string[] = namedAgent ? [namedAgent] : [];
  let customCommandMode = false;

  const takeValue = (index: number, flag: string): string => {
    const value = cliArgs[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    return value;
  };

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (!customCommandMode && arg === '--started-by') {
      startedBy = takeValue(i, arg) as 'daemon' | 'terminal';
      i++;
      continue;
    }
    if (!customCommandMode && arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (!customCommandMode && arg === '--happy-starting-mode') {
      takeValue(i, arg);
      i++;
      continue;
    }
    if ((namedAgent === 'grok' || namedAgent === 'dsh') && !customCommandMode && arg === '--permission-mode') {
      permissionMode = takeValue(i, arg);
      i++;
      continue;
    }
    if ((namedAgent === 'grok' || namedAgent === 'dsh') && !customCommandMode && arg === '--model') {
      model = takeValue(i, arg);
      i++;
      continue;
    }
    if ((namedAgent === 'grok' || namedAgent === 'dsh') && !customCommandMode && arg === '--effort') {
      effort = takeValue(i, arg);
      i++;
      continue;
    }
    if ((namedAgent === 'grok' || namedAgent === 'dsh') && !customCommandMode && arg === '--resume') {
      resumeSessionId = takeValue(i, arg);
      i++;
      continue;
    }
    if (arg === '--') customCommandMode = true;
    if (namedAgent) {
      throw new Error(`Unexpected argument for happyherd ${namedAgent}: ${arg}`);
    }
    providerArgs.push(arg);
  }

  const resolved = resolveAcpAgentConfig(providerArgs);
  const resolvedArgs = namedAgent === 'grok' && permissionMode
    ? [
      ...resolved.args.slice(0, 1),
      '--permission-mode',
      permissionMode,
      ...resolved.args.slice(1),
    ]
    : resolved.args;

  return {
    ...resolved,
    args: resolvedArgs,
    startedBy,
    verbose,
    permissionMode,
    model,
    effort,
    resumeSessionId,
  };
}

export function resolveAcpAgentConfig(cliArgs: string[]): ResolvedAcpAgentConfig {
  if (cliArgs.length === 0) {
    throw new Error('Usage: happyherd acp <agent-name> or happyherd acp -- <command> [args]');
  }

  if (cliArgs[0] === '--') {
    const command = cliArgs[1];
    if (!command) {
      throw new Error('Missing command after "--". Usage: happyherd acp -- <command> [args]');
    }
    return {
      agentName: command,
      command,
      args: cliArgs.slice(2),
    };
  }

  const agentName = cliArgs[0];
  const known = KNOWN_ACP_AGENTS[agentName];
  if (known) {
    const passthroughArgs = cliArgs
      .slice(1)
      // Backward-compatible with old OpenCode docs/flags.
      .filter((arg) => !(agentName === 'opencode' && arg === '--acp'));
    return {
      agentName,
      command: known.command,
      args: [...known.args, ...passthroughArgs],
    };
  }

  return {
    agentName,
    command: agentName,
    args: cliArgs.slice(1),
  };
}
