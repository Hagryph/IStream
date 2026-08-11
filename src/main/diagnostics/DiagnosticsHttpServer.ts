import { createServer, type Server, type ServerResponse } from 'node:http';
import { DiagnosticDefaults, type CollectedDiagnosticRecord, type DiagnosticsEndpointDescriptor } from '../../shared/DiagnosticContracts';
import { DiagnosticsHub } from './DiagnosticsHub';

export type RemoteDiagnosticsRequestHandler = (limit: number) => Promise<readonly CollectedDiagnosticRecord[]>;

export class DiagnosticsHttpServer {
  readonly #hub: DiagnosticsHub;
  readonly #remoteRequestHandler: RemoteDiagnosticsRequestHandler;
  readonly #clients: Set<ServerResponse> = new Set<ServerResponse>();
  #server: Server | null = null;
  #port: number = 0;
  #unsubscribe: (() => void) | null = null;
  #keepAliveTimer: NodeJS.Timeout | null = null;

  public constructor(hub: DiagnosticsHub, remoteRequestHandler: RemoteDiagnosticsRequestHandler) {
    this.#hub = hub;
    this.#remoteRequestHandler = remoteRequestHandler;
  }

  public descriptor(): DiagnosticsEndpointDescriptor | null {
    if (this.#port === 0) {
      return null;
    }
    const baseUrl = `http://127.0.0.1:${this.#port}`;
    return {
      baseUrl,
      snapshotCommand: `curl.exe ${baseUrl}/snapshot`,
      streamCommand: `curl.exe -N ${baseUrl}/stream`,
      peerSnapshotCommand: `curl.exe ${baseUrl}/peer/snapshot`,
      retainedRecordLimit: DiagnosticDefaults.retainedRecordLimit
    };
  }

  public async start(preferredPort: number = DiagnosticDefaults.preferredLoopbackPort): Promise<number> {
    if (this.#server !== null) {
      return this.#port;
    }
    let lastError: unknown = null;
    for (let port = preferredPort; port <= Math.min(65_535, preferredPort + 10); port += 1) {
      try {
        this.#port = await this.listen(port);
        this.#unsubscribe = this.#hub.subscribe((record) => this.broadcast(record));
        this.#keepAliveTimer = setInterval(() => this.broadcastKeepAlive(), 15_000);
        return this.#port;
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No loopback diagnostics port is available.');
  }

  public async stop(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#keepAliveTimer !== null) {
      clearInterval(this.#keepAliveTimer);
      this.#keepAliveTimer = null;
    }
    for (const client of this.#clients) {
      client.end();
    }
    this.#clients.clear();
    const server = this.#server;
    this.#server = null;
    this.#port = 0;
    if (server !== null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async listen(port: number): Promise<number> {
    const server = createServer((request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET') {
        this.writeJson(response, 405, { error: 'Only GET is supported.' });
        return;
      }
      if (request.url === '/snapshot') {
        this.writeJson(response, 200, this.#hub.snapshot());
        return;
      }
      if (request.url === '/stream') {
        this.openStream(response);
        request.once('close', () => this.#clients.delete(response));
        return;
      }
      if (request.url === '/health') {
        this.writeJson(response, 200, { status: 'ready', retainedRecords: this.#hub.snapshot().length });
        return;
      }
      if (request.url?.startsWith('/peer/snapshot') === true) {
        void this.writeRemoteSnapshot(request.url, response);
        return;
      }
      this.writeJson(response, 404, { error: 'Use /snapshot, /stream, /peer/snapshot, or /health.' });
    });
    const boundPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('Could not resolve the diagnostics loopback port.'));
          return;
        }
        resolve(address.port);
      });
    });
    this.#server = server;
    return boundPort;
  }

  private openStream(response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      Connection: 'keep-alive'
    });
    for (const record of this.#hub.snapshot()) {
      response.write(`${JSON.stringify(record)}\n`);
    }
    this.#clients.add(response);
  }

  private broadcast(record: CollectedDiagnosticRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    for (const client of this.#clients) {
      if (client.destroyed || client.writableEnded) {
        this.#clients.delete(client);
      } else {
        client.write(line);
      }
    }
  }

  private broadcastKeepAlive(): void {
    for (const client of this.#clients) {
      if (!client.destroyed && !client.writableEnded) {
        client.write('\n');
      }
    }
  }

  private async writeRemoteSnapshot(requestUrl: string, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(requestUrl, 'http://127.0.0.1');
      const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? `${DiagnosticDefaults.maximumPeerRecordsPerRequest}`, 10);
      const limit = Math.max(1, Math.min(DiagnosticDefaults.maximumPeerRecordsPerRequest, requestedLimit));
      this.writeJson(response, 200, await this.#remoteRequestHandler(limit));
    } catch (error: unknown) {
      this.writeJson(response, 503, { error: error instanceof Error ? error.message : 'Remote diagnostic request failed.' });
    }
  }

  private writeJson(response: ServerResponse, status: number, value: object | readonly object[]): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value, null, 2));
  }
}
