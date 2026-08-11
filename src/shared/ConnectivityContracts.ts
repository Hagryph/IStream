export enum ServiceState {
  Starting = 'starting',
  Ready = 'ready',
  Failed = 'failed'
}

export enum ConnectionState {
  Idle = 'idle',
  Connecting = 'connecting',
  Pairing = 'pairing',
  Connected = 'connected',
  Failed = 'failed'
}

export enum ConnectionIntent {
  ViewRemote = 'view-remote',
  ShareLocal = 'share-local'
}

export enum LocalMediaRole {
  None = 'none',
  Viewer = 'viewer',
  Sharer = 'sharer'
}

export enum PromptKind {
  Pairing = 'pairing',
  Connection = 'connection',
  Reversal = 'reversal'
}

export interface LocalEndpointDescriptor {
  readonly deviceId: string;
  readonly displayName: string;
  readonly controlPort: number;
  readonly addresses: readonly string[];
}

export interface DiscoveredPeerDescriptor {
  readonly deviceId: string;
  readonly displayName: string;
  readonly address: string;
  readonly controlPort: number;
  readonly paired: boolean;
  readonly lastSeenAt: number;
}

export interface ConnectedPeerDescriptor {
  readonly deviceId: string;
  readonly displayName: string;
  readonly address: string;
  readonly paired: boolean;
}

export interface ConsentPromptDescriptor {
  readonly promptId: string;
  readonly kind: PromptKind;
  readonly peerName: string;
  readonly verificationCode: string | null;
  readonly intent: ConnectionIntent | null;
  readonly knownPeer: boolean;
}

export interface ActiveConnectionDescriptor {
  readonly state: ConnectionState;
  readonly peer: ConnectedPeerDescriptor | null;
  readonly role: LocalMediaRole;
  readonly roundTripTimeMs: number | null;
  readonly connectedAt: number | null;
  readonly error: string | null;
}

export interface ConnectivitySnapshot {
  readonly serviceState: ServiceState;
  readonly localEndpoint: LocalEndpointDescriptor | null;
  readonly discoveredPeers: readonly DiscoveredPeerDescriptor[];
  readonly connection: ActiveConnectionDescriptor;
  readonly prompt: ConsentPromptDescriptor | null;
  readonly diagnostics: DiagnosticsEndpointDescriptor | null;
}

export interface ManualConnectionRequest {
  readonly endpoint: string;
  readonly intent: ConnectionIntent;
}

export interface DiscoveredConnectionRequest {
  readonly deviceId: string;
  readonly intent: ConnectionIntent;
}

export interface ConsentDecisionRequest {
  readonly promptId: string;
  readonly accepted: boolean;
}

export interface ConnectivityApi {
  getSnapshot(): Promise<ConnectivitySnapshot>;
  connectDiscovered(request: DiscoveredConnectionRequest): Promise<void>;
  connectManual(request: ManualConnectionRequest): Promise<void>;
  respondToPrompt(request: ConsentDecisionRequest): Promise<void>;
  requestReversal(): Promise<void>;
  disconnect(): Promise<void>;
  onSnapshot(listener: ConnectivitySnapshotListener): ConnectivityUnsubscribe;
}

export type ConnectivitySnapshotListener = (snapshot: ConnectivitySnapshot) => void;
export type ConnectivityUnsubscribe = () => void;

export class ConnectivityDefaults {
  static readonly protocolVersion: number = 1;
  static readonly discoveryPort: number = 47777;
  static readonly preferredControlPort: number = 47778;
  static readonly multicastAddress: string = '239.255.77.77';
  static readonly beaconIntervalMs: number = 2000;
  static readonly peerExpiryMs: number = 7000;
  static readonly keepAliveIntervalMs: number = 2000;
  static readonly connectionTimeoutMs: number = 5000;
}
import type { DiagnosticsEndpointDescriptor } from './DiagnosticContracts';
