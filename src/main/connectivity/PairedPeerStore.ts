import { join } from 'node:path';
import { ConnectionIntent, ConnectivityDefaults } from '../../shared/ConnectivityContracts';
import { AtomicJsonStore } from '../storage/AtomicJsonStore';

export interface PairedPeerRecord {
  readonly direction: 'inbound';
  readonly intent: ConnectionIntent;
  readonly deviceId: string;
  readonly displayName: string;
  readonly publicKeyDer: string;
  readonly lastAddress: string;
  readonly trustedAt: number;
  readonly expiresAt: number;
}

export interface InboundTrustCandidate {
  readonly intent: ConnectionIntent;
  readonly deviceId: string;
  readonly displayName: string;
  readonly publicKeyDer: string;
  readonly lastAddress: string;
}

export interface StoredPairedPeers {
  readonly peers: readonly unknown[];
}

export type TrustClock = () => number;

export class PairedPeerStore {
  readonly #store: AtomicJsonStore<StoredPairedPeers>;
  readonly #clock: TrustClock;
  #peers: Map<string, PairedPeerRecord> = new Map<string, PairedPeerRecord>();

  public constructor(userDataPath: string, clock: TrustClock = Date.now) {
    this.#store = new AtomicJsonStore<StoredPairedPeers>(join(userDataPath, 'paired-peers.json'));
    this.#clock = clock;
  }

  public async load(): Promise<void> {
    const stored = await this.#store.read();
    const now = this.#clock();
    const storedRecords = Array.isArray(stored?.peers) ? stored.peers : [];
    const validRecords = storedRecords
      .map((peer) => this.validateRecord(peer, now))
      .filter((peer): peer is PairedPeerRecord => peer !== null && peer.expiresAt > now);
    this.#peers = new Map<string, PairedPeerRecord>(validRecords.map((peer) => [this.key(peer.deviceId, peer.intent), peer]));
    if (storedRecords.length !== validRecords.length) {
      await this.persist();
    }
  }

  public isTrusted(deviceId: string, publicKeyDer: string, intent: ConnectionIntent): boolean {
    const peer = this.get(deviceId, intent);
    return peer !== null && peer.publicKeyDer === publicKeyDer;
  }

  public get(deviceId: string, intent: ConnectionIntent): PairedPeerRecord | null {
    const peer = this.#peers.get(this.key(deviceId, intent));
    return peer !== undefined && peer.expiresAt > this.#clock() ? { ...peer } : null;
  }

  public getAny(deviceId: string): PairedPeerRecord | null {
    return this.records()
      .filter((peer) => peer.deviceId === deviceId)
      .sort((left, right) => right.expiresAt - left.expiresAt)[0] ?? null;
  }

  public records(): readonly PairedPeerRecord[] {
    const now = this.#clock();
    return [...this.#peers.values()]
      .filter((peer) => peer.expiresAt > now)
      .map((peer) => ({ ...peer }));
  }

  public async rememberInbound(peer: InboundTrustCandidate): Promise<PairedPeerRecord> {
    const trustedAt = this.#clock();
    const record: PairedPeerRecord = {
      direction: 'inbound',
      ...peer,
      trustedAt,
      expiresAt: trustedAt + ConnectivityDefaults.trustDurationMs
    };
    this.#peers.set(this.key(record.deviceId, record.intent), record);
    await this.persist();
    return { ...record };
  }

  public async clear(deviceId: string): Promise<void> {
    const keys = [...this.#peers.entries()]
      .filter(([_key, peer]) => peer.deviceId === deviceId)
      .map(([key]) => key);
    for (const key of keys) {
      this.#peers.delete(key);
    }
    if (keys.length > 0) {
      await this.persist();
    }
  }

  private validateRecord(value: unknown, now: number): PairedPeerRecord | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Partial<PairedPeerRecord>;
    if (
      candidate.direction !== 'inbound' ||
      (candidate.intent !== ConnectionIntent.ViewRemote && candidate.intent !== ConnectionIntent.ShareLocal) ||
      typeof candidate.deviceId !== 'string' ||
      !/^[a-f0-9]{32}$/i.test(candidate.deviceId) ||
      !this.text(candidate.displayName, 64) ||
      typeof candidate.publicKeyDer !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.publicKeyDer) ||
      candidate.publicKeyDer.length > 4096 ||
      !this.text(candidate.lastAddress, 64) ||
      !Number.isSafeInteger(candidate.trustedAt) ||
      !Number.isSafeInteger(candidate.expiresAt) ||
      (candidate.trustedAt ?? now + 1) > now ||
      (candidate.expiresAt ?? 0) !== (candidate.trustedAt ?? 0) + ConnectivityDefaults.trustDurationMs
    ) {
      return null;
    }
    return candidate as PairedPeerRecord;
  }

  private text(value: unknown, maximumLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
  }

  private key(deviceId: string, intent: ConnectionIntent): string {
    return `${deviceId}:${intent}`;
  }

  private async persist(): Promise<void> {
    await this.#store.write({ peers: [...this.#peers.values()] });
  }
}
