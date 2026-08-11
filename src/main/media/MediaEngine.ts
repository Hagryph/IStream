import { LocalMediaRole } from '../../shared/ConnectivityContracts';

export enum MediaEngineState {
  Unavailable = 'unavailable',
  Ready = 'ready',
  Running = 'running'
}

export interface MediaEngineCapabilities {
  readonly state: MediaEngineState;
  readonly detail: string;
  readonly supportsH264: boolean;
  readonly supportsHevc: boolean;
  readonly supportsHdr: boolean;
  readonly supportsInputInjection: boolean;
}

export interface MediaSessionConfiguration {
  readonly role: LocalMediaRole;
  readonly minimumWidth: number;
  readonly minimumHeight: number;
  readonly targetFramesPerSecond: number;
}

export interface MediaEngine {
  capabilities(): Promise<MediaEngineCapabilities>;
  start(configuration: MediaSessionConfiguration): Promise<void>;
  stop(): Promise<void>;
}

export class NativeSidecarMediaEngine implements MediaEngine {
  public async capabilities(): Promise<MediaEngineCapabilities> {
    return {
      state: MediaEngineState.Unavailable,
      detail: 'Native capture, NVENC, transport, decode, and input sidecar is the next implementation boundary.',
      supportsH264: false,
      supportsHevc: false,
      supportsHdr: false,
      supportsInputInjection: false
    };
  }

  public async start(_configuration: MediaSessionConfiguration): Promise<void> {
    throw new Error('The native media sidecar is not installed in this baseline.');
  }

  public async stop(): Promise<void> {
    return Promise.resolve();
  }
}
