import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api';
import axios from 'axios';
import { connectionState } from '@/utils/serverConnectionErrors';

// Use vi.hoisted to ensure mock functions are available when vi.mock factory runs
const { mockGet, mockPost, mockIsAxiosError, mockDecrypt } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPost: vi.fn(),
    mockIsAxiosError: vi.fn(() => true),
    mockDecrypt: vi.fn((_: unknown, __: unknown, data: unknown) => data),
}));

vi.mock('axios', () => ({
    default: {
        get: mockGet,
        post: mockPost,
        isAxiosError: mockIsAxiosError
    },
    isAxiosError: mockIsAxiosError
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn()
    }
}));

// Mock encryption utilities
vi.mock('./encryption', () => ({
    decodeBase64: vi.fn((data: string) => data),
    encodeBase64: vi.fn((data: any) => data),
    decrypt: mockDecrypt,
    encrypt: vi.fn((_: unknown, __: unknown, data: any) => data)
}));

// Mock configuration
vi.mock('@/configuration', () => ({
    configuration: {
        serverUrl: 'https://api.example.com',
        currentCliVersion: '1.0.0',
    }
}));

// Mock libsodium encryption
vi.mock('./libsodiumEncryption', () => ({
    libsodiumEncryptForPublicKey: vi.fn((data: any) => new Uint8Array(32))
}));

// Global test metadata
const testMetadata = {
    path: '/tmp',
    host: 'localhost',
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happy',
    happyLibDir: '/home/user/.happy/lib',
    happyToolsDir: '/home/user/.happy/tools'
};

const testMachineMetadata = {
    host: 'localhost',
    platform: 'darwin',
    happyCliVersion: '1.0.0',
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happy',
    happyLibDir: '/home/user/.happy/lib'
};

describe('Api server error handling', () => {
    let api: ApiClient;

    beforeEach(async () => {
        vi.clearAllMocks();
        connectionState.reset(); // Reset offline state between tests

        // Create a mock credential
        const mockCredential = {
            token: 'fake-token',
            encryption: {
                type: 'legacy' as const,
                secret: new Uint8Array(32)
            }
        };

        api = await ApiClient.create(mockCredential);
    });

    describe('getOrCreateSession', () => {
        it('should return null when Happy server is unreachable (ECONNREFUSED)', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to throw connection refused error
            mockPost.mockRejectedValue({ code: 'ECONNREFUSED' });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );

            consoleSpy.mockRestore();
        });

        it('should return null when Happy server cannot be found (ENOTFOUND)', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to throw DNS resolution error
            mockPost.mockRejectedValue({ code: 'ENOTFOUND' });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );

            consoleSpy.mockRestore();
        });

        it('should return null when Happy server times out (ETIMEDOUT)', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to throw timeout error
            mockPost.mockRejectedValue({ code: 'ETIMEDOUT' });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );

            consoleSpy.mockRestore();
        });

        it('should return null when session endpoint returns 404', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to return 404
            mockPost.mockRejectedValue({
                response: { status: 404 },
                isAxiosError: true
            });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            // New unified format via connectionState.fail()
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Session creation failed: 404')
            );

            consoleSpy.mockRestore();
        });

        it('should return null when server returns 500 Internal Server Error', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to return 500 error
            mockPost.mockRejectedValue({
                response: { status: 500 },
                isAxiosError: true
            });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );
            consoleSpy.mockRestore();
        });

        it('should return null when server returns 503 Service Unavailable', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to return 503 error
            mockPost.mockRejectedValue({
                response: { status: 503 },
                isAxiosError: true
            });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );
            consoleSpy.mockRestore();
        });

        it('should re-throw non-connection errors', async () => {
            // Mock axios to throw a different type of error (e.g., authentication error)
            const authError = new Error('Invalid API key');
            (authError as any).code = 'UNAUTHORIZED';
            mockPost.mockRejectedValue(authError);

            await expect(
                api.getOrCreateSession({ tag: 'test-tag', metadata: testMetadata, state: null })
            ).rejects.toThrow('Failed to get or create session: Invalid API key');

            // Should not show the offline mode message
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            expect(consoleSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );
            consoleSpy.mockRestore();
        });
    });

    describe('refreshSessionForReconnect', () => {
        it('refreshes queue-owning AgentState beyond the first cursor page and merges current process metadata', async () => {
            const encryptionKey = new Uint8Array(32);
            mockPost.mockResolvedValue({ data: { success: true } });
            mockGet
                .mockResolvedValueOnce({
                    data: {
                        sessions: [{ id: 'newer-session' }],
                        nextCursor: 'cursor_v1_newer-session',
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        sessions: [{
                            id: 'session-1',
                            seq: 42,
                            metadata: 'encrypted-metadata',
                            metadataVersion: 7,
                            agentState: 'encrypted-agent-state',
                            agentStateVersion: 9,
                        }],
                        nextCursor: null,
                    },
                });
            mockDecrypt
                .mockReturnValueOnce({ ...testMetadata, claudeSessionId: 'claude-1', hostPid: 1 })
                .mockReturnValueOnce({
                    messageQueue: {
                        pendingMessageIds: ['queued-2'],
                        currentMessageIds: ['queued-1'],
                    },
                });

            const result = await api.refreshSessionForReconnect({
                id: 'session-1',
                seq: 10,
                encryptionKey,
                encryptionVariant: 'legacy',
                metadata: { ...testMetadata, hostPid: 99 },
                metadataVersion: 2,
                agentState: {},
                agentStateVersion: 3,
            });

            expect(result).toMatchObject({
                id: 'session-1',
                seq: 42,
                metadata: {
                    claudeSessionId: 'claude-1',
                    hostPid: 99,
                },
                metadataVersion: 7,
                agentState: {
                    messageQueue: {
                        pendingMessageIds: ['queued-2'],
                        currentMessageIds: ['queued-1'],
                    },
                },
                agentStateVersion: 9,
            });
            expect(mockGet).toHaveBeenNthCalledWith(
                1,
                expect.stringMatching(/\/v2\/sessions$/),
                expect.objectContaining({ params: { limit: 200 }, timeout: 60000 }),
            );
            expect(mockGet).toHaveBeenNthCalledWith(
                2,
                expect.stringMatching(/\/v2\/sessions$/),
                expect.objectContaining({
                    params: { limit: 200, cursor: 'cursor_v1_newer-session' },
                    timeout: 60000,
                }),
            );
            expect(mockPost).toHaveBeenCalledWith(
                'https://api.example.com/v1/sessions/session-1/resume',
                {},
                {
                    headers: {
                        'Authorization': 'Bearer fake-token',
                        'X-Happy-Client': 'cli-coding-session/1.0.0',
                    },
                    timeout: 60000,
                },
            );
            expect(mockPost.mock.invocationCallOrder[0]).toBeLessThan(mockGet.mock.invocationCallOrder[0]);
        });

        it('fails closed when the reconnect target is absent', async () => {
            mockGet.mockResolvedValue({ data: { sessions: [] } });
            await expect(api.refreshSessionForReconnect({
                id: 'missing-session',
                seq: 0,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy',
                metadata: testMetadata,
                metadataVersion: 0,
                agentState: {},
                agentStateVersion: 0,
            })).rejects.toThrow('Cannot refresh Happy session missing-session for reconnect');
        });
    });

    describe('postHeartbeatMessage', () => {
        it('posts one encrypted v3 queue record with the stable occurrence id and marker', async () => {
            mockPost.mockResolvedValue({ data: {} });
            const encryptionKey = new Uint8Array(32);

            await api.postHeartbeatMessage({
                id: 'session/one',
                seq: 4,
                encryptionKey,
                encryptionVariant: 'legacy',
                metadata: testMetadata,
                metadataVersion: 2,
                agentState: {},
                agentStateVersion: 3,
            }, {
                localId: 'occurrence-one',
                text: 'heartbeat prompt',
                displayText: 'Heartbeat',
                automationId: '11111111-1111-4111-8111-111111111111',
            });

            expect(mockPost).toHaveBeenCalledWith(
                'https://api.example.com/v3/sessions/session%2Fone/messages',
                {
                    messages: [{
                        localId: 'occurrence-one',
                        content: {
                            role: 'user',
                            content: { type: 'text', text: 'heartbeat prompt' },
                            meta: {
                                sentFrom: 'happyherd-heartbeat',
                                displayText: 'Heartbeat',
                                deliveryMode: 'queue',
                                queueMessageId: 'occurrence-one',
                                heartbeat: {
                                    schemaVersion: 1,
                                    automationId: '11111111-1111-4111-8111-111111111111',
                                    occurrenceId: 'occurrence-one',
                                },
                            },
                        },
                    }],
                },
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
                    timeout: 60000,
                }),
            );
        });
    });

    describe('postSessionEvent', () => {
        it('posts one encrypted provider switch event with the incident id as its stable message id', async () => {
            mockPost.mockResolvedValue({ data: {} });

            await api.postSessionEvent({
                id: 'session/one',
                seq: 4,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy',
                metadata: testMetadata,
                metadataVersion: 2,
                agentState: {},
                agentStateVersion: 3,
            }, {
                type: 'provider-account-switched',
                provider: 'claude',
                fromAccount: 'personal',
                toAccount: 'work-primary',
                incidentId: 'incident-one',
            }, 'incident-one');

            expect(mockPost).toHaveBeenCalledWith(
                'https://api.example.com/v3/sessions/session%2Fone/messages',
                {
                    messages: [{
                        localId: 'incident-one',
                        content: {
                            role: 'agent',
                            content: {
                                id: 'incident-one',
                                type: 'event',
                                data: {
                                    type: 'provider-account-switched',
                                    provider: 'claude',
                                    fromAccount: 'personal',
                                    toAccount: 'work-primary',
                                    incidentId: 'incident-one',
                                },
                            },
                        },
                    }],
                },
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
                    timeout: 60000,
                }),
            );
        });

        it('posts one encrypted provider quota event with the incident id as its stable message id', async () => {
            mockPost.mockResolvedValue({ data: {} });

            await api.postSessionEvent({
                id: 'session/dsh',
                seq: 5,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy',
                metadata: testMetadata,
                metadataVersion: 2,
                agentState: {},
                agentStateVersion: 3,
            }, {
                type: 'provider-quota-exhausted',
                provider: 'dsh',
                incidentId: 'quota-incident-one',
            }, 'quota-incident-one');

            expect(mockPost).toHaveBeenCalledWith(
                'https://api.example.com/v3/sessions/session%2Fdsh/messages',
                {
                    messages: [{
                        localId: 'quota-incident-one',
                        content: {
                            role: 'agent',
                            content: {
                                id: 'quota-incident-one',
                                type: 'event',
                                data: {
                                    type: 'provider-quota-exhausted',
                                    provider: 'dsh',
                                    incidentId: 'quota-incident-one',
                                },
                            },
                        },
                    }],
                },
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
                    timeout: 60000,
                }),
            );
        });
    });

    describe('postSideChatBrief', () => {
        it('posts the complete brief through the ordinary encrypted queue without heartbeat semantics', async () => {
            mockPost.mockResolvedValue({ data: {} });
            const encryptionKey = new Uint8Array(32);

            await api.postSideChatBrief({
                id: 'side/chat',
                seq: 4,
                encryptionKey,
                encryptionVariant: 'legacy',
                metadata: testMetadata,
                metadataVersion: 2,
                agentState: {},
                agentStateVersion: 3,
            }, {
                localId: 'brief-one',
                text: '# Delegated delivery brief\n\nComplete the bounded work.',
            });

            expect(mockPost).toHaveBeenCalledWith(
                'https://api.example.com/v3/sessions/side%2Fchat/messages',
                {
                    messages: [{
                        localId: 'brief-one',
                        content: {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: '# Delegated delivery brief\n\nComplete the bounded work.',
                            },
                            meta: {
                                sentFrom: 'happyherd-side-chat',
                                deliveryMode: 'queue',
                                queueMessageId: 'brief-one',
                            },
                        },
                    }],
                },
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
                    timeout: 60000,
                }),
            );
            const payload = mockPost.mock.calls[0][1] as { messages: Array<{ content: { meta: unknown } }> };
            expect(payload.messages[0].content.meta).not.toHaveProperty('heartbeat');
        });

        it('marks a fresh-provider handoff without changing encrypted queue delivery', async () => {
            mockPost.mockResolvedValue({ data: {} });
            await api.postSideChatBrief({
                id: 'side-chat',
                seq: 1,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy',
                metadata: testMetadata,
                metadataVersion: 1,
                agentState: {},
                agentStateVersion: 1,
            }, {
                localId: 'handoff-one',
                text: 'Continue with bounded visible context.',
                providerContinuationHandoff: true,
            });

            expect(mockPost.mock.calls[0][1]).toMatchObject({
                messages: [{
                    localId: 'handoff-one',
                    content: { meta: { providerContinuationHandoff: true, deliveryMode: 'queue' } },
                }],
            });
        });
    });

    describe('readRecentSessionMessages', () => {
        it('reads one bounded newest-first encrypted page and skips malformed records', async () => {
            mockGet.mockResolvedValue({
                data: {
                    messages: [
                        { seq: 3, createdAt: 3000, localId: 'three', content: { t: 'encrypted', c: 'cipher-three' } },
                        { seq: 2, createdAt: 2000, localId: null, content: { t: 'plain', c: 'ignored' } },
                        { seq: 1, createdAt: 1000, content: { t: 'encrypted', c: 'cipher-one' } },
                        { seq: 0, createdAt: 500, content: { t: 'encrypted', c: 'malformed' } },
                    ],
                },
            });
            mockDecrypt
                .mockReturnValueOnce({ role: 'user', content: { type: 'text', text: 'three' } })
                .mockReturnValueOnce({ role: 'user', content: { type: 'text', text: 'one' } })
                .mockImplementationOnce(() => { throw new Error('bad ciphertext'); });
            const session = {
                id: 'session/one',
                seq: 3,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy' as const,
                metadata: testMetadata,
                metadataVersion: 1,
                agentState: {},
                agentStateVersion: 1,
            };

            await expect(api.readRecentSessionMessages(session)).resolves.toEqual([
                expect.objectContaining({ seq: 3, localId: 'three' }),
                expect.objectContaining({ seq: 1, localId: null }),
            ]);
            expect(mockGet).toHaveBeenCalledWith(
                'https://api.example.com/v3/sessions/session%2Fone/messages',
                expect.objectContaining({
                    params: { before_seq: 2_147_483_647, limit: 500 },
                    timeout: 60000,
                }),
            );
        });

        it('propagates a context-page read failure so creation can fail before spawn', async () => {
            mockGet.mockRejectedValueOnce(new Error('messages unavailable'));
            const session = {
                id: 'session-one',
                seq: 1,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy' as const,
                metadata: testMetadata,
                metadataVersion: 1,
                agentState: {},
                agentStateVersion: 1,
            };

            await expect(api.readRecentSessionMessages(session))
                .rejects.toThrow('messages unavailable');
        });
    });

    describe('getOrCreateMachine', () => {
        it('should return minimal machine object when server is unreachable (ECONNREFUSED)', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to throw connection refused error
            mockPost.mockRejectedValue({ code: 'ECONNREFUSED' });

            const result = await api.getOrCreateMachine({
                machineId: 'test-machine',
                metadata: testMachineMetadata,
                daemonState: {
                    status: 'running',
                    pid: 1234
                }
            });

            expect(result).toEqual({
                id: 'test-machine',
                encryptionKey: expect.any(Uint8Array),
                encryptionVariant: 'legacy',
                metadata: testMachineMetadata,
                metadataVersion: 0,
                daemonState: {
                    status: 'running',
                    pid: 1234
                },
                daemonStateVersion: 0,
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );

            consoleSpy.mockRestore();
        });

        it('should return minimal machine object when server endpoint returns 404', async () => {
            connectionState.reset();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Mock axios to return 404
            mockPost.mockRejectedValue({
                response: { status: 404 },
                isAxiosError: true
            });

            const result = await api.getOrCreateMachine({
                machineId: 'test-machine',
                metadata: testMachineMetadata
            });

            expect(result).toEqual({
                id: 'test-machine',
                encryptionKey: expect.any(Uint8Array),
                encryptionVariant: 'legacy',
                metadata: testMachineMetadata,
                metadataVersion: 0,
                daemonState: null,
                daemonStateVersion: 0,
            });

            // New unified format via connectionState.fail()
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Happy server unreachable')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Machine registration failed: 404')
            );

            consoleSpy.mockRestore();
        });
    });
});
