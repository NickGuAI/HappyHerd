import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockAuthAndSetupMachineIfNeeded: vi.fn(),
  mockRunCodex: vi.fn(),
  mockExtractCodexResumeFlag: vi.fn(),
  mockExtractNoSandboxFlag: vi.fn(),
  mockEnsureDaemonRunning: vi.fn(),
  mockActivateCredentialAccount: vi.fn(),
  mockCodexHelpSpawnSync: vi.fn(),
}))

vi.mock('@/ui/auth', () => ({
  authAndSetupMachineIfNeeded: mocks.mockAuthAndSetupMachineIfNeeded,
}))

vi.mock('@/codex/runCodex', () => ({
  runCodex: mocks.mockRunCodex,
}))

vi.mock('@/codex/cliArgs', () => ({
  extractCodexResumeFlag: mocks.mockExtractCodexResumeFlag,
}))

vi.mock('@/utils/sandboxFlags', () => ({
  extractNoSandboxFlag: mocks.mockExtractNoSandboxFlag,
}))

vi.mock('@/daemon/ensureDaemonRunning', () => ({
  ensureDaemonRunning: mocks.mockEnsureDaemonRunning,
}))

vi.mock('@/credentialPool/activate', () => ({
  activateCredentialAccount: mocks.mockActivateCredentialAccount,
}))

vi.mock('cross-spawn', () => ({
  default: { sync: mocks.mockCodexHelpSpawnSync },
}))

import { handleCodexCommand } from './codexCommand'

describe('handleCodexCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockAuthAndSetupMachineIfNeeded.mockResolvedValue({
      credentials: { token: 'token' },
    })
    mocks.mockExtractNoSandboxFlag.mockImplementation((args: string[]) => ({
      noSandbox: false,
      args,
    }))
    mocks.mockExtractCodexResumeFlag.mockImplementation((args: string[]) => ({
      resumeThreadId: null,
      args,
    }))
    mocks.mockEnsureDaemonRunning.mockResolvedValue(undefined)
    mocks.mockActivateCredentialAccount.mockResolvedValue({ type: 'unconfigured' })
    mocks.mockRunCodex.mockResolvedValue(undefined)
    mocks.mockCodexHelpSpawnSync.mockReturnValue({ status: 0 })
  })

  it('ensures the daemon is running before starting a codex session', async () => {
    await handleCodexCommand(['--started-by', 'terminal'])

    expect(mocks.mockEnsureDaemonRunning).toHaveBeenCalledTimes(1)
    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'terminal',
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: undefined,
      model: undefined,
      effort: undefined,
    })
    expect(
      mocks.mockEnsureDaemonRunning.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.mockRunCodex.mock.invocationCallOrder[0])
    expect(mocks.mockActivateCredentialAccount).toHaveBeenCalledWith('codex')
  })

  it('does not activate a named account for an explicitly unmanaged Codex home', async () => {
    await handleCodexCommand([
      '--started-by', 'daemon',
      '--provider-account-mode', 'unmanaged',
    ])

    expect(mocks.mockActivateCredentialAccount).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'daemon',
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: undefined,
      model: undefined,
      effort: undefined,
    })
  })

  it('shows native Codex help without authentication or daemon startup', async () => {
    const showNativeHelp = vi.fn()

    await handleCodexCommand(['--help'], { showNativeHelp })

    expect(showNativeHelp).toHaveBeenCalledTimes(1)
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockEnsureDaemonRunning).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
  })

  it('uses the cross-platform launcher for native Codex help', async () => {
    await handleCodexCommand(['--help'])

    expect(mocks.mockCodexHelpSpawnSync).toHaveBeenCalledWith(
      'codex',
      ['--help'],
      { stdio: 'inherit', windowsHide: true },
    )
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockEnsureDaemonRunning).not.toHaveBeenCalled()
  })

  it('passes parsed no-sandbox and resume flags through to runCodex', async () => {
    mocks.mockExtractNoSandboxFlag.mockReturnValue({
      noSandbox: true,
      args: ['--resume', 'thread-123', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexResumeFlag.mockReturnValue({
      resumeThreadId: 'thread-123',
      args: ['--started-by', 'daemon'],
    })

    await handleCodexCommand(['--no-sandbox', '--resume', 'thread-123', '--started-by', 'daemon'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'daemon',
      noSandbox: true,
      resumeThreadId: 'thread-123',
      permissionMode: undefined,
      model: undefined,
      effort: undefined,
    })
  })

  it('passes permission-mode through to runCodex', async () => {
    await handleCodexCommand(['--permission-mode', 'yolo'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: undefined,
      effort: undefined,
    })
  })

  it('rejects a Claude-only permission mode before starting Codex', async () => {
    await expect(handleCodexCommand(['--permission-mode', 'plan']))
      .rejects.toThrow('Unsupported Codex permission mode: plan')

    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
  })

  it('maps --yolo to codex yolo permission mode', async () => {
    await handleCodexCommand(['--yolo'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: undefined,
      effort: undefined,
    })
  })

  it('passes model and effort through to runCodex', async () => {
    await handleCodexCommand(['--model', 'gpt-5.4', '--effort', 'xhigh'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: undefined,
      model: 'gpt-5.4',
      effort: 'xhigh',
    })
  })
})
