import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SCOPED_ENV_KEYS } from './sessionEnvironment'

const mocks = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
  mockIsDaemonRunningCurrentlyInstalledHappyHerdVersion: vi.fn(),
  mockCheckIfDaemonRunningAndCleanupStaleState: vi.fn(),
  mockSpawnHappyHerdCLI: vi.fn(),
}))

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: mocks.mockLoggerDebug,
  },
}))

vi.mock('./controlClient', () => ({
  isDaemonRunningCurrentlyInstalledHappyHerdVersion: mocks.mockIsDaemonRunningCurrentlyInstalledHappyHerdVersion,
  checkIfDaemonRunningAndCleanupStaleState: mocks.mockCheckIfDaemonRunningAndCleanupStaleState,
}))

vi.mock('@/utils/spawnHappyHerdCLI', () => ({
  spawnHappyHerdCLI: mocks.mockSpawnHappyHerdCLI,
}))

import { ensureDaemonRunning } from './ensureDaemonRunning'

describe('ensureDaemonRunning', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockSpawnHappyHerdCLI.mockReturnValue({
      unref: vi.fn(),
    })
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState.mockResolvedValue(true)
  })

  it('returns without spawning when the daemon is already running', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyHerdVersion.mockResolvedValue(true)

    await ensureDaemonRunning()

    expect(mocks.mockSpawnHappyHerdCLI).not.toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).not.toHaveBeenCalled()
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith(
      'Ensuring HappyHerd background service is running & matches our version...',
    )
  })

  it('starts the daemon and waits for readiness when the installed version is not running', async () => {
    const mockUnref = vi.fn()
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyHerdVersion.mockResolvedValue(false)
    mocks.mockSpawnHappyHerdCLI.mockReturnValue({
      unref: mockUnref,
    })
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    for (const key of SESSION_SCOPED_ENV_KEYS) {
      vi.stubEnv(key, `stale-${key}`)
    }
    vi.stubEnv('HAPPYHERD_SAFE_ENV', 'kept')

    await ensureDaemonRunning()

    expect(mocks.mockSpawnHappyHerdCLI).toHaveBeenCalledWith(['daemon', 'start-sync'], expect.objectContaining({
      detached: true,
      stdio: 'ignore',
      env: expect.objectContaining({ HAPPYHERD_SAFE_ENV: 'kept' }),
    }))
    const spawnedEnv = mocks.mockSpawnHappyHerdCLI.mock.calls[0][1].env
    for (const key of SESSION_SCOPED_ENV_KEYS) {
      expect(spawnedEnv).not.toHaveProperty(key)
    }
    expect(mockUnref).toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).toHaveBeenCalledTimes(2)
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('Starting HappyHerd background service...')
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('HappyHerd background service is ready')
  })
})
