import {
  ConnectionState,
  ConnectivityDefaults,
  LocalMediaRole,
  ServiceState,
  type ActiveConnectionDescriptor,
  type ClearTrustRequest,
  type ConnectivitySnapshot,
  type ConsentDecisionRequest,
  type DiscoveredConnectionRequest,
  type DiscoveredPeerDescriptor,
  type ManualConnectionRequest
} from '../../shared/ConnectivityContracts';
import { ConnectionManager } from './ConnectionManager';
import { ControlServer, SocketAddressNormalizer } from './ControlServer';
import { DeviceIdentityStore, type DeviceIdentity } from './DeviceIdentity';
import { DiscoveryBeaconCodec, DiscoveryService } from './DiscoveryService';
import { EndpointParser, NetworkInterfaceProvider } from './NetworkAddressing';
import { PairedPeerStore } from './PairedPeerStore';
import { DiagnosticsHub } from '../diagnostics/DiagnosticsHub';
import { DiagnosticsHttpServer } from '../diagnostics/DiagnosticsHttpServer';
import type { CollectedDiagnosticRecord } from '../../shared/DiagnosticContracts';
import type { MediaSignal } from '../../shared/MediaContracts';
import {
  DiagnosticCategory,
  DiagnosticDefaults,
  DiagnosticEventSource,
  DiagnosticSeverity
} from '../../shared/DiagnosticContracts';
import { MediaMetricSampleValidator } from '../media/MediaMetricSampleValidator';

export interface ConnectivityRuntimeOptions {
  readonly userDataPath: string;
  readonly enableDiscovery: boolean;
  readonly preferredControlPort: number;
  readonly enableLocalDiagnosticsServer: boolean;
  readonly preferredDiagnosticsPort: number;
}

export type ConnectivityFacadeListener = (snapshot: ConnectivitySnapshot) => void;

export class ConnectivityFacade {
  readonly #options: ConnectivityRuntimeOptions;
  readonly #networkInterfaceProvider: NetworkInterfaceProvider = new NetworkInterfaceProvider();
  readonly #listeners: Set<ConnectivityFacadeListener> = new Set<ConnectivityFacadeListener>();
  readonly #mediaSignalListeners: Set<(signal: MediaSignal) => void> = new Set<(signal: MediaSignal) => void>();
  readonly #diagnosticsHub: DiagnosticsHub = new DiagnosticsHub();
  readonly #mediaMetricValidator: MediaMetricSampleValidator = new MediaMetricSampleValidator();
  #serviceState: ServiceState = ServiceState.Starting;
  #identity: DeviceIdentity | null = null;
  #pairedPeerStore: PairedPeerStore | null = null;
  #connectionManager: ConnectionManager | null = null;
  #controlServer: ControlServer | null = null;
  #discoveryService: DiscoveryService | null = null;
  #diagnosticsHttpServer: DiagnosticsHttpServer | null = null;
  #lastOperationError: string | null = null;
  #mediaDiagnosticSequence: number = 0;

  public constructor(options: ConnectivityRuntimeOptions) {
    this.#options = options;
  }

  public async start(): Promise<void> {
    try {
      this.#identity = await new DeviceIdentityStore(this.#options.userDataPath).loadOrCreate();
      this.#pairedPeerStore = new PairedPeerStore(this.#options.userDataPath);
      await this.#pairedPeerStore.load();
      this.#connectionManager = new ConnectionManager(
        this.#identity,
        this.#pairedPeerStore,
        this.#networkInterfaceProvider,
        this.#diagnosticsHub,
        (signal) => this.notifyMediaSignal(signal)
      );
      this.#connectionManager.subscribe(() => this.notifyListeners());
      this.#controlServer = new ControlServer(
        (socket, remoteAddress) => this.#connectionManager?.acceptIncoming(socket, remoteAddress),
        new SocketAddressNormalizer()
      );
      const controlPort = await this.#controlServer.start(this.#options.preferredControlPort);
      if (this.#options.enableLocalDiagnosticsServer) {
        this.#diagnosticsHttpServer = new DiagnosticsHttpServer(
          this.#diagnosticsHub,
          (limit) => this.requiredManager().requestRemoteDiagnostics(limit)
        );
        await this.#diagnosticsHttpServer.start(this.#options.preferredDiagnosticsPort);
      }
      if (this.#options.enableDiscovery) {
        this.#discoveryService = new DiscoveryService(
          this.#identity,
          this.#pairedPeerStore,
          this.#networkInterfaceProvider,
          new DiscoveryBeaconCodec()
        );
        this.#discoveryService.subscribe(() => this.notifyListeners());
        await this.#discoveryService.start(controlPort);
      }
      this.#serviceState = ServiceState.Ready;
      this.notifyListeners();
    } catch (error: unknown) {
      this.#serviceState = ServiceState.Failed;
      this.#lastOperationError = error instanceof Error ? error.message : 'Connectivity service failed to start.';
      this.notifyListeners();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.#discoveryService?.stop();
    this.#connectionManager?.dispose();
    await this.#controlServer?.stop();
    await this.#diagnosticsHttpServer?.stop();
    this.#serviceState = ServiceState.Starting;
  }

  public snapshot(): ConnectivitySnapshot {
    const sessionPresentation = this.#connectionManager?.presentation();
    const connection = sessionPresentation?.connection ?? {
      state: this.#lastOperationError === null ? ConnectionState.Idle : ConnectionState.Failed,
      peer: null,
      role: LocalMediaRole.None,
      roundTripTimeMs: null,
      connectedAt: null,
      error: this.#lastOperationError
    };
    return {
      serviceState: this.#serviceState,
      localEndpoint: this.#identity === null || this.#controlServer === null ? null : {
        deviceId: this.#identity.deviceId,
        displayName: this.#identity.displayName,
        controlPort: this.#controlServer.port,
        addresses: this.#networkInterfaceProvider.privateIpv4Addresses()
      },
      discoveredPeers: this.peerDescriptors(connection),
      connection: connection.state === ConnectionState.Idle && this.#lastOperationError !== null
        ? { ...connection, state: ConnectionState.Failed, error: this.#lastOperationError }
        : connection,
      prompt: sessionPresentation?.prompt ?? null,
      diagnostics: this.#diagnosticsHttpServer?.descriptor() ?? null
    };
  }

  public subscribe(listener: ConnectivityFacadeListener): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return (): void => {
      this.#listeners.delete(listener);
    };
  }

  public subscribeMediaSignals(listener: (signal: MediaSignal) => void): () => void {
    this.#mediaSignalListeners.add(listener);
    return (): void => {
      this.#mediaSignalListeners.delete(listener);
    };
  }

  public sendMediaSignal(signal: MediaSignal): void {
    this.requiredManager().sendMediaSignal(signal);
  }

  public reportMediaMetrics(value: unknown): void {
    if (this.#identity === null) {
      throw new Error('Connectivity service is not ready.');
    }
    const sample = this.#mediaMetricValidator.validate(value);
    this.#mediaDiagnosticSequence += 1;
    this.#diagnosticsHub.publish({
      schemaVersion: DiagnosticDefaults.schemaVersion,
      sequence: this.#mediaDiagnosticSequence,
      timestamp: sample.timestamp,
      originDeviceId: this.#identity.deviceId,
      originDisplayName: this.#identity.displayName,
      category: DiagnosticCategory.Media,
      severity: DiagnosticSeverity.Information,
      event: 'media.sample',
      values: { ...sample }
    }, DiagnosticEventSource.Local);
  }

  public async connectManual(request: ManualConnectionRequest): Promise<void> {
    await this.performOperation(async () => {
      const endpoint = new EndpointParser(
        ConnectivityDefaults.preferredControlPort,
        this.#networkInterfaceProvider
      ).parse(request.endpoint);
      await this.requiredManager().connect(endpoint, request.intent);
    });
  }

  public async refreshDiscovery(): Promise<void> {
    await this.performOperation(async () => {
      if (this.#discoveryService === null) {
        throw new Error('LAN discovery is not available.');
      }
      this.#discoveryService.refresh();
    });
  }

  public async clearTrust(request: ClearTrustRequest): Promise<void> {
    await this.performOperation(async () => {
      if (!/^[a-f0-9]{32}$/i.test(request.deviceId)) {
        throw new Error('The trusted device identifier is invalid.');
      }
      await this.requiredTrustStore().clear(request.deviceId);
    });
  }

  public async connectDiscovered(request: DiscoveredConnectionRequest): Promise<void> {
    await this.performOperation(async () => {
      const peer = this.#discoveryService?.peers().find((candidate) => candidate.deviceId === request.deviceId);
      if (peer === undefined) {
        throw new Error('That discovered peer is no longer available.');
      }
      if (peer.controlPort === null) {
        throw new Error('That trusted peer is offline.');
      }
      await this.requiredManager().connect(
        { host: peer.address, port: peer.controlPort },
        request.intent,
        peer.deviceId
      );
    });
  }

  public async respondToPrompt(request: ConsentDecisionRequest): Promise<void> {
    await this.performOperation(() => this.requiredManager().respondToPrompt(
      request.promptId,
      request.accepted,
      request.verificationCode
    ));
  }

  public async requestReversal(): Promise<void> {
    await this.performOperation(async () => this.requiredManager().requestReversal());
  }

  public requestRemoteDiagnostics(limit: number): Promise<readonly CollectedDiagnosticRecord[]> {
    return this.requiredManager().requestRemoteDiagnostics(limit);
  }

  public async disconnect(): Promise<void> {
    this.#lastOperationError = null;
    this.requiredManager().disconnect();
    this.notifyListeners();
  }

  private requiredManager(): ConnectionManager {
    if (this.#connectionManager === null || this.#serviceState !== ServiceState.Ready) {
      throw new Error('Connectivity service is not ready.');
    }
    return this.#connectionManager;
  }

  private requiredTrustStore(): PairedPeerStore {
    if (this.#pairedPeerStore === null || this.#serviceState !== ServiceState.Ready) {
      throw new Error('The trust store is not ready.');
    }
    return this.#pairedPeerStore;
  }

  private peerDescriptors(connection: ActiveConnectionDescriptor): readonly DiscoveredPeerDescriptor[] {
    const livePeers = this.#discoveryService?.peers() ?? [];
    const descriptors = new Map<string, DiscoveredPeerDescriptor>();
    for (const peer of livePeers) {
      const trust = this.#pairedPeerStore?.getAny(peer.deviceId) ?? null;
      descriptors.set(peer.deviceId, {
        ...peer,
        paired: trust !== null,
        online: true,
        trustExpiresAt: trust?.expiresAt ?? null,
        trustedIntents: this.#pairedPeerStore?.records()
          .filter((record) => record.deviceId === peer.deviceId)
          .map((record) => record.intent) ?? []
      });
    }
    const retainedTrust = [...(this.#pairedPeerStore?.records() ?? [])]
      .sort((left, right) => right.expiresAt - left.expiresAt);
    for (const trust of retainedTrust) {
      if (descriptors.has(trust.deviceId)) {
        continue;
      }
      const active = connection.peer?.deviceId === trust.deviceId && connection.state === ConnectionState.Connected;
      descriptors.set(trust.deviceId, {
        deviceId: trust.deviceId,
        displayName: trust.displayName,
        address: active ? connection.peer?.address ?? trust.lastAddress : trust.lastAddress,
        controlPort: null,
        paired: true,
        online: active,
        trustExpiresAt: trust.expiresAt,
        trustedIntents: retainedTrust
          .filter((record) => record.deviceId === trust.deviceId)
          .map((record) => record.intent),
        lastSeenAt: active ? Date.now() : trust.trustedAt
      });
    }
    return [...descriptors.values()].sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? -1 : 1;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }

  private async performOperation(operation: () => Promise<void>): Promise<void> {
    this.#lastOperationError = null;
    try {
      await operation();
    } catch (error: unknown) {
      this.#lastOperationError = error instanceof Error ? error.message : 'Connectivity operation failed.';
      this.notifyListeners();
      throw error;
    }
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) {
      listener(snapshot);
    }
  }

  private notifyMediaSignal(signal: MediaSignal): void {
    for (const listener of this.#mediaSignalListeners) {
      listener(signal);
    }
  }
}
