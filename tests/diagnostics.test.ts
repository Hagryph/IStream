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
