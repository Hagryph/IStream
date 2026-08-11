import { createSocket, type RemoteInfo, type Socket as DgramSocket } from 'node:dgram';
import {
  ConnectivityDefaults,
  type DiscoveredPeerDescriptor
} from '../../shared/ConnectivityContracts';
import { DeviceIdentity } from './DeviceIdentity';
import { NetworkInterfaceProvider } from './NetworkAddressing';
import { PairedPeerStore } from './PairedPeerStore';

export interface DiscoveryBeacon {
  readonly kind: 'istream-beacon';
  readonly protocolVersion: number;
  readonly deviceId: string;
  readonly displayName: string;
  readonly controlPort: number;
  readonly sentAt: number;
}

export interface DiscoveryProbe {
  readonly kind: 'istream-discovery-probe';
  readonly protocolVersion: number;
  readonly deviceId: string;
  readonly sentAt: number;
}

export type DiscoveryPacket = DiscoveryBeacon | DiscoveryProbe;

export type DiscoveryChangedListener = (peers: readonly DiscoveredPeerDescriptor[]) => void;

export class DiscoveryBeaconCodec {
  public encode(identity: DeviceIdentity, controlPort: number): Buffer {
    const beacon: DiscoveryBeacon = {
      kind: 'istream-beacon',
      protocolVersion: ConnectivityDefaults.protocolVersion,
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      controlPort,
      sentAt: Date.now()
    };
    return Buffer.from(JSON.stringify(beacon), 'utf8');
  }

  public encodeProbe(identity: DeviceIdentity): Buffer {
    const probe: DiscoveryProbe = {
      kind: 'istream-discovery-probe',
      protocolVersion: ConnectivityDefaults.protocolVersion,
      deviceId: identity.deviceId,
      sentAt: Date.now()
    };
    return Buffer.from(JSON.stringify(probe), 'utf8');
  }

  public decode(message: Buffer): DiscoveryPacket | null {
    try {
      const candidate = JSON.parse(message.toString('utf8')) as Partial<DiscoveryPacket>;
      if (
        candidate.kind === 'istream-discovery-probe' &&
        candidate.protocolVersion === ConnectivityDefaults.protocolVersion &&
        typeof candidate.deviceId === 'string' &&
        candidate.deviceId.length === 32 &&
        typeof candidate.sentAt === 'number'
      ) {
        return candidate as DiscoveryProbe;
      }
      if (
        candidate.kind !== 'istream-beacon' ||
        candidate.protocolVersion !== ConnectivityDefaults.protocolVersion ||
        typeof candidate.deviceId !== 'string' ||
        typeof candidate.displayName !== 'string' ||
        typeof candidate.controlPort !== 'number' ||
        typeof candidate.sentAt !== 'number'
      ) {
        return null;
      }
      if (candidate.deviceId.length !== 32 || candidate.displayName.length < 1 || candidate.displayName.length > 64) {
        return null;
      }
      if (!Number.isInteger(candidate.controlPort) || candidate.controlPort < 1024 || candidate.controlPort > 65535) {
        return null;
      }
      return candidate as DiscoveryBeacon;
    } catch {
      return null;
    }
  }
}

export class DiscoveryService {
  readonly #identity: DeviceIdentity;
  readonly #pairedPeerStore: PairedPeerStore;
  readonly #networkInterfaceProvider: NetworkInterfaceProvider;
  readonly #codec: DiscoveryBeaconCodec;
  readonly #listeners: Set<DiscoveryChangedListener> = new Set<DiscoveryChangedListener>();
  readonly #peers: Map<string, DiscoveredPeerDescriptor> = new Map<string, DiscoveredPeerDescriptor>();
  #socket: DgramSocket | null = null;
  #beaconTimer: NodeJS.Timeout | null = null;
  #expiryTimer: NodeJS.Timeout | null = null;
  #controlPort: number = 0;
  #lastProbeResponseAt: number = 0;

  public constructor(
    identity: DeviceIdentity,
    pairedPeerStore: PairedPeerStore,
    networkInterfaceProvider: NetworkInterfaceProvider,
    codec: DiscoveryBeaconCodec
  ) {
    this.#identity = identity;
    this.#pairedPeerStore = pairedPeerStore;
    this.#networkInterfaceProvider = networkInterfaceProvider;
    this.#codec = codec;
  }

  public async start(controlPort: number): Promise<void> {
    if (this.#socket !== null) {
      return;
    }
    this.#controlPort = controlPort;
    this.#socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.#socket.on('message', (message, remoteInfo) => this.handleMessage(message, remoteInfo));
    this.#socket.on('error', () => this.stop());
    await new Promise<void>((resolve, reject) => {
      this.#socket?.once('error', reject);
      this.#socket?.bind(ConnectivityDefaults.discoveryPort, '0.0.0.0', () => {
        this.#socket?.removeListener('error', reject);
        resolve();
      });
    });
    this.joinMulticastInterfaces();
    this.#socket.setMulticastTTL(1);
    this.#socket.setMulticastLoopback(true);
    this.sendBeacon();
    this.#beaconTimer = setInterval(() => this.sendBeacon(), ConnectivityDefaults.beaconIntervalMs);
    this.#expiryTimer = setInterval(() => this.expirePeers(), ConnectivityDefaults.beaconIntervalMs);
  }

  public stop(): void {
    if (this.#beaconTimer !== null) {
      clearInterval(this.#beaconTimer);
      this.#beaconTimer = null;
    }
    if (this.#expiryTimer !== null) {
      clearInterval(this.#expiryTimer);
      this.#expiryTimer = null;
    }
    this.#socket?.close();
    this.#socket = null;
    this.#peers.clear();
    this.notifyListeners();
  }

  public peers(): readonly DiscoveredPeerDescriptor[] {
    return [...this.#peers.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public refresh(): void {
    if (this.#socket === null) {
      throw new Error('LAN discovery is not running.');
    }
    this.#peers.clear();
    this.notifyListeners();
    this.sendBeacon();
    this.#socket.send(
      this.#codec.encodeProbe(this.#identity),
      ConnectivityDefaults.discoveryPort,
      ConnectivityDefaults.multicastAddress
    );
  }

  public subscribe(listener: DiscoveryChangedListener): () => void {
    this.#listeners.add(listener);
    return (): void => {
      this.#listeners.delete(listener);
    };
  }

  private joinMulticastInterfaces(): void {
    let joinedAtLeastOneInterface = false;
    for (const address of this.#networkInterfaceProvider.privateIpv4Addresses()) {
      try {
        this.#socket?.addMembership(ConnectivityDefaults.multicastAddress, address);
        joinedAtLeastOneInterface = true;
      } catch {
        continue;
      }
    }
    if (!joinedAtLeastOneInterface) {
      this.#socket?.addMembership(ConnectivityDefaults.multicastAddress);
    }
  }

  private sendBeacon(): void {
    if (this.#socket === null) {
      return;
    }
    const payload = this.#codec.encode(this.#identity, this.#controlPort);
    this.#socket.send(payload, ConnectivityDefaults.discoveryPort, ConnectivityDefaults.multicastAddress);
  }

  private handleMessage(message: Buffer, remoteInfo: RemoteInfo): void {
    const packet = this.#codec.decode(message);
    if (packet === null || packet.deviceId === this.#identity.deviceId) {
      return;
    }
    if (packet.kind === 'istream-discovery-probe') {
      const now = Date.now();
      if (now - this.#lastProbeResponseAt >= 500) {
        this.#lastProbeResponseAt = now;
        this.sendBeacon();
      }
      return;
    }
    const beacon = packet;
    const peer: DiscoveredPeerDescriptor = {
      deviceId: beacon.deviceId,
      displayName: beacon.displayName,
      address: remoteInfo.address,
      controlPort: beacon.controlPort,
      paired: this.#pairedPeerStore.get(beacon.deviceId) !== null,
      lastSeenAt: Date.now()
    };
    this.#peers.set(peer.deviceId, peer);
    this.notifyListeners();
  }

  private expirePeers(): void {
    const expiryThreshold = Date.now() - ConnectivityDefaults.peerExpiryMs;
    let changed = false;
    for (const [deviceId, peer] of this.#peers) {
      if (peer.lastSeenAt < expiryThreshold) {
        this.#peers.delete(deviceId);
        changed = true;
      }
    }
    if (changed) {
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    const peers = this.peers();
    for (const listener of this.#listeners) {
      listener(peers);
    }
  }
}
