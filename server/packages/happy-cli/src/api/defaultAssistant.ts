import axios from 'axios';
import { randomUUID } from 'node:crypto';
import type { Credentials } from '@/persistence';
import type { CreateSessionResponse, Metadata, Session } from '@/api/types';
import { configuration } from '@/configuration';
import { decodeBase64, decrypt, encodeBase64, encrypt, getRandomBytes, libsodiumEncryptForPublicKey } from './encryption';

export type DefaultAssistantRecord = CreateSessionResponse['session'];

/** Uses ordinary machine authentication; another machine's winner stays encrypted. */
export class DefaultAssistantApi {
  constructor(private readonly credentials: Credentials) {}

  private options() {
    return {
      headers: { Authorization: `Bearer ${this.credentials.token}` },
      timeout: 60_000,
    };
  }

  async get(): Promise<DefaultAssistantRecord | null> {
    const response = await axios.get<{ session: DefaultAssistantRecord | null }>(
      `${configuration.serverUrl}/v1/sessions/default-assistant`, this.options(),
    );
    return response.data.session;
  }

  prepare(metadata: Metadata): Session {
    const encryptionVariant = this.credentials.encryption.type;
    return {
      id: randomUUID(),
      seq: 0,
      metadata,
      metadataVersion: 0,
      agentState: { controlledByUser: false },
      agentStateVersion: 0,
      encryptionVariant,
      encryptionKey: this.credentials.encryption.type === 'legacy'
        ? this.credentials.encryption.secret : getRandomBytes(32),
    };
  }

  async publish(session: Session): Promise<{ session: DefaultAssistantRecord; isRequestedSession: boolean }> {
    let dataEncryptionKey: string | null = null;
    if (session.encryptionVariant === 'dataKey') {
      if (this.credentials.encryption.type !== 'dataKey') {
        throw new Error('Assistant reconnect data does not match the current machine authentication');
      }
      const sealed = libsodiumEncryptForPublicKey(session.encryptionKey, this.credentials.encryption.publicKey);
      const wrapped = new Uint8Array(sealed.length + 1);
      wrapped.set(sealed, 1);
      dataEncryptionKey = encodeBase64(wrapped);
    }
    const response = await axios.post<{ session: DefaultAssistantRecord; isRequestedSession: boolean }>(
      `${configuration.serverUrl}/v1/sessions/default-assistant`,
      {
        sessionId: session.id,
        metadata: encodeBase64(encrypt(session.encryptionKey, session.encryptionVariant, session.metadata)),
        agentState: session.agentState
          ? encodeBase64(encrypt(session.encryptionKey, session.encryptionVariant, session.agentState)) : null,
        dataEncryptionKey,
      },
      this.options(),
    );
    return response.data;
  }

  hydrate(record: DefaultAssistantRecord, saved: Session): Session {
    if (record.id !== saved.id) throw new Error('Assistant identity does not match local reconnect data');
    const metadata = decrypt(saved.encryptionKey, saved.encryptionVariant, decodeBase64(record.metadata)) as Metadata | null;
    if (!metadata || metadata.isSuperSession !== true) {
      throw new Error('Default Assistant metadata is unavailable or has no Super Session marker');
    }
    return {
      ...saved,
      seq: record.seq,
      metadata,
      metadataVersion: record.metadataVersion,
      agentState: record.agentState
        ? decrypt(saved.encryptionKey, saved.encryptionVariant, decodeBase64(record.agentState)) as Session['agentState'] : null,
      agentStateVersion: record.agentStateVersion,
    };
  }
}
