import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ConnectionIntent, ConnectivityDefaults } from '../src/shared/ConnectivityContracts';
import { PairedPeerStore } from '../src/main/connectivity/PairedPeerStore';
import { AtomicJsonStore } from '../src/main/storage/AtomicJsonStore';

class DirectionalTrustTestSuite {
  readonly #directories: string[] = [];

  public register(): void {
    describe('directional peer trust', () => {
      afterEach(async () => this.dispose());

      test('expires inbound trust after thirty days', async () => {
        const directory = await this.createDirectory();
        let now = 1_800_000_000_000;
        const store = new PairedPeerStore(directory, () => now);
        await store.load();
        const record = await store.rememberInbound({
          intent: ConnectionIntent.ViewRemote,
          deviceId: '0123456789abcdef0123456789abcdef',
          displayName: 'Requester',
          publicKeyDer: 'dGVzdC1wdWJsaWMta2V5',
          lastAddress: '192.168.1.20'
        });

        expect(record.expiresAt).toBe(now + ConnectivityDefaults.trustDurationMs);
        expect(store.isTrusted(record.deviceId, record.publicKeyDer, ConnectionIntent.ViewRemote)).toBe(true);
        expect(store.isTrusted(record.deviceId, record.publicKeyDer, ConnectionIntent.ShareLocal)).toBe(false);
        now += ConnectivityDefaults.trustDurationMs - 1;
        expect(store.get(record.deviceId, ConnectionIntent.ViewRemote)).not.toBeNull();
        now += 1;
        expect(store.isTrusted(record.deviceId, record.publicKeyDer, ConnectionIntent.ViewRemote)).toBe(false);
        expect(store.records()).toHaveLength(0);
      });

      test('clears one inbound trust without affecting another', async () => {
        const directory = await this.createDirectory();
        const store = new PairedPeerStore(directory);
        await store.load();
        await store.rememberInbound({
          intent: ConnectionIntent.ViewRemote,
          deviceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          displayName: 'First',
          publicKeyDer: 'Zmlyc3Q=',
          lastAddress: '192.168.1.21'
        });
        await store.rememberInbound({
          intent: ConnectionIntent.ShareLocal,
          deviceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          displayName: 'Second',
          publicKeyDer: 'c2Vjb25k',
          lastAddress: '192.168.1.22'
        });

        await store.clear('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(store.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ConnectionIntent.ViewRemote)).toBeNull();
        expect(store.get('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ConnectionIntent.ShareLocal)).not.toBeNull();
      });

      test('discards legacy symmetric pair records because their direction is unknown', async () => {
        const directory = await this.createDirectory();
        const rawStore = new AtomicJsonStore<{ readonly peers: readonly unknown[] }>(
          join(directory, 'paired-peers.json')
        );
        await rawStore.write({
          peers: [{
            deviceId: 'cccccccccccccccccccccccccccccccc',
            displayName: 'Legacy peer',
            publicKeyDer: 'bGVnYWN5',
            lastAddress: '192.168.1.23',
            pairedAt: Date.now()
          }]
        });
        const store = new PairedPeerStore(directory);

        await store.load();
        expect(store.records()).toHaveLength(0);
      });
    });
  }

  private async createDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'istream-trust-test-'));
    this.#directories.push(directory);
    return directory;
  }

  private async dispose(): Promise<void> {
    await Promise.all(this.#directories.map((directory) => rm(directory, { recursive: true, force: true })));
    this.#directories.length = 0;
  }
}

new DirectionalTrustTestSuite().register();
