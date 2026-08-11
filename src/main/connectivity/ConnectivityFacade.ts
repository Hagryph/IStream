import {
  ConnectionState,
  ConnectivityDefaults,
  LocalMediaRole,
  ServiceState,
  type ConnectivitySnapshot,
  type ConsentDecisionRequest,
  type DiscoveredConnectionRequest,
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
  readonly #diagnosticsHub: DiagnosticsHub = new DiagnosticsHub();
  #serviceState: ServiceState = ServiceState.Starting;
  #identity: DeviceIdentity | null = null;
  #pairedPeerStore: PairedPeerStore | null = null;
  #connectionManager: ConnectionManager | null = null;
  #controlServer: ControlServer | null = null;
  #discoveryService: DiscoveryService | null = null;
  #diagnosticsHttpServer: DiagnosticsHttpServer | null = null;
  #lastOperationError: string | null = null;

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
        this.#diagnosticsHub
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
      discoveredPeers: (this.#discoveryService?.peers() ?? []).map((peer) => ({
        ...peer,
        paired: this.#pairedPeerStore?.get(peer.deviceId) !== null
      })),
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

  public async connectManual(request: ManualConnectionRequest): Promise<void> {
    await this.performOperation(async () => {
      const endpoint = new EndpointParser(
        ConnectivityDefaults.preferredControlPort,
        this.#networkInterfaceProvider
      ).parse(request.endpoint);
      await this.requiredManager().connect(endpoint, request.intent);
    });
  }

  public async connectDiscovered(request: DiscoveredConnectionRequest): Promise<void> {
    await this.performOperation(async () => {
      const peer = this.#discoveryService?.peers().find((candidate) => candidate.deviceId === request.deviceId);
      if (peer === undefined) {
        throw new Error('That discovered peer is no longer available.');
      }
      await this.requiredManager().connect(
        { host: peer.address, port: peer.controlPort },
        request.intent,
        peer.deviceId
      );
    });
  }

  public async respondToPrompt(request: ConsentDecisionRequest): Promise<void> {
    await this.performOperation(() => this.requiredManager().respondToPrompt(request.promptId, request.accepted));
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
}
