export type HappyHerdAuthStatus =
    | 'starting'
    | 'unconfigured'
    | 'authenticating'
    | 'authenticated'
    | 'error'

export type HappyHerdAuthMethod = 'link-device' | 'create-account' | 'restore-secret'

export interface HappyHerdAuthFlowSnapshot {
    method: HappyHerdAuthMethod
    authUrl?: string
    publicKey?: string
    startedAt: number
}

export interface HappyHerdStateSnapshot {
    status: HappyHerdAuthStatus
    serverUrl: string
    webappUrl: string
    clientReady: boolean
    accountId?: string
    tokenExpiresAt?: number
    authFlow?: HappyHerdAuthFlowSnapshot
    error?: string
    updatedAt: number
}

export interface HappyHerdAuthenticatedClientStatus {
    ready: boolean
    serverUrl: string
    accountId?: string
    anonId?: string
    contentPublicKey?: string
}

export type HappyHerdWorkerRequest =
    | { kind: 'getState' }
    | { kind: 'createAccount' }
    | { kind: 'startLinkDevice' }
    | { kind: 'restoreSecret'; secretKey: string }
    | { kind: 'cancelAuth' }
    | { kind: 'logout' }
    | { kind: 'clientStatus' }

export type HappyHerdWorkerRequestWithId = HappyHerdWorkerRequest & { requestId: string }

export type HappyHerdWorkerResponse =
    | {
          kind: 'response'
          requestId: string
          ok: true
          state: HappyHerdStateSnapshot
          value?: unknown
      }
    | {
          kind: 'response'
          requestId: string
          ok: false
          state: HappyHerdStateSnapshot
          error: string
      }

export type HappyHerdWorkerStateMessage = {
    kind: 'state'
    state: HappyHerdStateSnapshot
}

export type HappyHerdWorkerFatalMessage = {
    kind: 'fatal'
    error: string
}

export type HappyHerdWorkerMessage =
    | HappyHerdWorkerResponse
    | HappyHerdWorkerStateMessage
    | HappyHerdWorkerFatalMessage
