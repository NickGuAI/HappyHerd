import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { runCodex } from '@/codex/runCodex'
import { extractCodexResumeFlag } from '@/codex/cliArgs'
import { extractNoSandboxFlag } from '@/utils/sandboxFlags'
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning'
import type { PermissionMode } from '@/api/types'
import type { ReasoningEffort } from '@/codex/codexAppServerTypes'
import spawn from 'cross-spawn'
import { activateCredentialAccount } from '@/credentialPool/activate'
import { parseCodexRemotePermissionMode } from '@/codex/codexTurnRouting'

export interface CodexCommandDependencies {
  showNativeHelp?: () => void
}

export async function handleCodexCommand(
  args: string[],
  dependencies: CodexCommandDependencies = {},
): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    const showNativeHelp = dependencies.showNativeHelp ?? (() => {
      const result = spawn.sync('codex', ['--help'], { stdio: 'inherit', windowsHide: true })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`Codex help exited with status ${result.status ?? 'unknown'}`)
    })
    showNativeHelp()
    return
  }
  let startedBy: 'daemon' | 'terminal' | undefined = undefined
  let permissionMode: PermissionMode | undefined = undefined
  let model: string | undefined = undefined
  let effort: ReasoningEffort | undefined = undefined
  const sandboxArgs = extractNoSandboxFlag(args)
  const codexArgs = extractCodexResumeFlag(sandboxArgs.args)

  for (let i = 0; i < codexArgs.args.length; i++) {
    if (codexArgs.args[i] === '--started-by') {
      startedBy = codexArgs.args[++i] as 'daemon' | 'terminal'
    } else if (codexArgs.args[i] === '--permission-mode') {
      const value = codexArgs.args[++i]
      const parsed = value ? parseCodexRemotePermissionMode(value) : null
      if (!parsed) throw new Error(`Unsupported Codex permission mode: ${value ?? ''}`)
      permissionMode = parsed
    } else if (codexArgs.args[i] === '--model') {
      model = codexArgs.args[++i]
    } else if (codexArgs.args[i] === '--effort') {
      effort = codexArgs.args[++i] as ReasoningEffort
    } else if (codexArgs.args[i] === '--yolo') {
      permissionMode = 'yolo'
    }
  }

  const { credentials } = await authAndSetupMachineIfNeeded()
  await ensureDaemonRunning()
  await activateCredentialAccount('codex')

  await runCodex({
    credentials,
    startedBy,
    noSandbox: sandboxArgs.noSandbox,
    resumeThreadId: codexArgs.resumeThreadId ?? undefined,
    permissionMode,
    model,
    effort,
  })
}
