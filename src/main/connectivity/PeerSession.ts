import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import {
  ConnectionIntent,
  ConnectionState,
  ConsentPromptMode,
  ConnectivityDefaults,
  LocalMediaRole,
  PromptKind,
  type ActiveConnectionDescriptor,
  type ConsentPromptDescriptor,
  type ConnectedPeerDescriptor
} from '../../shared/ConnectivityContracts';
import {
  DiagnosticCategory,
  DiagnosticDefaults,
  DiagnosticEventSource,
  DiagnosticSeverity,
  type ConnectionDiagnosticValues,
  type DiagnosticRecord
} from '../../shared/DiagnosticContracts';
import { DeviceIdentity } from './DeviceIdentity';
import type { MediaSignal } from '../../shared/MediaContracts';
import { JsonLineTransport } from './JsonLineTransport';
import { PairedPeerStore } from './PairedPeerStore';
import {
  HandshakeFactory,
  HandshakeTranscript,
  EphemeralKeyAgreement,
  ProtocolValidator,
  SecureMessageCipher
} from './SessionCryptography';
import {
  ProtocolLimits,
  SecureMessageKind,
  type ClientHelloMessage,
  type ConsentDecisionMessage,
  type DiagnosticsBatchMessage,
  type DiagnosticsRequestMessage,
  type MediaSignalMessage,
  type PingMessage,
  type PongMessage,
  type ReversalDecisionMessage,
  type ReversalRequestMessage,
  type SecureMessage,
  type ServerHelloMessage
} from './ProtocolContracts';

export enum PeerSessionPhase {
  AwaitingClientHello = 'awaiting-client-hello',
  AwaitingServerHello = 'awaiting-server-hello',
  AwaitingSecureReady = 'awaiting-secure-ready',
  AwaitingSecureAcknowledgement = 'awaiting-secure-acknowledgement',
  AwaitingConsent = 'awaiting-consent',
  Connected = 'connected',
  Closed = 'closed'
}

export interface PeerSessionPresentation {
  readonly connection: ActiveConnectionDescriptor;
  readonly prompt: ConsentPromptDescriptor | null;
}

export type PeerSessionChangedListener = () => void;
export type DiagnosticRecordProvider = (limit: number) => readonly DiagnosticRecord[];
export type DiagnosticRecordListener = (record: DiagnosticRecord, source: DiagnosticEventSource) => void;
export type MediaSignalListener = (signal: MediaSignal) => void;

export interface PendingDiagnosticRequest {
  readonly limit: number;
  readonly records: DiagnosticRecord[];
  readonly resolve: (records: readonly DiagnosticRecord[]) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export class PeerSession {
  readonly #pairedPeerStore: PairedPeerStore;
  readonly #identity: DeviceIdentity;
  readonly #diagnosticRecordProvider: DiagnosticRecordProvider;
  readonly #diagnosticRecordListener: DiagnosticRecordListener;
  readonly #mediaSignalListener: MediaSignalListener;
  readonly #transport: JsonLineTransport;
  readonly #agreement: EphemeralKeyAgreement = new EphemeralKeyAgreement();
  readonly #handshakeFactory: HandshakeFactory;
  readonly #remoteAddress: string;
  readonly #initiator: boolean;
  readonly #expectedDeviceId: string | null;
  readonly #listeners: Set<PeerSessionChangedListener> = new Set<PeerSessionChangedListener>();
  readonly #pendingPings: Map<string, number> = new Map<string, number>();
  readonly #pendingDiagnosticRequests: Map<string, PendingDiagnosticRequest> = new Map<string, PendingDiagnosticRequest>();
  #phase: PeerSessionPhase;
  #intent: ConnectionIntent | null = null;
  #clientHello: ClientHelloMessage | null = null;
  #serverHello: ServerHelloMessage | null = null;
  #cipher: SecureMessageCipher | null = null;
  #peer: ConnectedPeerDescriptor | null = null;
  #peerPublicKey: string | null = null;
  #verificationCode: string | null = null;
  #prompt: ConsentPromptDescriptor | null = null;
  #localConsent: boolean | null = null;
  #remoteConsent: boolean | null = null;
  #role: LocalMediaRole = LocalMediaRole.None;
  #connectedAt: number | null = null;
  #roundTripTimeMs: number | null = null;
  #error: string | null = null;
  #handshakeTimer: NodeJS.Timeout | null = null;
  #keepAliveTimer: NodeJS.Timeout | null = null;
  #diagnosticTimer: NodeJS.Timeout | null = null;
  #diagnosticSequence: number = 0;
  #lastSecureMessageAt: number = Date.now();
  #pendingOutgoingReversalId: string | null = null;
  #pendingIncomingReversalId: string | null = null;
  #intentionalClose: boolean = false;

  public constructor(
    socket: Socket,
    remoteAddress: string,
    initiator: boolean,
    identity: DeviceIdentity,
    pairedPeerStore: PairedPeerStore,
    diagnosticRecordProvider: DiagnosticRecordProvider,
    diagnosticRecordListener: DiagnosticRecordListener,
    mediaSignalListener: MediaSignalListener,
    expectedDeviceId: string | null = null
  ) {
    this.#pairedPeerStore = pairedPeerStore;
    this.#identity = identity;
    this.#diagnosticRecordProvider = diagnosticRecordProvider;
    this.#diagnosticRecordListener = diagnosticRecordListener;
    this.#mediaSignalListener = mediaSignalListener;
    this.#remoteAddress = remoteAddress;
    this.#initiator = initiator;
    this.#expectedDeviceId = expectedDeviceId;
    this.#phase = initiator ? PeerSessionPhase.AwaitingServerHello : PeerSessionPhase.AwaitingClientHello;
    this.#transport = new JsonLineTransport(socket, ProtocolLimits.maximumFrameBytes);
    this.#handshakeFactory = new HandshakeFactory(identity);
    this.#transport.subscribeMessages((message) => this.handleWireMessage(message));
    this.#transport.subscribeClosed((reason) => this.handleTransportClosed(reason));
  }

  public start(intent?: ConnectionIntent): void {
    this.startHandshakeTimer();
    if (this.#initiator) {
      if (intent === undefined) {
        throw new Error('An outgoing connection requires a direction.');
      }
      this.#intent = intent;
      this.#clientHello = this.#handshakeFactory.createClientHello(randomUUID(), this.#agreement, intent);
      this.#transport.send(this.#clientHello);
    }
    this.notifyChanged();
  }

  public subscribe(listener: PeerSessionChangedListener): () => void {
    this.#listeners.add(listener);
    return (): void => {
      this.#listeners.delete(listener);
    };
  }

  public presentation(): PeerSessionPresentation {
    return {
      connection: {
        state: this.connectionState(),
        peer: this.#peer,
        role: this.#role,
        roundTripTimeMs: this.#roundTripTimeMs,
        connectedAt: this.#connectedAt,
        error: this.#error
      },
      prompt: this.#prompt
    };
  }

  public isClosed(): boolean {
    return this.#phase === PeerSessionPhase.Closed;
  }

  public async respondToPrompt(
    promptId: string,
    accepted: boolean,
    verificationCode: string | null
  ): Promise<void> {
    if (this.#prompt === null || this.#prompt.promptId !== promptId) {
      throw new Error('That consent request is no longer active.');
    }
    if (this.#prompt.kind === PromptKind.Reversal) {
      this.respondToReversal(accepted);
      return;
    }
    if (this.#prompt.mode === ConsentPromptMode.WaitingForPeer && accepted) {
      throw new Error('The requesting computer is already approved and is waiting for the peer.');
    }
    if (this.#prompt.mode === ConsentPromptMode.EnterVerificationCode && accepted) {
      const enteredCode = verificationCode?.trim() ?? '';
      if (
        this.#verificationCode === null ||
        !/^\d{6}$/.test(enteredCode) ||
        !ProtocolValidator.constantTimeEqual(enteredCode, this.#verificationCode)
      ) {
        throw new Error('The verification code does not match the requesting computer.');
      }
    }
    this.#prompt = null;
    this.#localConsent = accepted;
    this.sendSecure({ kind: SecureMessageKind.ConsentDecision, accepted });
    if (!accepted) {
      this.closeWithError('Connection declined on this computer.', true);
      return;
    }
    await this.tryEstablishConnection();
    this.notifyChanged();
  }

  public requestReversal(): void {
    if (this.#phase !== PeerSessionPhase.Connected || this.#pendingOutgoingReversalId !== null) {
      throw new Error('Direction can only be reversed on an active, stable connection.');
    }
    const requestId = randomUUID();
    this.#pendingOutgoingReversalId = requestId;
    this.sendSecure({ kind: SecureMessageKind.ReversalRequest, requestId });
    this.notifyChanged();
  }

  public requestDiagnostics(limit: number): Promise<readonly DiagnosticRecord[]> {
    if (this.#phase !== PeerSessionPhase.Connected) {
      return Promise.reject(new Error('Remote diagnostics require an active peer connection.'));
    }
    const boundedLimit = Math.max(1, Math.min(DiagnosticDefaults.maximumPeerRecordsPerRequest, limit));
    const requestId = randomUUID();
    return new Promise<readonly DiagnosticRecord[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingDiagnosticRequests.delete(requestId);
        reject(new Error('The peer did not return diagnostics in time.'));
      }, DiagnosticDefaults.peerRequestTimeoutMs);
      this.#pendingDiagnosticRequests.set(requestId, {
        limit: boundedLimit,
        records: [],
        resolve,
        reject,
        timeout
      });
      try {
        this.sendSecure({ kind: SecureMessageKind.DiagnosticsRequest, requestId, limit: boundedLimit });
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.#pendingDiagnosticRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error('Could not request peer diagnostics.'));
      }
    });
  }

  public sendMediaSignal(signal: MediaSignal): void {
    if (this.#phase !== PeerSessionPhase.Connected) {
      throw new Error('Media negotiation requires an active peer connection.');
    }
    this.sendSecure({ kind: SecureMessageKind.MediaSignal, signal });
  }

  public disconnect(reason: string = 'Disconnected by the user.'): void {
    if (this.#cipher !== null && this.#phase !== PeerSessionPhase.Closed) {
      try {
        this.sendSecure({ kind: SecureMessageKind.Disconnect, reason });
      } catch {
        this.closeWithError(reason, true);
        return;
      }
    }
    this.closeWithError(reason, true);
  }

  public dispose(): void {
    this.#intentionalClose = true;
    this.clearTimers();
    this.#transport.close();
    this.#phase = PeerSessionPhase.Closed;
  }

  private handleWireMessage(value: unknown): void {
    try {
      if (this.#phase === PeerSessionPhase.AwaitingClientHello) {
        this.handleClientHello(ProtocolValidator.clientHello(value));
        return;
      }
      if (this.#phase === PeerSessionPhase.AwaitingServerHello) {
        this.handleServerHello(ProtocolValidator.serverHello(value));
        return;
      }
      const envelope = ProtocolValidator.secureEnvelope(value);
      if (this.#cipher === null) {
        throw new Error('Secure channel is not initialized.');
      }
      this.#lastSecureMessageAt = Date.now();
      this.handleSecureMessage(this.#cipher.decrypt(envelope));
    } catch (error: unknown) {
      this.closeWithError(error instanceof Error ? error.message : 'Control protocol failed.', false);
    }
  }

  private handleClientHello(message: ClientHelloMessage): void {
    if (!HandshakeTranscript.verifyClientHello(message)) {
      throw new Error('The remote identity signature is invalid.');
    }
    this.#clientHello = message;
    this.#intent = message.intent;
    this.#peerPublicKey = message.identityPublicKey;
    this.#peer = this.createPeer(message.deviceId, message.displayName, message.identityPublicKey);
    this.#serverHello = this.#handshakeFactory.createServerHello(message, this.#agreement);
    this.#transport.send(this.#serverHello);
    this.createCipher(false);
    this.#phase = PeerSessionPhase.AwaitingSecureReady;
    this.notifyChanged();
  }

  private handleServerHello(message: ServerHelloMessage): void {
    if (this.#clientHello === null || !HandshakeTranscript.verifyServerHello(message, this.#clientHello)) {
      throw new Error('The remote identity signature is invalid.');
    }
    if (this.#expectedDeviceId !== null && message.deviceId !== this.#expectedDeviceId) {
      throw new Error('The discovered peer identity changed before connection.');
    }
    this.#serverHello = message;
    this.#peerPublicKey = message.identityPublicKey;
    this.#peer = this.createPeer(message.deviceId, message.displayName, message.identityPublicKey);
    this.createCipher(true);
    this.#phase = PeerSessionPhase.AwaitingSecureAcknowledgement;
    this.sendSecure({ kind: SecureMessageKind.Ready });
    this.notifyChanged();
  }

  private createCipher(initiator: boolean): void {
    if (this.#clientHello === null || this.#serverHello === null) {
      throw new Error('Handshake transcript is incomplete.');
    }
    const sharedSecret = this.#agreement.deriveSharedSecret(
      initiator ? this.#serverHello.ephemeralPublicKey : this.#clientHello.ephemeralPublicKey
    );
    const sessionHash = HandshakeTranscript.sessionHash(this.#clientHello, this.#serverHello);
    this.#verificationCode = HandshakeTranscript.verificationCode(sharedSecret, sessionHash);
    this.#cipher = new SecureMessageCipher(this.#clientHello.sessionId, sharedSecret, sessionHash, initiator);
  }

  private handleSecureMessage(message: SecureMessage): void {
    switch (message.kind) {
      case SecureMessageKind.Ready:
        if (this.#phase !== PeerSessionPhase.AwaitingSecureReady) {
          throw new Error('Unexpected secure ready message.');
        }
        this.sendSecure({ kind: SecureMessageKind.ReadyAcknowledged });
        this.enterConsentPhase();
        break;
      case SecureMessageKind.ReadyAcknowledged:
        if (this.#phase !== PeerSessionPhase.AwaitingSecureAcknowledgement) {
          throw new Error('Unexpected secure acknowledgement.');
        }
        this.enterConsentPhase();
        break;
      case SecureMessageKind.ConsentDecision:
        this.handleConsentDecision(message);
        break;
      case SecureMessageKind.Ping:
        this.handlePing(message);
        break;
      case SecureMessageKind.Pong:
        this.handlePong(message);
        break;
      case SecureMessageKind.ReversalRequest:
        this.handleReversalRequest(message);
        break;
      case SecureMessageKind.ReversalDecision:
        this.handleReversalDecision(message);
        break;
      case SecureMessageKind.Disconnect:
        this.closeWithError(message.reason, true);
        break;
      case SecureMessageKind.ProtocolError:
        this.closeWithError(message.reason, false);
        break;
      case SecureMessageKind.DiagnosticsRequest:
        this.handleDiagnosticsRequest(message);
        break;
      case SecureMessageKind.DiagnosticsBatch:
        this.handleDiagnosticsBatch(message);
        break;
      case SecureMessageKind.MediaSignal:
        this.handleMediaSignal(message);
        break;
      default:
        throw new Error('Unsupported secure control message.');
    }
  }

  private enterConsentPhase(): void {
    this.clearHandshakeTimer();
    if (this.#peer === null || this.#intent === null) {
      throw new Error('Peer consent context is incomplete.');
    }
    this.#phase = PeerSessionPhase.AwaitingConsent;
    const knownPeer = this.#peer.paired;
    if (this.#verificationCode === null) {
      throw new Error('The secure connection verification code is unavailable.');
    }
    this.startKeepAlive();
    if (!this.#initiator && knownPeer) {
      this.#prompt = null;
      this.#localConsent = true;
      this.sendSecure({ kind: SecureMessageKind.ConsentDecision, accepted: true });
    } else {
      this.#prompt = {
        promptId: randomUUID(),
        kind: PromptKind.Pairing,
        mode: this.#initiator
          ? ConsentPromptMode.WaitingForPeer
          : ConsentPromptMode.EnterVerificationCode,
        peerName: this.#peer.displayName,
        verificationCode: this.#initiator ? this.#verificationCode : null,
        intent: this.#intent,
        knownPeer: false
      };
    }
    if (this.#initiator) {
      this.#localConsent = true;
      this.sendSecure({ kind: SecureMessageKind.ConsentDecision, accepted: true });
    }
    this.notifyChanged();
  }

  private handleConsentDecision(message: ConsentDecisionMessage): void {
    if (this.#phase !== PeerSessionPhase.AwaitingConsent) {
      throw new Error('Unexpected consent response.');
    }
    this.#remoteConsent = message.accepted;
    if (!message.accepted) {
      this.closeWithError('The peer declined the connection.', true);
      return;
    }
    void this.tryEstablishConnection();
    this.notifyChanged();
  }

  private async tryEstablishConnection(): Promise<void> {
    if (
      this.#localConsent !== true ||
      this.#remoteConsent !== true ||
      this.#peer === null ||
      this.#peerPublicKey === null ||
      this.#intent === null
    ) {
      return;
    }
    if (!this.#initiator && !this.#peer.paired) {
      await this.#pairedPeerStore.rememberInbound({
        intent: this.#intent,
        deviceId: this.#peer.deviceId,
        displayName: this.#peer.displayName,
        publicKeyDer: this.#peerPublicKey,
        lastAddress: this.#remoteAddress
      });
      this.#peer = { ...this.#peer, paired: true };
    }
    this.#prompt = null;
    this.#phase = PeerSessionPhase.Connected;
    this.#connectedAt = Date.now();
    this.#role = this.initialRole();
    this.startKeepAlive();
    this.startDiagnosticsRecording();
    this.notifyChanged();
  }

  private handlePing(message: PingMessage): void {
    if (this.#phase !== PeerSessionPhase.Connected && this.#phase !== PeerSessionPhase.AwaitingConsent) {
      throw new Error('Health check received before the secure consent phase.');
    }
    this.sendSecure({ kind: SecureMessageKind.Pong, pingId: message.pingId });
  }

  private handlePong(message: PongMessage): void {
    const sentAt = this.#pendingPings.get(message.pingId);
    if (sentAt !== undefined) {
      this.#roundTripTimeMs = Math.max(0, Date.now() - sentAt);
      this.#pendingPings.delete(message.pingId);
      this.notifyChanged();
    }
  }

  private handleReversalRequest(message: ReversalRequestMessage): void {
    if (this.#phase !== PeerSessionPhase.Connected || this.#prompt !== null) {
      this.sendSecure({ kind: SecureMessageKind.ReversalDecision, requestId: message.requestId, accepted: false });
      return;
    }
    this.#pendingIncomingReversalId = message.requestId;
    this.#prompt = {
      promptId: randomUUID(),
      kind: PromptKind.Reversal,
      mode: ConsentPromptMode.Decision,
      peerName: this.#peer?.displayName ?? 'Peer',
      verificationCode: null,
      intent: null,
      knownPeer: true
    };
    this.notifyChanged();
  }

  private respondToReversal(accepted: boolean): void {
    if (this.#pendingIncomingReversalId === null) {
      throw new Error('The reversal request is no longer active.');
    }
    const requestId = this.#pendingIncomingReversalId;
    this.#pendingIncomingReversalId = null;
    this.#prompt = null;
    this.sendSecure({ kind: SecureMessageKind.ReversalDecision, requestId, accepted });
    if (accepted) {
      this.toggleRole();
    }
    this.notifyChanged();
  }

  private handleReversalDecision(message: ReversalDecisionMessage): void {
    if (this.#pendingOutgoingReversalId === null || message.requestId !== this.#pendingOutgoingReversalId) {
      throw new Error('Unexpected direction reversal response.');
    }
    this.#pendingOutgoingReversalId = null;
    if (message.accepted) {
      this.toggleRole();
    }
    this.notifyChanged();
  }

  private handleDiagnosticsRequest(message: DiagnosticsRequestMessage): void {
    if (this.#phase !== PeerSessionPhase.Connected) {
      throw new Error('Diagnostics requested before connection consent.');
    }
    const records = this.#diagnosticRecordProvider(message.limit).slice(-message.limit);
    if (records.length === 0) {
      this.sendSecure({
        kind: SecureMessageKind.DiagnosticsBatch,
        requestId: message.requestId,
        records: [],
        complete: true
      });
      return;
    }
    for (let offset = 0; offset < records.length; offset += DiagnosticDefaults.peerBatchRecordCount) {
      const batch = records.slice(offset, offset + DiagnosticDefaults.peerBatchRecordCount);
      this.sendSecure({
        kind: SecureMessageKind.DiagnosticsBatch,
        requestId: message.requestId,
        records: batch,
        complete: offset + batch.length >= records.length
      });
    }
  }

  private handleDiagnosticsBatch(message: DiagnosticsBatchMessage): void {
    const pending = this.#pendingDiagnosticRequests.get(message.requestId);
    if (pending === undefined) {
      return;
    }
    pending.records.push(...message.records);
    if (pending.records.length > pending.limit) {
      throw new Error('The peer returned too many diagnostic records.');
    }
    if (message.complete) {
      clearTimeout(pending.timeout);
      this.#pendingDiagnosticRequests.delete(message.requestId);
      pending.resolve(pending.records);
    }
  }

  private handleMediaSignal(message: MediaSignalMessage): void {
    if (this.#phase !== PeerSessionPhase.Connected) {
      throw new Error('Media negotiation arrived before connection consent.');
    }
    this.#mediaSignalListener(message.signal);
  }

  private startKeepAlive(): void {
    if (this.#keepAliveTimer !== null) {
      return;
    }
    this.#lastSecureMessageAt = Date.now();
    this.#keepAliveTimer = setInterval(() => this.keepAliveTick(), ConnectivityDefaults.keepAliveIntervalMs);
  }

  private startDiagnosticsRecording(): void {
    this.recordLocalDiagnostics();
    this.#diagnosticTimer = setInterval(
      () => this.recordLocalDiagnostics(),
      DiagnosticDefaults.peerSampleIntervalMs
    );
  }

  private recordLocalDiagnostics(): void {
    const transport = this.#transport.statistics();
    const values: ConnectionDiagnosticValues = {
      connectionState: this.connectionState(),
      role: this.#role,
      initiator: this.#initiator,
      remoteAddress: this.#remoteAddress,
      roundTripTimeMs: this.#roundTripTimeMs,
      connectedForMs: this.#connectedAt === null ? null : Date.now() - this.#connectedAt,
      lastSecureMessageAgeMs: Math.max(0, Date.now() - this.#lastSecureMessageAt),
      pendingHealthChecks: this.#pendingPings.size,
      controlFramesSent: transport.framesSent,
      controlFramesReceived: transport.framesReceived,
      controlBytesSent: transport.bytesSent,
      controlBytesReceived: transport.bytesReceived,
      encryptedMessagesSent: this.#cipher?.encryptedMessagesSent ?? 0,
      encryptedMessagesReceived: this.#cipher?.encryptedMessagesReceived ?? 0
    };
    this.#diagnosticSequence += 1;
    this.#diagnosticRecordListener({
      schemaVersion: DiagnosticDefaults.schemaVersion,
      sequence: this.#diagnosticSequence,
      timestamp: Date.now(),
      originDeviceId: this.#identity.deviceId,
      originDisplayName: this.#identity.displayName,
      category: DiagnosticCategory.Network,
      severity: DiagnosticSeverity.Information,
      event: 'connection.sample',
      values
    }, DiagnosticEventSource.Local);
  }

  private keepAliveTick(): void {
    const timeoutMs = this.#phase === PeerSessionPhase.Connected
      ? ConnectivityDefaults.connectionTimeoutMs
      : ConnectivityDefaults.pairingConnectionTimeoutMs;
    if (Date.now() - this.#lastSecureMessageAt > timeoutMs) {
      this.closeWithError('Connection health check timed out.', false);
      return;
    }
    const pingId = randomUUID();
    this.#pendingPings.set(pingId, Date.now());
    this.sendSecure({ kind: SecureMessageKind.Ping, pingId, sentAt: Date.now() });
  }

  private sendSecure(message: SecureMessage): void {
    if (this.#cipher === null) {
      throw new Error('Secure channel is not initialized.');
    }
    this.#transport.send(this.#cipher.encrypt(message));
  }

  private createPeer(deviceId: string, displayName: string, publicKey: string): ConnectedPeerDescriptor {
    return {
      deviceId,
      displayName,
      address: this.#remoteAddress,
      paired: !this.#initiator && this.#intent !== null && this.#pairedPeerStore.isTrusted(
        deviceId,
        publicKey,
        this.#intent
      )
    };
  }

  private initialRole(): LocalMediaRole {
    if (this.#intent === ConnectionIntent.ViewRemote) {
      return this.#initiator ? LocalMediaRole.Viewer : LocalMediaRole.Sharer;
    }
    return this.#initiator ? LocalMediaRole.Sharer : LocalMediaRole.Viewer;
  }

  private toggleRole(): void {
    this.#role = this.#role === LocalMediaRole.Viewer ? LocalMediaRole.Sharer : LocalMediaRole.Viewer;
  }

  private connectionState(): ConnectionState {
    if (this.#phase === PeerSessionPhase.Connected) {
      return ConnectionState.Connected;
    }
    if (this.#phase === PeerSessionPhase.AwaitingConsent) {
      return ConnectionState.Pairing;
    }
    if (this.#phase === PeerSessionPhase.Closed) {
      return this.#error === null ? ConnectionState.Idle : ConnectionState.Failed;
    }
    return ConnectionState.Connecting;
  }

  private startHandshakeTimer(): void {
    this.#handshakeTimer = setTimeout(
      () => this.closeWithError('Secure pairing handshake timed out.', false),
      ProtocolLimits.handshakeTimeoutMs
    );
  }

  private clearHandshakeTimer(): void {
    if (this.#handshakeTimer !== null) {
      clearTimeout(this.#handshakeTimer);
      this.#handshakeTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHandshakeTimer();
    if (this.#keepAliveTimer !== null) {
      clearInterval(this.#keepAliveTimer);
      this.#keepAliveTimer = null;
    }
    if (this.#diagnosticTimer !== null) {
      clearInterval(this.#diagnosticTimer);
      this.#diagnosticTimer = null;
    }
    this.rejectPendingDiagnosticRequests(new Error('The peer connection closed before diagnostics completed.'));
  }

  private handleTransportClosed(reason: string): void {
    if (!this.#intentionalClose && this.#phase !== PeerSessionPhase.Closed) {
      this.closeWithError(reason, false);
    }
  }

  private closeWithError(reason: string, expected: boolean): void {
    if (this.#phase === PeerSessionPhase.Closed) {
      return;
    }
    this.#intentionalClose = true;
    this.recordClosureDiagnostics(reason, expected);
    this.clearTimers();
    this.#prompt = null;
    this.#role = LocalMediaRole.None;
    this.#phase = PeerSessionPhase.Closed;
    this.#error = expected ? null : reason;
    this.#transport.close();
    this.notifyChanged();
  }

  private recordClosureDiagnostics(reason: string, expected: boolean): void {
    this.#diagnosticSequence += 1;
    this.#diagnosticRecordListener({
      schemaVersion: DiagnosticDefaults.schemaVersion,
      sequence: this.#diagnosticSequence,
      timestamp: Date.now(),
      originDeviceId: this.#identity.deviceId,
      originDisplayName: this.#identity.displayName,
      category: expected ? DiagnosticCategory.Lifecycle : DiagnosticCategory.Error,
      severity: expected ? DiagnosticSeverity.Information : DiagnosticSeverity.Error,
      event: 'connection.closed',
      values: {
        reason,
        expected,
        previousState: this.connectionState(),
        remoteAddress: this.#remoteAddress
      }
    }, DiagnosticEventSource.Local);
  }

  private notifyChanged(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  private rejectPendingDiagnosticRequests(error: Error): void {
    for (const pending of this.#pendingDiagnosticRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pendingDiagnosticRequests.clear();
  }
}
