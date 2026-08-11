import { ConnectionState, LocalMediaRole, type ActiveConnectionDescriptor } from '../../../shared/ConnectivityContracts';
import {
  MediaSignalFactory,
  MediaSignalKind,
  type MediaApi,
  type MediaSignal
} from '../../../shared/MediaContracts';
import { VideoCodec, type StreamingConfiguration } from '../../../shared/StreamingConfigurationContracts';

export enum RendererMediaState {
  Idle = 'idle',
  Capturing = 'capturing',
  Negotiating = 'negotiating',
  Streaming = 'streaming',
  Reconnecting = 'reconnecting',
  Failed = 'failed'
}

export interface RendererMediaPresentation {
  readonly state: RendererMediaState;
  readonly detail: string;
  readonly stream: MediaStream | null;
  readonly muted: boolean;
}

export type RendererMediaListener = (presentation: RendererMediaPresentation) => void;

export class WebRtcMediaSession {
  readonly #api: MediaApi;
  readonly #listener: RendererMediaListener;
  readonly #pendingSignals: MediaSignal[] = [];
  readonly #pendingCandidates: MediaSignal[] = [];
  #peerConnection: RTCPeerConnection | null = null;
  #localStream: MediaStream | null = null;
  #remoteStream: MediaStream | null = null;
  #role: LocalMediaRole = LocalMediaRole.None;
  #generation: string | null = null;
  #configuration: StreamingConfiguration | null = null;
  #unsubscribeSignal: (() => void) | null = null;
  #restartTimer: number | null = null;

  public constructor(api: MediaApi, listener: RendererMediaListener) {
    this.#api = api;
    this.#listener = listener;
  }

  public install(): void {
    this.#unsubscribeSignal = this.#api.onMediaSignal((signal) => this.receiveSignal(signal));
  }

  public synchronize(connection: ActiveConnectionDescriptor, configuration: StreamingConfiguration): void {
    if (connection.state !== ConnectionState.Connected || connection.role === LocalMediaRole.None) {
      this.stop();
      return;
    }
    if (this.#role === connection.role && this.#configuration !== null) {
      this.#configuration = configuration;
      return;
    }
    this.stopMediaResources();
    this.#role = connection.role;
    this.#configuration = configuration;
    if (this.#role === LocalMediaRole.Viewer) {
      this.createPeerConnection();
      this.publish(RendererMediaState.Negotiating, 'Waiting for the shared screen...', null, false);
      this.flushPendingSignals();
      return;
    }
    void this.startSharing();
  }

  public dispose(): void {
    this.#unsubscribeSignal?.();
    this.#unsubscribeSignal = null;
    this.stop();
  }

  private receiveSignal(signal: MediaSignal): void {
    if (this.#role === LocalMediaRole.None) {
      this.#pendingSignals.push(signal);
      return;
    }
    void this.consumeSignal(signal).catch((error: unknown) => this.fail(error));
  }

  private flushPendingSignals(): void {
    const signals = this.#pendingSignals.splice(0);
    for (const signal of signals) {
      this.receiveSignal(signal);
    }
  }

  private async startSharing(): Promise<void> {
    const configuration = this.requiredConfiguration();
    this.publish(RendererMediaState.Capturing, 'Starting screen and system-audio capture...', null, true);
    try {
      this.#generation = crypto.randomUUID();
      const peerConnection = this.createPeerConnection();
      this.#localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: configuration.targetWidth },
          height: { ideal: configuration.targetHeight },
          frameRate: {
            ideal: configuration.targetFramesPerSecond,
            min: configuration.minimumFramesPerSecond
          }
        },
        audio: true
      });
      for (const track of this.#localStream.getTracks()) {
        if (track.kind === 'video') {
          track.contentHint = 'motion';
        }
        const sender = peerConnection.addTrack(track, this.#localStream);
        if (track.kind === 'video') {
          await this.configureVideoSender(sender, configuration);
        }
      }
      this.preferConfiguredVideoCodec(peerConnection, configuration.codec);
      this.publish(RendererMediaState.Negotiating, 'Connecting the video and audio stream...', this.#localStream, true);
      await this.sendOffer(false);
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    this.#peerConnection?.close();
    const peerConnection = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
    peerConnection.onicecandidate = (event) => {
      const generation = this.#generation;
      if (generation === null) {
        return;
      }
      const signal = event.candidate === null
        ? MediaSignalFactory.iceComplete(generation)
        : MediaSignalFactory.iceCandidate(generation, event.candidate);
      void this.#api.sendMediaSignal(signal).catch((error: unknown) => this.fail(error));
    };
    peerConnection.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream !== undefined) {
        this.#remoteStream = stream;
        this.publish(RendererMediaState.Streaming, 'Receiving HD video and system audio.', stream, false);
      }
    };
    peerConnection.onconnectionstatechange = () => this.handleConnectionState(peerConnection.connectionState);
    this.#peerConnection = peerConnection;
    return peerConnection;
  }

  private async consumeSignal(signal: MediaSignal): Promise<void> {
    if (signal.kind === MediaSignalKind.Offer) {
      if (this.#role !== LocalMediaRole.Viewer || signal.sdp === null) {
        return;
      }
      if (this.#generation !== signal.generation) {
        this.#generation = signal.generation;
        this.#pendingCandidates.splice(0);
        this.createPeerConnection();
      }
      const peerConnection = this.requiredPeerConnection();
      await peerConnection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      this.preferConfiguredVideoCodec(peerConnection, this.requiredConfiguration().codec);
      await this.flushPendingCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await this.#api.sendMediaSignal(MediaSignalFactory.sessionDescription(
        signal.generation,
        MediaSignalKind.Answer,
        answer.sdp ?? ''
      ));
      return;
    }
    if (signal.generation !== this.#generation) {
      return;
    }
    if (signal.kind === MediaSignalKind.Answer) {
      if (this.#role === LocalMediaRole.Sharer && signal.sdp !== null) {
        const peerConnection = this.requiredPeerConnection();
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await this.flushPendingCandidates();
      }
      return;
    }
    if (signal.kind === MediaSignalKind.IceCandidate) {
      const peerConnection = this.requiredPeerConnection();
      if (peerConnection.remoteDescription === null) {
        this.#pendingCandidates.push(signal);
        return;
      }
      await this.addCandidate(peerConnection, signal);
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const peerConnection = this.requiredPeerConnection();
    const candidates = this.#pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await this.addCandidate(peerConnection, candidate);
    }
  }

  private async addCandidate(peerConnection: RTCPeerConnection, signal: MediaSignal): Promise<void> {
    if (signal.candidate === null) {
      return;
    }
    await peerConnection.addIceCandidate({
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex
    });
  }

  private async sendOffer(iceRestart: boolean): Promise<void> {
    const peerConnection = this.requiredPeerConnection();
    const generation = this.#generation;
    if (generation === null) {
      return;
    }
    const offer = await peerConnection.createOffer({ iceRestart });
    await peerConnection.setLocalDescription(offer);
    await this.#api.sendMediaSignal(MediaSignalFactory.sessionDescription(
      generation,
      MediaSignalKind.Offer,
      offer.sdp ?? ''
    ));
  }

  private async configureVideoSender(sender: RTCRtpSender, configuration: StreamingConfiguration): Promise<void> {
    const parameters = sender.getParameters();
    parameters.degradationPreference = 'maintain-resolution';
    parameters.encodings = parameters.encodings.length === 0 ? [{}] : parameters.encodings;
    parameters.encodings[0] = {
      ...parameters.encodings[0],
      active: true,
      maxBitrate: configuration.maximumBitrateMbps * 1_000_000,
      maxFramerate: configuration.targetFramesPerSecond,
      scaleResolutionDownBy: 1
    };
    await sender.setParameters(parameters);
  }

  private preferConfiguredVideoCodec(peerConnection: RTCPeerConnection, codec: VideoCodec): void {
    const capabilities = RTCRtpReceiver.getCapabilities('video');
    if (capabilities === null) {
      return;
    }
    const preferredMimeTypes = codec === VideoCodec.Hevc
      ? ['video/H265', 'video/HEVC', 'video/H264']
      : ['video/H264'];
    const ordered = [...capabilities.codecs].sort((left, right) => {
      const leftIndex = preferredMimeTypes.indexOf(left.mimeType);
      const rightIndex = preferredMimeTypes.indexOf(right.mimeType);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    });
    for (const transceiver of peerConnection.getTransceivers()) {
      if (transceiver.receiver.track.kind === 'video') {
        transceiver.setCodecPreferences(ordered);
      }
    }
  }

  private handleConnectionState(state: RTCPeerConnectionState): void {
    if (state === 'connected') {
      const stream = this.#role === LocalMediaRole.Sharer ? this.#localStream : this.#remoteStream;
      this.publish(RendererMediaState.Streaming, 'HD video and system audio are connected.', stream, this.#role === LocalMediaRole.Sharer);
      return;
    }
    if (state !== 'disconnected' && state !== 'failed') {
      return;
    }
    this.publish(RendererMediaState.Reconnecting, 'The media path was interrupted. Reconnecting...', this.#remoteStream, false);
    if (this.#role === LocalMediaRole.Sharer && this.#restartTimer === null) {
      this.#restartTimer = window.setTimeout(() => {
        this.#restartTimer = null;
        void this.sendOffer(true).catch((error: unknown) => this.fail(error));
      }, 1500);
    }
  }

  private stop(): void {
    if (this.#role === LocalMediaRole.None && this.#peerConnection === null) {
      return;
    }
    this.stopMediaResources();
    this.#role = LocalMediaRole.None;
    this.#configuration = null;
    this.#generation = null;
    this.#pendingSignals.splice(0);
    this.publish(RendererMediaState.Idle, 'Connect to another PC to begin streaming.', null, false);
  }

  private stopMediaResources(): void {
    if (this.#restartTimer !== null) {
      window.clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    this.#peerConnection?.close();
    this.#peerConnection = null;
    for (const track of this.#localStream?.getTracks() ?? []) {
      track.stop();
    }
    this.#localStream = null;
    this.#remoteStream = null;
    this.#pendingCandidates.splice(0);
  }

  private fail(error: unknown): void {
    const detail = error instanceof DOMException && error.name === 'NotAllowedError'
      ? 'Screen capture was not allowed. Disconnect and reconnect to try again.'
      : 'The video stream could not start. Disconnect and reconnect; verify that both PCs use the latest IStream version.';
    this.publish(RendererMediaState.Failed, detail, this.#remoteStream, false);
  }

  private requiredPeerConnection(): RTCPeerConnection {
    if (this.#peerConnection === null) {
      throw new Error('The media connection is not ready.');
    }
    return this.#peerConnection;
  }

  private requiredConfiguration(): StreamingConfiguration {
    if (this.#configuration === null) {
      throw new Error('The streaming configuration is not ready.');
    }
    return this.#configuration;
  }

  private publish(state: RendererMediaState, detail: string, stream: MediaStream | null, muted: boolean): void {
    this.#listener({ state, detail, stream, muted });
  }
}
