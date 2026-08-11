import { connect, type Socket } from 'node:net';
import { ConnectionIntent, ConnectionState, LocalMediaRole, type ActiveConnectionDescriptor } from '../../shared/ConnectivityContracts';
import { DeviceIdentity } from './DeviceIdentity';
import { NetworkInterfaceProvider, type ParsedEndpoint } from './NetworkAddressing';
import { PairedPeerStore } from './PairedPeerStore';
import { PeerSession, type PeerSessionPresentation } from './PeerSession';
import { DiagnosticEventSource, type CollectedDiagnosticRecord, type DiagnosticRecord } from '../../shared/DiagnosticContracts';
import { DiagnosticsHub } from '../diagnostics/DiagnosticsHub';

export type ConnectionManagerChangedListener = () => void;

export class ConnectionManager {
  readonly #identity: DeviceIdentity;
  readonly #pairedPeerStore: PairedPeerStore;
  readonly #networkInterfaceProvider: NetworkInterfaceProvider;
  readonly #diagnosticsHub: DiagnosticsHub;
  readonly #listeners: Set<ConnectionManagerChangedListener> = new Set<ConnectionManagerChangedListener>();
  #session: PeerSession | null = null;

  public constructor(
    identity: DeviceIdentity,
    pairedPeerStore: PairedPeerStore,
    networkInterfaceProvider: NetworkInterfaceProvider,
    diagnosticsHub: DiagnosticsHub
  ) {
    this.#identity = identity;
    this.#pairedPeerStore = pairedPeerStore;
    this.#networkInterfaceProvider = networkInterfaceProvider;
    this.#diagnosticsHub = diagnosticsHub;
  }

  public presentation(): PeerSessionPresentation {
    return this.#session?.presentation() ?? {
      connection: this.idleConnection(),
      prompt: null
    };
  }

  public subscribe(listener: ConnectionManagerChangedListener): () => void {
    this.#listeners.add(listener);
    return (): void => {
      this.#listeners.delete(listener);
    };
  }

  public async connect(endpoint: ParsedEndpoint, intent: ConnectionIntent, expectedDeviceId: string | null = null): Promise<void> {
    this.assertAvailable();
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = connect({ host: endpoint.host, port: endpoint.port });
      candidate.setTimeout(5000);
      candidate.once('connect', () => {
        candidate.setTimeout(0);
        resolve(candidate);
      });
      candidate.once('timeout', () => {
        candidate.destroy();
        reject(new Error('The peer did not answer on the control port.'));
      });
      candidate.once('error', reject);
    });
    const session = new PeerSession(
      socket,
      endpoint.host,
      true,
      this.#identity,
      this.#pairedPeerStore,
      (limit) => this.localDiagnosticRecords(limit),
      (record, source) => this.#diagnosticsHub.publish(record, source),
      expectedDeviceId
    );
    this.installSession(session);
    session.start(intent);
  }

  public acceptIncoming(socket: Socket, remoteAddress: string): void {
    if (!this.#networkInterfaceProvider.isPrivateIpv4(remoteAddress) || !this.isAvailable()) {
      socket.destroy();
      return;
    }
    const session = new PeerSession(
      socket,
      remoteAddress,
      false,
      this.#identity,
      this.#pairedPeerStore,
      (limit) => this.localDiagnosticRecords(limit),
      (record, source) => this.#diagnosticsHub.publish(record, source)
    );
    this.installSession(session);
    session.start();
  }

  public async respondToPrompt(promptId: string, accepted: boolean, verificationCode: string | null): Promise<void> {
    if (this.#session === null) {
      throw new Error('There is no active consent request.');
    }
    await this.#session.respondToPrompt(promptId, accepted, verificationCode);
  }

  public requestReversal(): void {
    if (this.#session === null) {
      throw new Error('There is no active connection.');
    }
    this.#session.requestReversal();
  }

  public async requestRemoteDiagnostics(limit: number): Promise<readonly CollectedDiagnosticRecord[]> {
    if (this.#session === null) {
      throw new Error('There is no active connection.');
    }
    const records = await this.#session.requestDiagnostics(limit);
    const collected = records.map((record): CollectedDiagnosticRecord => ({
      receivedAt: Date.now(),
      source: DiagnosticEventSource.Remote,
      record
    }));
    for (const record of records) {
      this.#diagnosticsHub.publish(record, DiagnosticEventSource.Remote);
    }
    return collected;
  }

  public disconnect(): void {
    if (this.#session === null) {
      return;
    }
    if (this.#session.isClosed()) {
      this.#session.dispose();
      this.#session = null;
      this.notifyChanged();
      return;
    }
    this.#session.disconnect();
    this.notifyChanged();
  }

  public dispose(): void {
    this.#session?.dispose();
    this.#session = null;
  }

  private installSession(session: PeerSession): void {
    this.#session?.dispose();
    this.#session = session;
    session.subscribe(() => this.notifyChanged());
    this.notifyChanged();
  }

  private isAvailable(): boolean {
    return this.#session === null || this.#session.isClosed();
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error('Disconnect the current peer before starting another connection.');
    }
  }

  private idleConnection(): ActiveConnectionDescriptor {
    return {
      state: ConnectionState.Idle,
      peer: null,
      role: LocalMediaRole.None,
      roundTripTimeMs: null,
      connectedAt: null,
      error: null
    };
  }

  private localDiagnosticRecords(limit: number): readonly DiagnosticRecord[] {
    return this.#diagnosticsHub.snapshot()
      .filter((collected) => collected.source === DiagnosticEventSource.Local)
      .slice(-limit)
      .map((collected) => collected.record);
  }

  private notifyChanged(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
