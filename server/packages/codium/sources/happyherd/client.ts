import { useSyncExternalStore } from 'react'
import type {
    HappyHerdAuthenticatedClientStatus,
    HappyHerdStateSnapshot,
} from '@/shared/happyherd-protocol'

const initialState: HappyHerdStateSnapshot = {
    status: 'starting',
    serverUrl: '',
    webappUrl: '',
    clientReady: false,
    updatedAt: Date.now(),
}

let snapshot = initialState
let unsubscribeIpc: (() => void) | null = null
let initialized = false
const listeners = new Set<() => void>()

function emit(next: HappyHerdStateSnapshot): void {
    snapshot = next
    for (const listener of listeners) listener()
}

function setError(message: string): void {
    emit({
        ...snapshot,
        status: 'error',
        error: message,
        updatedAt: Date.now(),
    })
}

function ensureStarted(): void {
    if (initialized) return
    initialized = true
    try {
        unsubscribeIpc = window.happyherd.onState(emit)
        void window.happyherd.getState().then(emit).catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
        })
    } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
    }
}

export const happyherdClient = {
    start(): void {
        ensureStarted()
    },
    getSnapshot(): HappyHerdStateSnapshot {
        return snapshot
    },
    subscribe(listener: () => void): () => void {
        ensureStarted()
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
            if (listeners.size === 0 && unsubscribeIpc) {
                unsubscribeIpc()
                unsubscribeIpc = null
                initialized = false
            }
        }
    },
    async createAccount(): Promise<HappyHerdStateSnapshot> {
        ensureStarted()
        const next = await window.happyherd.createAccount()
        emit(next)
        return next
    },
    async startLinkDevice(): Promise<HappyHerdStateSnapshot> {
        ensureStarted()
        const next = await window.happyherd.startLinkDevice()
        emit(next)
        return next
    },
    async restoreSecret(secretKey: string): Promise<HappyHerdStateSnapshot> {
        ensureStarted()
        const next = await window.happyherd.restoreSecret(secretKey)
        emit(next)
        return next
    },
    async cancelAuth(): Promise<HappyHerdStateSnapshot> {
        ensureStarted()
        const next = await window.happyherd.cancelAuth()
        emit(next)
        return next
    },
    async logout(): Promise<HappyHerdStateSnapshot> {
        ensureStarted()
        const next = await window.happyherd.logout()
        emit(next)
        return next
    },
    async clientStatus(): Promise<HappyHerdAuthenticatedClientStatus> {
        ensureStarted()
        return window.happyherd.clientStatus()
    },
}

export function useHappyHerdState(): HappyHerdStateSnapshot {
    return useSyncExternalStore(
        happyherdClient.subscribe,
        happyherdClient.getSnapshot,
        happyherdClient.getSnapshot,
    )
}
