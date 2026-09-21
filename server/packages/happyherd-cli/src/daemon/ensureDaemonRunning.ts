import { logger } from '@/ui/logger'
import { checkIfDaemonRunningAndCleanupStaleState, isDaemonRunningCurrentlyInstalledHappyHerdVersion } from './controlClient'
import { spawnHappyHerdCLI } from '@/utils/spawnHappyHerdCLI'
import { sanitizeSessionEnvironment } from './sessionEnvironment'

const DAEMON_READY_TIMEOUT_MS = 5000
const DAEMON_READY_POLL_INTERVAL_MS = 100

export async function ensureDaemonRunning(): Promise<void> {
  logger.debug('Ensuring HappyHerd background service is running & matches our version...')

  if (await isDaemonRunningCurrentlyInstalledHappyHerdVersion()) {
    return
  }

  logger.debug('Starting HappyHerd background service...')

  const daemonProcess = spawnHappyHerdCLI(['daemon', 'start-sync'], {
    detached: true,
    stdio: 'ignore',
    env: sanitizeSessionEnvironment(process.env),
  })
  daemonProcess.unref()

  // Wait for the spawned daemon to be fully ready: it must write daemon.state.json,
  // bind its HTTP port, and respond to a health ping. Without this, early callers
  // (e.g. notifyDaemonSessionStarted) race the daemon startup and the webhook is
  // silently lost — which later breaks resume-happy-session.
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await checkIfDaemonRunningAndCleanupStaleState()) {
      logger.debug('HappyHerd background service is ready')
      return
    }
    await new Promise(resolve => setTimeout(resolve, DAEMON_READY_POLL_INTERVAL_MS))
  }

  logger.debug(`HappyHerd background service did not become ready within ${DAEMON_READY_TIMEOUT_MS}ms; continuing anyway`)
}
