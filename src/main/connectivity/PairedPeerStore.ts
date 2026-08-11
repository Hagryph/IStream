import { join } from 'node:path';
import { AtomicJsonStore } from '../storage/AtomicJsonStore';

export interface PairedPeerRecord {
  readonly deviceId: string;
  readonly displayName: string;
  readonly publicKeyDer: string;
  readonly lastAddress: string;
  readonly pairedAt: number;
}

export interface StoredPairedPeers {
  readonly peers: readonly PairedPeerRecord[];
}

export class PairedPeerStore {
  readonly #store: AtomicJsonStore<StoredPairedPeers>;
  #peers: Map<string, PairedPeerRecord> = new Map<string, PairedPeerRecord>();

  public constructor(userDataPath: string) {
    this.#store = new AtomicJsonStore<StoredPairedPeers>(join(userDataPath, 'paired-peers.json'));
  }

  public async load(): Promise<void> {
    const stored = await this.#store.read();
    this.#peers = new Map<string, PairedPeerRecord>((stored?.peers ?? []).map((peer) => [peer.deviceId, peer]));
  }

  public isKnown(deviceId: string, publicKeyDer: string): boolean {
    return this.#peers.get(deviceId)?.publicKeyDer === publicKeyDer;
  }

  public get(deviceId: string): PairedPeerRecord | null {
    return this.#peers.get(deviceId) ?? null;
  }

  public async remember(peer: PairedPeerRecord): Promise<void> {
    this.#peers.set(peer.deviceId, peer);
    await this.#store.write({ peers: [...this.#peers.values()] });
  }
}
