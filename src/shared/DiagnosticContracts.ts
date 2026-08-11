import { ConnectionState, LocalMediaRole } from './ConnectivityContracts';

export enum DiagnosticCategory {
  Lifecycle = 'lifecycle',
  Control = 'control',
  Media = 'media',
  Network = 'network',
  Input = 'input',
  Error = 'error'
}

export enum DiagnosticSeverity {
  Debug = 'debug',
  Information = 'information',
  Warning = 'warning',
  Error = 'error'
}

export enum DiagnosticEventSource {
  Local = 'local',
  Remote = 'remote'
}

export type DiagnosticValue = string | number | boolean | null;

export interface DiagnosticRecord {
  readonly schemaVersion: number;
  readonly sequence: number;
  readonly timestamp: number;
  readonly originDeviceId: string;
  readonly originDisplayName: string;
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  readonly event: string;
  readonly values: Readonly<Record<string, DiagnosticValue>>;
}

export interface CollectedDiagnosticRecord {
  readonly receivedAt: number;
  readonly source: DiagnosticEventSource;
  readonly record: DiagnosticRecord;
}

export interface DiagnosticsEndpointDescriptor {
  readonly baseUrl: string;
  readonly snapshotCommand: string;
  readonly streamCommand: string;
  readonly peerSnapshotCommand: string;
  readonly retainedDurationMs: number;
  readonly retainedRecordLimit: number;
}

export interface ConnectionDiagnosticValues extends Record<string, DiagnosticValue> {
  readonly connectionState: ConnectionState;
  readonly role: LocalMediaRole;
  readonly initiator: boolean;
  readonly remoteAddress: string;
  readonly roundTripTimeMs: number | null;
  readonly connectedForMs: number | null;
  readonly lastSecureMessageAgeMs: number;
  readonly pendingHealthChecks: number;
  readonly controlFramesSent: number;
  readonly controlFramesReceived: number;
  readonly controlBytesSent: number;
  readonly controlBytesReceived: number;
  readonly encryptedMessagesSent: number;
  readonly encryptedMessagesReceived: number;
}

export class DiagnosticDefaults {
  static readonly schemaVersion: number = 1;
  static readonly preferredLoopbackPort: number = 47800;
  static readonly retainedDurationMs: number = 10 * 60 * 1000;
  static readonly retainedRecordLimit: number = 10_000;
  static readonly peerSampleIntervalMs: number = 1000;
  static readonly maximumValuesPerRecord: number = 64;
  static readonly defaultPeerRecordsPerRequest: number = 1000;
  static readonly maximumPeerRecordsPerRequest: number = 5000;
  static readonly peerBatchRecordCount: number = 10;
  static readonly peerRequestTimeoutMs: number = 10_000;
}
