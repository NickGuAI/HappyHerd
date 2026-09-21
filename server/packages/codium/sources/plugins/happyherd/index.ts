import { happyherdClient } from '@/happyherd/client'
import type {
    AuthState,
    Capability,
    Plugin,
    PluginContext,
} from '../types'
import type { HappyHerdStateSnapshot } from '@/shared/happyherd-protocol'

function mapAuth(state: HappyHerdStateSnapshot): AuthState {
    switch (state.status) {
        case 'authenticated':
            return { status: 'connected', account: state.accountId }
        case 'authenticating':
        case 'starting':
            return { status: 'connecting' }
        case 'error':
            return { status: 'error', message: state.error ?? 'HappyHerd authentication failed' }
        case 'unconfigured':
            return { status: 'unconfigured' }
    }
}

class HappyHerdPlugin implements Plugin {
    id = 'happyherd'
    name = 'HappyHerd'
    description = 'Encrypted HappyHerd account connection for future sync and remote session support.'
    vendor = 'HappyHerd'
    category = 'integrations' as const
    accent = '#2563eb'

    private auth: AuthState = { status: 'connecting' }
    private capabilities: Capability[] = []
    private unsubscribe: (() => void) | null = null

    async activate(ctx: PluginContext) {
        happyherdClient.start()
        this.auth = mapAuth(happyherdClient.getSnapshot())
        this.unsubscribe = happyherdClient.subscribe(() => {
            this.auth = mapAuth(happyherdClient.getSnapshot())
            ctx.onAuthChanged()
        })
    }

    async connect(_credential: string, ctx: PluginContext): Promise<AuthState> {
        this.auth = { status: 'connecting' }
        ctx.onAuthChanged()
        const next = await happyherdClient.startLinkDevice()
        this.auth = mapAuth(next)
        ctx.onAuthChanged()
        return this.auth
    }

    async disconnect(ctx: PluginContext) {
        await happyherdClient.logout()
        this.auth = mapAuth(happyherdClient.getSnapshot())
        ctx.onAuthChanged()
    }

    getAuthState(): AuthState { return this.auth }
    getCapabilities(): readonly Capability[] { return this.capabilities }

    dispose(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
    }
}

export const happyherdPlugin: Plugin = new HappyHerdPlugin()
