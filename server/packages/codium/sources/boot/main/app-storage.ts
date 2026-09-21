import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function happyherdHomeName(platform: NodeJS.Platform = process.platform): 'Happy' | 'happy' {
    return platform === 'linux' ? 'happy' : 'Happy'
}

export function happyHomeDir(
    platform: NodeJS.Platform = process.platform,
    homeDir: string = homedir(),
): string {
    return join(homeDir, happyherdHomeName(platform))
}

export function ensureHappyHerdHomeDir(): string {
    const dir = happyHomeDir()
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
}

export function stateDatabasePath(): string {
    return join(ensureHappyHerdHomeDir(), 'state.sqlite')
}

export function workspacesRootDir(): string {
    return join(ensureHappyHerdHomeDir(), 'workspaces')
}

export function projectWorkspacesDir(projectName: string): string {
    return join(workspacesRootDir(), projectName)
}

export function storageFilePath(filename: string): string {
    return join(ensureHappyHerdHomeDir(), filename)
}
