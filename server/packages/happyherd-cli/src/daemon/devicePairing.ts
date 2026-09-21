import { randomInt } from 'node:crypto';
import {
  DEVICE_PAIRING_TTL_MS,
  DevicePairingCodeSchema,
  DevicePairingIdentitySchema,
  type DevicePairingIdentity,
  type DevicePairingCheckResponse,
  type DevicePairingConfirmResponse,
  type DevicePairingCreateResponse,
  type DevicePairingCancelResponse,
} from '@happyherd/wire';

type Pairing = {
  code: string;
  expiresAt: number;
  status: 'pending' | 'expired' | 'cancelled' | 'used';
  confirmedRequestId?: string;
};

/** Daemon-memory only; it cannot change authentication, machine IDs or sessions. */
export class DevicePairingService {
  private current: Pairing | null = null;
  private readonly identity: DevicePairingIdentity;

  constructor(
    identity: DevicePairingIdentity,
    private readonly serverUrl: string,
    private readonly now: () => number = Date.now,
    private readonly generateCode: () => string = () => String(randomInt(100_000_000)).padStart(8, '0'),
  ) {
    this.identity = DevicePairingIdentitySchema.parse(identity);
  }

  getIdentity(): DevicePairingIdentity {
    return { ...this.identity };
  }

  create(): DevicePairingCreateResponse {
    // Avoid accidentally reviving the immediately preceding code on regeneration.
    let code: string;
    do { code = DevicePairingCodeSchema.parse(this.generateCode()); }
    while (code === this.current?.code);
    this.current = { code, expiresAt: this.now() + DEVICE_PAIRING_TTL_MS, status: 'pending' };
    return { ...this.identity, code, expiresAt: this.current.expiresAt, serverUrl: this.serverUrl };
  }

  private refresh(): Pairing | null {
    if (this.current?.status === 'pending' && this.now() >= this.current.expiresAt) {
      this.current.status = 'expired';
    }
    return this.current;
  }

  check(code: string): DevicePairingCheckResponse {
    const current = this.refresh();
    if (!current || current.code !== code) return { status: 'not_found' };
    return current.status === 'pending'
      ? { status: 'pending', ...this.identity, expiresAt: current.expiresAt }
      : { status: current.status };
  }

  confirm(code: string, requestId: string): DevicePairingConfirmResponse {
    const current = this.refresh();
    if (!current || current.code !== code) return { status: 'not_found' };
    if (current.status === 'used' && current.confirmedRequestId === requestId) {
      return { status: 'connected', ...this.identity };
    }
    if (current.status !== 'pending') return { status: current.status };
    // Synchronous mutation precedes the RPC promise/ACK, so concurrent callers
    // cannot both consume it. Replaying the same request recovers a lost ACK.
    current.status = 'used';
    current.confirmedRequestId = requestId;
    return { status: 'connected', ...this.identity };
  }

  cancel(): DevicePairingCancelResponse {
    const current = this.refresh();
    if (!current) return { status: 'not_found' };
    if (current.status === 'pending') current.status = 'cancelled';
    return { status: current.status };
  }
}
