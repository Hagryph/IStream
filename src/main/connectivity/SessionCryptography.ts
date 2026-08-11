import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject
} from 'node:crypto';
import { ConnectionIntent, ConnectivityDefaults } from '../../shared/ConnectivityContracts';
import { DeviceIdentity } from './DeviceIdentity';
import { DiagnosticDefaults } from '../../shared/DiagnosticContracts';
import { DiagnosticRecordValidator } from '../diagnostics/DiagnosticRecordValidator';
import {
  SecureMessageKind,
  WireMessageKind,
  type ClientHelloMessage,
  type SecureEnvelope,
  type SecureMessage,
  type ServerHelloMessage
} from './ProtocolContracts';

export class EphemeralKeyAgreement {
  readonly #privateKey: KeyObject;
  readonly #publicKeyDer: Buffer;

  public constructor() {
    const pair = generateKeyPairSync('x25519');
    this.#privateKey = pair.privateKey;
    this.#publicKeyDer = pair.publicKey.export({ format: 'der', type: 'spki' });
  }

  public get publicKeyBase64(): string {
    return this.#publicKeyDer.toString('base64');
  }

  public deriveSharedSecret(remotePublicKeyBase64: string): Buffer {
    const remotePublicKey = createPublicKey({
      key: Buffer.from(remotePublicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki'
    });
    return diffieHellman({ privateKey: this.#privateKey, publicKey: remotePublicKey });
  }
}

export class HandshakeFactory {
  readonly #identity: DeviceIdentity;

  public constructor(identity: DeviceIdentity) {
    this.#identity = identity;
  }

  public createClientHello(
    sessionId: string,
    agreement: EphemeralKeyAgreement,
    intent: ConnectionIntent
  ): ClientHelloMessage {
    const unsigned = {
      kind: WireMessageKind.ClientHello,
      protocolVersion: ConnectivityDefaults.protocolVersion,
      sessionId,
      deviceId: this.#identity.deviceId,
      displayName: this.#identity.displayName,
      identityPublicKey: this.#identity.publicKeyDerBase64,
      ephemeralPublicKey: agreement.publicKeyBase64,
      nonce: randomBytes(24).toString('base64'),
      intent
    } as const;
    return { ...unsigned, signature: this.#identity.sign(HandshakeTranscript.clientPayload(unsigned)) };
  }

  public createServerHello(
    clientHello: ClientHelloMessage,
    agreement: EphemeralKeyAgreement
  ): ServerHelloMessage {
    const unsigned = {
      kind: WireMessageKind.ServerHello,
      protocolVersion: ConnectivityDefaults.protocolVersion,
      sessionId: clientHello.sessionId,
      deviceId: this.#identity.deviceId,
      displayName: this.#identity.displayName,
      identityPublicKey: this.#identity.publicKeyDerBase64,
      ephemeralPublicKey: agreement.publicKeyBase64,
      nonce: randomBytes(24).toString('base64'),
      clientHelloHash: HandshakeTranscript.clientHelloHash(clientHello)
    } as const;
    return { ...unsigned, signature: this.#identity.sign(HandshakeTranscript.serverPayload(unsigned)) };
  }
}

export class HandshakeTranscript {
  public static clientPayload(message: Omit<ClientHelloMessage, 'signature'>): Buffer {
    return Buffer.from(
      JSON.stringify([
        message.kind,
        message.protocolVersion,
        message.sessionId,
        message.deviceId,
        message.displayName,
        message.identityPublicKey,
        message.ephemeralPublicKey,
        message.nonce,
        message.intent
      ]),
      'utf8'
    );
  }

  public static serverPayload(message: Omit<ServerHelloMessage, 'signature'>): Buffer {
    return Buffer.from(
      JSON.stringify([
        message.kind,
        message.protocolVersion,
        message.sessionId,
        message.deviceId,
        message.displayName,
        message.identityPublicKey,
        message.ephemeralPublicKey,
        message.nonce,
        message.clientHelloHash
      ]),
      'utf8'
    );
  }

  public static verifyClientHello(message: ClientHelloMessage): boolean {
    if (DeviceIdentity.deviceIdForPublicKey(Buffer.from(message.identityPublicKey, 'base64')) !== message.deviceId) {
      return false;
    }
    const unsigned: Omit<ClientHelloMessage, 'signature'> = {
      kind: message.kind,
      protocolVersion: message.protocolVersion,
      sessionId: message.sessionId,
      deviceId: message.deviceId,
      displayName: message.displayName,
      identityPublicKey: message.identityPublicKey,
      ephemeralPublicKey: message.ephemeralPublicKey,
      nonce: message.nonce,
      intent: message.intent
    };
    return DeviceIdentity.verify(message.identityPublicKey, this.clientPayload(unsigned), message.signature);
  }

  public static verifyServerHello(message: ServerHelloMessage, clientHello: ClientHelloMessage): boolean {
    if (
      message.sessionId !== clientHello.sessionId ||
      message.clientHelloHash !== this.clientHelloHash(clientHello) ||
      DeviceIdentity.deviceIdForPublicKey(Buffer.from(message.identityPublicKey, 'base64')) !== message.deviceId
    ) {
      return false;
    }
    const unsigned: Omit<ServerHelloMessage, 'signature'> = {
      kind: message.kind,
      protocolVersion: message.protocolVersion,
      sessionId: message.sessionId,
      deviceId: message.deviceId,
      displayName: message.displayName,
      identityPublicKey: message.identityPublicKey,
      ephemeralPublicKey: message.ephemeralPublicKey,
      nonce: message.nonce,
      clientHelloHash: message.clientHelloHash
    };
    return DeviceIdentity.verify(message.identityPublicKey, this.serverPayload(unsigned), message.signature);
  }

  public static clientHelloHash(message: ClientHelloMessage): string {
    return createHash('sha256').update(JSON.stringify(message)).digest('base64');
  }

  public static sessionHash(clientHello: ClientHelloMessage, serverHello: ServerHelloMessage): Buffer {
    return createHash('sha256')
      .update(JSON.stringify(clientHello))
      .update('\n')
      .update(JSON.stringify(serverHello))
      .digest();
  }

  public static verificationCode(sharedSecret: Buffer, sessionHash: Buffer): string {
    const digest = createHash('sha256').update(sharedSecret).update(sessionHash).digest();
    return `${digest.readUInt32BE(0) % 1_000_000}`.padStart(6, '0');
  }
}

export class SecureMessageCipher {
  readonly #sessionId: string;
  readonly #transmitKey: Buffer;
  readonly #receiveKey: Buffer;
  #transmitCounter: bigint = 0n;
  #receiveCounter: bigint = 0n;

  public constructor(
    sessionId: string,
    sharedSecret: Buffer,
    sessionHash: Buffer,
    initiator: boolean
  ) {
    this.#sessionId = sessionId;
    const keyMaterial = Buffer.from(
      hkdfSync('sha256', sharedSecret, sessionHash, Buffer.from('IStream control channel v1', 'utf8'), 64)
    );
    const initiatorToResponder = keyMaterial.subarray(0, 32);
    const responderToInitiator = keyMaterial.subarray(32, 64);
    this.#transmitKey = Buffer.from(initiator ? initiatorToResponder : responderToInitiator);
    this.#receiveKey = Buffer.from(initiator ? responderToInitiator : initiatorToResponder);
  }

  public encrypt(message: SecureMessage): SecureEnvelope {
    this.#transmitCounter += 1n;
    const counter = this.#transmitCounter.toString();
    const cipher = createCipheriv('aes-256-gcm', this.#transmitKey, this.nonce(this.#transmitCounter));
    cipher.setAAD(this.additionalData(counter));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
    return {
      kind: WireMessageKind.Secure,
      counter,
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    };
  }

  public get encryptedMessagesSent(): number {
    return Number(this.#transmitCounter);
  }

  public get encryptedMessagesReceived(): number {
    return Number(this.#receiveCounter);
  }

  public decrypt(envelope: SecureEnvelope): SecureMessage {
    const counter = BigInt(envelope.counter);
    if (counter !== this.#receiveCounter + 1n) {
      throw new Error('Secure control message counter is invalid.');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.#receiveKey, this.nonce(counter));
    decipher.setAAD(this.additionalData(envelope.counter));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]);
    const message = ProtocolValidator.secureMessage(JSON.parse(plaintext.toString('utf8')) as unknown);
    this.#receiveCounter = counter;
    return message;
  }

  private nonce(counter: bigint): Buffer {
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(counter, 4);
    return nonce;
  }

  private additionalData(counter: string): Buffer {
    return Buffer.from(`${this.#sessionId}:${counter}`, 'utf8');
  }
}

export class ProtocolValidator {
  public static clientHello(value: unknown): ClientHelloMessage {
    const candidate = this.record(value);
    if (
      candidate.kind !== WireMessageKind.ClientHello ||
      candidate.protocolVersion !== ConnectivityDefaults.protocolVersion ||
      !this.identifier(candidate.sessionId, 64) ||
      !this.identifier(candidate.deviceId, 32) ||
      !this.identifier(candidate.displayName, 64) ||
      !this.base64(candidate.identityPublicKey) ||
      !this.base64(candidate.ephemeralPublicKey) ||
      !this.base64(candidate.nonce) ||
      (candidate.intent !== ConnectionIntent.ViewRemote && candidate.intent !== ConnectionIntent.ShareLocal) ||
      !this.base64(candidate.signature)
    ) {
      throw new Error('Invalid client handshake.');
    }
    return candidate as unknown as ClientHelloMessage;
  }

  public static serverHello(value: unknown): ServerHelloMessage {
    const candidate = this.record(value);
    if (
      candidate.kind !== WireMessageKind.ServerHello ||
      candidate.protocolVersion !== ConnectivityDefaults.protocolVersion ||
      !this.identifier(candidate.sessionId, 64) ||
      !this.identifier(candidate.deviceId, 32) ||
      !this.identifier(candidate.displayName, 64) ||
      !this.base64(candidate.identityPublicKey) ||
      !this.base64(candidate.ephemeralPublicKey) ||
      !this.base64(candidate.nonce) ||
      !this.base64(candidate.clientHelloHash) ||
      !this.base64(candidate.signature)
    ) {
      throw new Error('Invalid server handshake.');
    }
    return candidate as unknown as ServerHelloMessage;
  }

  public static secureEnvelope(value: unknown): SecureEnvelope {
    const candidate = this.record(value);
    if (
      candidate.kind !== WireMessageKind.Secure ||
      typeof candidate.counter !== 'string' ||
      !/^\d{1,20}$/.test(candidate.counter) ||
      !this.base64(candidate.ciphertext) ||
      !this.base64(candidate.authTag)
    ) {
      throw new Error('Invalid secure control envelope.');
    }
    return candidate as unknown as SecureEnvelope;
  }

  public static secureMessage(value: unknown): SecureMessage {
    const candidate = this.record(value);
    switch (candidate.kind) {
      case SecureMessageKind.Ready:
      case SecureMessageKind.ReadyAcknowledged:
        return candidate as unknown as SecureMessage;
      case SecureMessageKind.ConsentDecision:
        if (typeof candidate.accepted === 'boolean') {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.Ping:
        if (this.identifier(candidate.pingId, 64) && typeof candidate.sentAt === 'number') {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.Pong:
        if (this.identifier(candidate.pingId, 64)) {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.ReversalRequest:
        if (this.identifier(candidate.requestId, 64)) {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.ReversalDecision:
        if (this.identifier(candidate.requestId, 64) && typeof candidate.accepted === 'boolean') {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.Disconnect:
      case SecureMessageKind.ProtocolError:
        if (this.identifier(candidate.reason, 256)) {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.DiagnosticsRequest:
        if (
          this.identifier(candidate.requestId, 64) &&
          typeof candidate.limit === 'number' &&
          Number.isInteger(candidate.limit) &&
          candidate.limit >= 1 &&
          candidate.limit <= DiagnosticDefaults.maximumPeerRecordsPerRequest
        ) {
          return candidate as unknown as SecureMessage;
        }
        break;
      case SecureMessageKind.DiagnosticsBatch:
        if (
          this.identifier(candidate.requestId, 64) &&
          Array.isArray(candidate.records) &&
          candidate.records.length <= DiagnosticDefaults.peerBatchRecordCount &&
          typeof candidate.complete === 'boolean'
        ) {
          return {
            kind: SecureMessageKind.DiagnosticsBatch,
            requestId: candidate.requestId,
            records: candidate.records.map((record) => new DiagnosticRecordValidator().validate(record)),
            complete: candidate.complete
          };
        }
        break;
      default:
        break;
    }
    throw new Error('Invalid secure control message.');
  }

  public static constantTimeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private static record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Invalid control message.');
    }
    return value as Record<string, unknown>;
  }

  private static identifier(value: unknown, maximumLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
  }

  private static base64(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }
}
