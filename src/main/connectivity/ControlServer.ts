import { createServer, type Server, type Socket } from 'node:net';

export type IncomingControlConnectionListener = (socket: Socket, remoteAddress: string) => void;

export class SocketAddressNormalizer {
  public normalize(address: string | undefined): string {
    if (address === undefined) {
      return '';
    }
    return address.startsWith('::ffff:') ? address.slice(7) : address;
  }
}

export class ControlServer {
  readonly #incomingListener: IncomingControlConnectionListener;
  readonly #addressNormalizer: SocketAddressNormalizer;
  #server: Server | null = null;
  #port: number = 0;

  public constructor(
    incomingListener: IncomingControlConnectionListener,
    addressNormalizer: SocketAddressNormalizer
  ) {
    this.#incomingListener = incomingListener;
    this.#addressNormalizer = addressNormalizer;
  }

  public get port(): number {
    return this.#port;
  }

  public async start(preferredPort: number): Promise<number> {
    if (this.#server !== null) {
      return this.#port;
    }
    if (preferredPort === 0) {
      return this.listenOnPort(0);
    }
    let lastError: unknown = null;
    for (let port = preferredPort; port <= Math.min(65_535, preferredPort + 10); port += 1) {
      try {
        return await this.listenOnPort(port);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No local control port is available.');
  }

  public async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = 0;
    if (server === null) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async listenOnPort(port: number): Promise<number> {
    const server = createServer((socket) => {
      const remoteAddress = this.#addressNormalizer.normalize(socket.remoteAddress);
      this.#incomingListener(socket, remoteAddress);
    });
    const boundPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', reject);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('Could not resolve the local control port.'));
          return;
        }
        resolve(address.port);
      });
    });
    this.#server = server;
    this.#port = boundPort;
    return boundPort;
  }
}
