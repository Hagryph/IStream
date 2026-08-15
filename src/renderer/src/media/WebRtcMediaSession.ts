import { ConnectionState, LocalMediaRole, type ActiveConnectionDescriptor } from '../../../shared/ConnectivityContracts';
import {
  MediaSignalFactory,
  MediaSignalKind,
  type MediaApi,
  type MediaMetricSample,
  type MediaSignal
} from '../../../shared/MediaContracts';
import { VideoCodec, type StreamingConfiguration } from '../../../shared/StreamingConfigurationContracts';
import { WebRtcMetricsCollector } from './WebRtcMetricsCollector';

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
  readonly metrics: MediaMetricSample | null;
}

export type RendererMediaListener = (presentation: RendererMediaPresentation) => void;

export class WebRtcMediaSession {
  readonly #api: MediaApi;
  readonly #listener: RendererMediaListener;
  readonly #pendingSignals: MediaSignal[] = [];
  readonly #pendingCandidates: MediaSignal[] = [];
  readonly #pendingLocalSignals: MediaSignal[] = [];
  readonly #metricsCollector: WebRtcMetricsCollector = new WebRtcMetricsCollector();
  #peerConnection: RTCPeerConnection | null = null;
  #localStream: MediaStream | null = null;
  #remoteStream: MediaStream | null = null;
  #role: LocalMediaRole = LocalMediaRole.None;
  #generation: string | null = null;
  #configuration: StreamingConfiguration | null = null;
  #unsubscribeSignal: (() => void) | null = null;
  #restartTimer: number | null = null;
  #localDescriptionAnnounced: boolean = false;
  #metricsTimer: number | null = null;
  #lastPresentation: RendererMediaPresentation | null = null;

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
    this.#lastPresentation = null;
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
            max: configuration.targetFramesPerSecond
          }
        },
        audio: true
      });
      for (const track of this.#localStream.getTracks()) {
        if (track.kind === 'video') {
          track.contentHint = 'motion';
        }
        peerConnection.addTrack(track, this.#localStream);
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
    this.#pendingLocalSignals.splice(0);
    this.#localDescriptionAnnounced = false;
    const peerConnection = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
    peerConnection.onicecandidate = (event) => {
      const generation = this.#generation;
      if (generation === null) {
        return;
      }
      const signal = event.candidate === null
        ? MediaSignalFactory.iceComplete(generation)
        : MediaSignalFactory.iceCandidate(generation, event.candidate);
      this.sendOrQueueLocalSignal(signal);
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
        peerConnection.localDescription?.sdp ?? answer.sdp ?? ''
      ));
      this.#localDescriptionAnnounced = true;
      await this.flushPendingLocalSignals();
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
    if (iceRestart) {
      this.#generation = crypto.randomUUID();
      this.#pendingCandidates.splice(0);
    }
    const generation = this.#generation;
    if (generation === null) {
      return;
    }
    this.#localDescriptionAnnounced = false;
    this.#pendingLocalSignals.splice(0);
    const offer = await peerConnection.createOffer({ iceRestart });
    await peerConnection.setLocalDescription(offer);
    await this.#api.sendMediaSignal(MediaSignalFactory.sessionDescription(
      generation,
      MediaSignalKind.Offer,
      peerConnection.localDescription?.sdp ?? offer.sdp ?? ''
    ));
    this.#localDescriptionAnnounced = true;
    await this.flushPendingLocalSignals();
    await this.configureVideoSenders(peerConnection, this.requiredConfiguration());
  }

  private async configureVideoSenders(
    peerConnection: RTCPeerConnection,
    configuration: StreamingConfiguration
  ): Promise<void> {
    for (const sender of peerConnection.getSenders()) {
      if (sender.track?.kind === 'video') {
        await this.configureVideoSender(sender, configuration).catch(() => undefined);
      }
    }
  }

  private async configureVideoSender(sender: RTCRtpSender, configuration: StreamingConfiguration): Promise<void> {
    const parameters = sender.getParameters();
    const encoding = parameters.encodings[0];
    if (encoding === undefined) {
      return;
    }
    parameters.degradationPreference = 'maintain-resolution';
    encoding.active = true;
    encoding.maxBitrate = configuration.maximumBitrateMbps * 1_000_000;
    encoding.maxFramerate = configuration.targetFramesPerSecond;
    encoding.scaleResolutionDownBy = 1;
    await sender.setParameters(parameters);
  }

  private sendOrQueueLocalSignal(signal: MediaSignal): void {
    if (!this.#localDescriptionAnnounced) {
      this.#pendingLocalSignals.push(signal);
      return;
    }
    void this.#api.sendMediaSignal(signal).catch((error: unknown) => this.fail(error));
  }

  private async flushPendingLocalSignals(): Promise<void> {
    const signals = this.#pendingLocalSignals.splice(0);
    for (const signal of signals) {
      await this.#api.sendMediaSignal(signal);
    }
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
      this.startMetricsCollection();
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
    this.#lastPresentation = null;
    this.publish(RendererMediaState.Idle, 'Connect to another PC to begin streaming.', null, false);
  }

  private stopMediaResources(): void {
    if (this.#restartTimer !== null) {
      window.clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    if (this.#metricsTimer !== null) {
      window.clearInterval(this.#metricsTimer);
      this.#metricsTimer = null;
    }
    this.#metricsCollector.reset();
    this.#peerConnection?.close();
    this.#peerConnection = null;
    for (const track of this.#localStream?.getTracks() ?? []) {
      track.stop();
    }
    this.#localStream = null;
    this.#remoteStream = null;
    this.#pendingCandidates.splice(0);
    this.#pendingLocalSignals.splice(0);
    this.#localDescriptionAnnounced = false;
  }

  private fail(error: unknown): void {
    const detail = this.failureDetail(error);
    console.error('IStream media failure', error);
    this.publish(RendererMediaState.Failed, detail, this.#remoteStream, false);
  }

  private failureDetail(error: unknown): string {
    if (error instanceof TypeError) {
      return 'The saved video settings could not be applied. Restore the Gaming preset and reconnect.';
    }
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return 'Screen capture was not allowed. Disconnect and reconnect to try again.';
    }
    if (error instanceof DOMException && ['NotFoundError', 'NotReadableError'].includes(error.name)) {
      return 'Windows could not capture the selected screen or system audio. Close other capture software and reconnect.';
    }
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      return 'Screen capture could not start automatically. Disconnect, then connect again from this window.';
    }
    if (error instanceof DOMException && error.name === 'OperationError') {
      return 'The PCs could not negotiate a compatible video encoder. Select H.264 on both PCs and reconnect.';
    }
    return 'The media path could not start. Install the same latest IStream version on both PCs and reconnect.';
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
    this.#lastPresentation = { state, detail, stream, muted, metrics: this.#lastPresentation?.metrics ?? null };
    this.#listener(this.#lastPresentation);
  }

  private startMetricsCollection(): void {
    if (this.#metricsTimer !== null) {
      return;
    }
    void this.collectMetrics();
    this.#metricsTimer = window.setInterval(() => {
      void this.collectMetrics();
    }, 1000);
  }

  private async collectMetrics(): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || this.#role === LocalMediaRole.None || peerConnection.connectionState === 'closed') {
      return;
    }
    try {
      const metrics = await this.#metricsCollector.collect(peerConnection, this.#role);
      if (this.#lastPresentation !== null) {
        this.#lastPresentation = { ...this.#lastPresentation, metrics };
        this.#listener(this.#lastPresentation);
      }
      await this.#api.reportMediaMetrics(metrics);
    } catch (error: unknown) {
      console.warn('IStream media metrics could not be sampled', error);
    }
  }
}
