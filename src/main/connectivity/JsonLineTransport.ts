import type { Socket } from 'node:net';

export type TransportMessageListener = (message: unknown) => void;
export type TransportClosedListener = (reason: string) => void;

export interface TransportStatistics {
  readonly framesSent: number;
  readonly framesReceived: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
}

export class JsonLineTransport {
  readonly #socket: Socket;
  readonly #maximumFrameBytes: number;
  readonly #messageListeners: Set<TransportMessageListener> = new Set<TransportMessageListener>();
  readonly #closedListeners: Set<TransportClosedListener> = new Set<TransportClosedListener>();
  #buffer: string = '';
  #closed: boolean = false;
  #framesSent: number = 0;
  #framesReceived: number = 0;
  #bytesSent: number = 0;
  #bytesReceived: number = 0;

  public constructor(socket: Socket, maximumFrameBytes: number) {
    this.#socket = socket;
    this.#maximumFrameBytes = maximumFrameBytes;
    this.#socket.setEncoding('utf8');
    this.#socket.setNoDelay(true);
    this.#socket.on('data', (chunk: string) => this.handleData(chunk));
    this.#socket.on('error', (error: Error) => this.notifyClosed(error.message));
    this.#socket.on('close', () => this.notifyClosed('The peer closed the connection.'));
  }

  public send(message: object): void {
    if (this.#closed) {
      throw new Error('The control connection is closed.');
    }
    const frame = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(frame, 'utf8') > this.#maximumFrameBytes) {
      throw new Error('The control message is too large.');
    }
    this.#framesSent += 1;
    this.#bytesSent += Buffer.byteLength(frame, 'utf8');
    this.#socket.write(frame);
  }

  public subscribeMessages(listener: TransportMessageListener): () => void {
    this.#messageListeners.add(listener);
    return (): void => {
      this.#messageListeners.delete(listener);
    };
  }

  public subscribeClosed(listener: TransportClosedListener): () => void {
    this.#closedListeners.add(listener);
    return (): void => {
      this.#closedListeners.delete(listener);
    };
  }

  public close(): void {
    this.#closed = true;
    if (!this.#socket.destroyed) {
      this.#socket.destroy();
    }
  }

  public statistics(): TransportStatistics {
    return {
      framesSent: this.#framesSent,
      framesReceived: this.#framesReceived,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived
    };
  }

  private handleData(chunk: string): void {
    this.#bytesReceived += Buffer.byteLength(chunk, 'utf8');
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer, 'utf8') > this.#maximumFrameBytes) {
      this.notifyClosed('The peer sent an oversized control message.');
      this.close();
      return;
    }
    let lineBreakIndex = this.#buffer.indexOf('\n');
    while (lineBreakIndex >= 0) {
      const line = this.#buffer.slice(0, lineBreakIndex);
      this.#buffer = this.#buffer.slice(lineBreakIndex + 1);
      if (line.length > 0) {
        this.#framesReceived += 1;
        this.parseLine(line);
      }
      lineBreakIndex = this.#buffer.indexOf('\n');
    }
  }

  private parseLine(line: string): void {
    try {
      const message: unknown = JSON.parse(line);
      for (const listener of this.#messageListeners) {
        listener(message);
      }
    } catch {
      this.notifyClosed('The peer sent invalid control data.');
      this.close();
    }
  }

  private notifyClosed(reason: string): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const listener of this.#closedListeners) {
      listener(reason);
    }
  }
}
