import { ConnectionIntent } from '../../shared/ConnectivityContracts';
import type { DiagnosticRecord } from '../../shared/DiagnosticContracts';
import type { MediaSignal } from '../../shared/MediaContracts';

export enum WireMessageKind {
  ClientHello = 'client-hello',
  ServerHello = 'server-hello',
  Secure = 'secure'
}

export enum SecureMessageKind {
  Ready = 'ready',
  ReadyAcknowledged = 'ready-acknowledged',
  ConsentDecision = 'consent-decision',
  Ping = 'ping',
  Pong = 'pong',
  ReversalRequest = 'reversal-request',
  ReversalDecision = 'reversal-decision',
  Disconnect = 'disconnect',
  ProtocolError = 'protocol-error',
  DiagnosticsRequest = 'diagnostics-request',
  DiagnosticsBatch = 'diagnostics-batch',
  MediaSignal = 'media-signal'
}

export interface ClientHelloMessage {
  readonly kind: WireMessageKind.ClientHello;
  readonly protocolVersion: number;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly displayName: string;
  readonly identityPublicKey: string;
  readonly ephemeralPublicKey: string;
  readonly nonce: string;
  readonly intent: ConnectionIntent;
  readonly signature: string;
}

export interface ServerHelloMessage {
  readonly kind: WireMessageKind.ServerHello;
  readonly protocolVersion: number;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly displayName: string;
  readonly identityPublicKey: string;
  readonly ephemeralPublicKey: string;
  readonly nonce: string;
  readonly clientHelloHash: string;
  readonly signature: string;
}

export interface SecureEnvelope {
  readonly kind: WireMessageKind.Secure;
  readonly counter: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

export interface ReadyMessage {
  readonly kind: SecureMessageKind.Ready;
}

export interface ReadyAcknowledgedMessage {
  readonly kind: SecureMessageKind.ReadyAcknowledged;
}

export interface ConsentDecisionMessage {
  readonly kind: SecureMessageKind.ConsentDecision;
  readonly accepted: boolean;
}

export interface PingMessage {
  readonly kind: SecureMessageKind.Ping;
  readonly pingId: string;
  readonly sentAt: number;
}

export interface PongMessage {
  readonly kind: SecureMessageKind.Pong;
  readonly pingId: string;
}

export interface ReversalRequestMessage {
  readonly kind: SecureMessageKind.ReversalRequest;
  readonly requestId: string;
}

export interface ReversalDecisionMessage {
  readonly kind: SecureMessageKind.ReversalDecision;
  readonly requestId: string;
  readonly accepted: boolean;
}

export interface DisconnectMessage {
  readonly kind: SecureMessageKind.Disconnect;
  readonly reason: string;
}

export interface ProtocolErrorMessage {
  readonly kind: SecureMessageKind.ProtocolError;
  readonly reason: string;
}

export interface DiagnosticsRequestMessage {
  readonly kind: SecureMessageKind.DiagnosticsRequest;
  readonly requestId: string;
  readonly limit: number;
}

export interface DiagnosticsBatchMessage {
  readonly kind: SecureMessageKind.DiagnosticsBatch;
  readonly requestId: string;
  readonly records: readonly DiagnosticRecord[];
  readonly complete: boolean;
}

export interface MediaSignalMessage {
  readonly kind: SecureMessageKind.MediaSignal;
  readonly signal: MediaSignal;
}

export type WireMessage = ClientHelloMessage | ServerHelloMessage | SecureEnvelope;
export type SecureMessage =
  | ReadyMessage
  | ReadyAcknowledgedMessage
  | ConsentDecisionMessage
  | PingMessage
  | PongMessage
  | ReversalRequestMessage
  | ReversalDecisionMessage
  | DisconnectMessage
  | ProtocolErrorMessage
  | DiagnosticsRequestMessage
  | DiagnosticsBatchMessage
  | MediaSignalMessage;

export class ProtocolLimits {
  static readonly maximumFrameBytes: number = 65_536;
  static readonly maximumDisplayNameLength: number = 64;
  static readonly handshakeTimeoutMs: number = 10_000;
  static readonly maximumSessionDescriptionLength: number = 32_000;
  static readonly maximumIceCandidateLength: number = 4_096;
}
