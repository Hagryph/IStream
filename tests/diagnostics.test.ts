import { afterEach, describe, expect, test } from 'vitest';
import {
  DiagnosticCategory,
  DiagnosticDefaults,
  DiagnosticEventSource,
  DiagnosticSeverity,
  type CollectedDiagnosticRecord,
  type DiagnosticRecord
} from '../src/shared/DiagnosticContracts';
import { DiagnosticsHub } from '../src/main/diagnostics/DiagnosticsHub';
import { DiagnosticsHttpServer } from '../src/main/diagnostics/DiagnosticsHttpServer';
import { ProtocolValidator, SecureMessageCipher } from '../src/main/connectivity/SessionCryptography';
import { SecureMessageKind } from '../src/main/connectivity/ProtocolContracts';

class DiagnosticsTestSuite {
  readonly #servers: DiagnosticsHttpServer[] = [];

  public register(): void {
    describe('loopback diagnostics', () => {
      afterEach(async () => this.dispose());

      test('serves retained local records and requests peer records only on demand', async () => {
        const hub = new DiagnosticsHub(20);
        const localRecord = this.record(1, 'local.sample');
        const remoteRecord = this.record(2, 'remote.sample');
        const remoteCollected: CollectedDiagnosticRecord = {
          receivedAt: Date.now(),
          source: DiagnosticEventSource.Remote,
          record: remoteRecord
        };
        let remoteRequestCount = 0;
        hub.publish(localRecord, DiagnosticEventSource.Local);
        const server = new DiagnosticsHttpServer(hub, async () => {
          remoteRequestCount += 1;
          return [remoteCollected];
        });
        this.#servers.push(server);
        await server.start(0);
        const descriptor = server.descriptor();
        expect(descriptor?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

        const localResponse = await fetch(`${descriptor?.baseUrl ?? ''}/snapshot`);
        const localBody = await localResponse.json() as CollectedDiagnosticRecord[];
        expect(localBody).toHaveLength(1);
        expect(localBody[0]?.record.event).toBe('local.sample');
        expect(remoteRequestCount).toBe(0);

        const remoteResponse = await fetch(`${descriptor?.baseUrl ?? ''}/peer/snapshot?limit=5`);
        const remoteBody = await remoteResponse.json() as CollectedDiagnosticRecord[];
        expect(remoteBody[0]?.record.event).toBe('remote.sample');
        expect(remoteRequestCount).toBe(1);
        expect(descriptor?.retainedDurationMs).toBe(10 * 60 * 1000);
      });

      test('retains the rolling time window and prunes older records on read', () => {
        let currentTime = 1_000_000;
        const retentionDurationMs = 10 * 60 * 1000;
        const hub = new DiagnosticsHub(20, retentionDurationMs, () => currentTime);
        hub.publish(this.record(1, 'window.boundary'), DiagnosticEventSource.Local);
        currentTime += retentionDurationMs;
        hub.publish(this.record(2, 'window.current'), DiagnosticEventSource.Local);
        expect(hub.snapshot().map((entry) => entry.record.event)).toEqual([
          'window.boundary',
          'window.current'
        ]);

        currentTime += 1;
        expect(hub.snapshot().map((entry) => entry.record.event)).toEqual(['window.current']);
      });

      test('enforces the secondary record cap during bursts', () => {
        const hub = new DiagnosticsHub(2, DiagnosticDefaults.retainedDurationMs);
        hub.publish(this.record(1, 'burst.first'), DiagnosticEventSource.Local);
        hub.publish(this.record(2, 'burst.second'), DiagnosticEventSource.Local);
        hub.publish(this.record(3, 'burst.third'), DiagnosticEventSource.Local);

        expect(hub.snapshot().map((entry) => entry.record.event)).toEqual([
          'burst.second',
          'burst.third'
        ]);
      });

      test('accepts encrypted ten-record diagnostic batches larger than the old envelope limit', () => {
        const sharedSecret = Buffer.alloc(32, 7);
        const sessionHash = Buffer.alloc(32, 9);
        const sender = new SecureMessageCipher('diagnostic-batch-test', sharedSecret, sessionHash, true);
        const receiver = new SecureMessageCipher('diagnostic-batch-test', sharedSecret, sessionHash, false);
        const records = Array.from({ length: DiagnosticDefaults.peerBatchRecordCount }, (_value, index) => ({
          ...this.record(index + 1, 'connection.sample'),
          values: {
            roundTripTimeMs: 3,
            controlBytesSent: 25_000,
            controlBytesReceived: 25_100,
            details: 'x'.repeat(240)
          }
        }));
        const envelope = sender.encrypt({
          kind: SecureMessageKind.DiagnosticsBatch,
          requestId: '00000000-0000-0000-0000-000000000000',
          records,
          complete: true
        });

        expect(envelope.ciphertext.length).toBeGreaterThan(4096);
        const decrypted = receiver.decrypt(ProtocolValidator.secureEnvelope(envelope));
        expect(decrypted.kind).toBe(SecureMessageKind.DiagnosticsBatch);
        if (decrypted.kind === SecureMessageKind.DiagnosticsBatch) {
          expect(decrypted.records).toHaveLength(DiagnosticDefaults.peerBatchRecordCount);
        }
      });
    });
  }

  private record(sequence: number, event: string): DiagnosticRecord {
    return {
      schemaVersion: DiagnosticDefaults.schemaVersion,
      sequence,
      timestamp: Date.now(),
      originDeviceId: '0123456789abcdef0123456789abcdef',
      originDisplayName: 'Diagnostics test',
      category: DiagnosticCategory.Network,
      severity: DiagnosticSeverity.Information,
      event,
      values: { roundTripTimeMs: 3 }
    };
  }

  private async dispose(): Promise<void> {
    await Promise.all(this.#servers.map((server) => server.stop()));
    this.#servers.length = 0;
  }
}

new DiagnosticsTestSuite().register();
