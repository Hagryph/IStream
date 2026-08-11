import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../storage/AtomicJsonStore';

export interface StoredDeviceIdentity {
  readonly displayName: string;
  readonly publicKeyDer: string;
  readonly privateKeyDer: string;
}

export class DeviceIdentity {
  readonly #displayName: string;
  readonly #privateKey: KeyObject;
  readonly #publicKeyDer: Buffer;
  readonly #deviceId: string;

  public constructor(displayName: string, publicKeyDer: Buffer, privateKeyDer: Buffer) {
    this.#displayName = displayName;
    this.#publicKeyDer = Buffer.from(publicKeyDer);
    this.#privateKey = createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    this.#deviceId = DeviceIdentity.deviceIdForPublicKey(publicKeyDer);
  }

  public get deviceId(): string {
    return this.#deviceId;
  }

  public get displayName(): string {
    return this.#displayName;
  }

  public get publicKeyDerBase64(): string {
    return this.#publicKeyDer.toString('base64');
  }

  public sign(payload: Buffer): string {
    return sign(null, payload, this.#privateKey).toString('base64');
  }

  public static verify(publicKeyDerBase64: string, payload: Buffer, signatureBase64: string): boolean {
    return verify(
      null,
      payload,
      createPublicKey({ key: Buffer.from(publicKeyDerBase64, 'base64'), format: 'der', type: 'spki' }),
      Buffer.from(signatureBase64, 'base64')
    );
  }

  public static deviceIdForPublicKey(publicKeyDer: Buffer): string {
    return createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32);
  }
}

export class DeviceIdentityStore {
  readonly #store: AtomicJsonStore<StoredDeviceIdentity>;

  public constructor(userDataPath: string) {
    this.#store = new AtomicJsonStore<StoredDeviceIdentity>(join(userDataPath, 'identity.json'));
  }

  public async loadOrCreate(): Promise<DeviceIdentity> {
    const storedIdentity = await this.#store.read();
    if (storedIdentity !== null) {
      return new DeviceIdentity(
        storedIdentity.displayName,
        Buffer.from(storedIdentity.publicKeyDer, 'base64'),
        Buffer.from(storedIdentity.privateKeyDer, 'base64')
      );
    }

    const keyPair = generateKeyPairSync('ed25519');
    const publicKeyDer = keyPair.publicKey.export({ format: 'der', type: 'spki' });
    const privateKeyDer = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' });
    const newIdentity: StoredDeviceIdentity = {
      displayName: hostname().slice(0, 64),
      publicKeyDer: publicKeyDer.toString('base64'),
      privateKeyDer: privateKeyDer.toString('base64')
    };
    await this.#store.write(newIdentity);
    return new DeviceIdentity(newIdentity.displayName, publicKeyDer, privateKeyDer);
  }
}
