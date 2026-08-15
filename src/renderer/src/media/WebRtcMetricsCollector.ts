import { LocalMediaRole } from '../../../shared/ConnectivityContracts';
import type { MediaMetricSample } from '../../../shared/MediaContracts';

export interface RtcStatsRecord extends Record<string, unknown> {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number;
}

export interface MediaStatsBaseline {
  readonly timestamp: number;
  readonly videoBytes: number | null;
  readonly audioBytes: number | null;
  readonly frames: number | null;
  readonly processingTime: number | null;
  readonly jitterBufferDelay: number | null;
  readonly jitterBufferEmittedCount: number | null;
  readonly packetsReceived: number | null;
  readonly packetsLost: number | null;
}

export class WebRtcMetricsCollector {
  #baseline: MediaStatsBaseline | null = null;

  public reset(): void {
    this.#baseline = null;
  }

  public async collect(
    peerConnection: RTCPeerConnection,
    role: LocalMediaRole
  ): Promise<MediaMetricSample> {
    const report = await peerConnection.getStats();
    const records: RtcStatsRecord[] = [];
    report.forEach((record) => records.push(record as RtcStatsRecord));
    const inboundVideo = this.rtp(records, 'inbound-rtp', 'video');
    const inboundAudio = this.rtp(records, 'inbound-rtp', 'audio');
    const outboundVideo = this.rtp(records, 'outbound-rtp', 'video');
    const outboundAudio = this.rtp(records, 'outbound-rtp', 'audio');
    const remoteInboundVideo = this.rtp(records, 'remote-inbound-rtp', 'video');
    const video = role === LocalMediaRole.Viewer ? inboundVideo : outboundVideo;
    const audio = role === LocalMediaRole.Viewer ? inboundAudio : outboundAudio;
    const lossSource = role === LocalMediaRole.Viewer ? inboundVideo : remoteInboundVideo;
    const now = Date.now();
    const videoBytes = this.numeric(video, role === LocalMediaRole.Viewer ? 'bytesReceived' : 'bytesSent');
    const audioBytes = this.numeric(audio, role === LocalMediaRole.Viewer ? 'bytesReceived' : 'bytesSent');
    const frames = this.numeric(video, role === LocalMediaRole.Viewer ? 'framesDecoded' : 'framesEncoded');
    const processingTime = this.numeric(video, role === LocalMediaRole.Viewer ? 'totalDecodeTime' : 'totalEncodeTime');
    const jitterBufferDelay = this.numeric(inboundVideo, 'jitterBufferDelay');
    const jitterBufferEmittedCount = this.numeric(inboundVideo, 'jitterBufferEmittedCount');
    const packetsReceived = this.numeric(lossSource, 'packetsReceived');
    const packetsLost = this.numeric(lossSource, 'packetsLost');
    const baseline = this.#baseline;
    const elapsedMs = baseline === null ? null : Math.max(1, now - baseline.timestamp);
    const framesDelta = this.delta(frames, baseline?.frames ?? null);
    const processingDelta = this.delta(processingTime, baseline?.processingTime ?? null);
    const jitterDelayDelta = this.delta(jitterBufferDelay, baseline?.jitterBufferDelay ?? null);
    const jitterCountDelta = this.delta(jitterBufferEmittedCount, baseline?.jitterBufferEmittedCount ?? null);
    const receivedDelta = this.delta(packetsReceived, baseline?.packetsReceived ?? null);
    const lostDelta = this.delta(packetsLost, baseline?.packetsLost ?? null);
    const mediaRoundTripTimeMs = this.mediaRoundTripTime(records, remoteInboundVideo);
    const jitterBufferDelayMs = jitterDelayDelta === null || jitterCountDelta === null || jitterCountDelta <= 0
      ? null
      : this.round(jitterDelayDelta * 1000 / jitterCountDelta, 2);
    const processingMsPerFrame = processingDelta === null || framesDelta === null || framesDelta <= 0
      ? null
      : this.round(processingDelta * 1000 / framesDelta, 2);
    const packetTotal = receivedDelta === null || lostDelta === null
      ? null
      : Math.max(0, receivedDelta) + Math.max(0, lostDelta);
    const estimatedImageDelayMs = this.sumAvailable([
      mediaRoundTripTimeMs === null ? null : mediaRoundTripTimeMs / 2,
      role === LocalMediaRole.Viewer ? jitterBufferDelayMs : null,
      processingMsPerFrame
    ]);
    this.#baseline = {
      timestamp: now,
      videoBytes,
      audioBytes,
      frames,
      processingTime,
      jitterBufferDelay,
      jitterBufferEmittedCount,
      packetsReceived,
      packetsLost
    };
    return {
      timestamp: now,
      role,
      connectionState: peerConnection.connectionState,
      videoWidth: this.numeric(video, 'frameWidth'),
      videoHeight: this.numeric(video, 'frameHeight'),
      framesPerSecond: this.numeric(video, 'framesPerSecond') ?? this.rate(framesDelta, elapsedMs, 1000),
      videoBitrateMbps: this.rate(this.delta(videoBytes, baseline?.videoBytes ?? null), elapsedMs, 8 / 1000),
      audioBitrateKbps: this.rate(this.delta(audioBytes, baseline?.audioBytes ?? null), elapsedMs, 8),
      packetLossPercent: packetTotal === null || packetTotal <= 0 || lostDelta === null
        ? null
        : this.round(Math.max(0, lostDelta) * 100 / packetTotal, 3),
      packetsLost: packetsLost === null ? null : Math.max(0, packetsLost),
      jitterMs: this.secondsToMilliseconds(this.numeric(lossSource, 'jitter')),
      jitterBufferDelayMs,
      mediaRoundTripTimeMs,
      encodeTimeMsPerFrame: role === LocalMediaRole.Sharer ? processingMsPerFrame : null,
      decodeTimeMsPerFrame: role === LocalMediaRole.Viewer ? processingMsPerFrame : null,
      estimatedImageDelayMs: estimatedImageDelayMs === null ? null : this.round(estimatedImageDelayMs, 2),
      framesDropped: this.numeric(video, 'framesDropped'),
      freezeCount: this.numeric(inboundVideo, 'freezeCount'),
      codec: this.codec(records, video),
      encoderImplementation: this.text(outboundVideo, 'encoderImplementation'),
      decoderImplementation: this.text(inboundVideo, 'decoderImplementation'),
      qualityLimitationReason: this.text(outboundVideo, 'qualityLimitationReason')
    };
  }

  private rtp(records: readonly RtcStatsRecord[], type: string, kind: string): RtcStatsRecord | null {
    return records.find((record) => (
      record.type === type && (record.kind === kind || record.mediaType === kind)
    )) ?? null;
  }

  private mediaRoundTripTime(
    records: readonly RtcStatsRecord[],
    remoteInboundVideo: RtcStatsRecord | null
  ): number | null {
    const remoteRtt = this.numeric(remoteInboundVideo, 'roundTripTime');
    if (remoteRtt !== null) {
      return this.round(remoteRtt * 1000, 2);
    }
    const pair = records.find((record) => (
      record.type === 'candidate-pair' && record.state === 'succeeded' && record.nominated === true
    ));
    return this.secondsToMilliseconds(this.numeric(pair ?? null, 'currentRoundTripTime'));
  }

  private codec(records: readonly RtcStatsRecord[], video: RtcStatsRecord | null): string | null {
    const codecId = this.text(video, 'codecId');
    if (codecId === null) {
      return null;
    }
    const codec = records.find((record) => record.id === codecId);
    return this.text(codec ?? null, 'mimeType');
  }

  private numeric(record: RtcStatsRecord | null, key: string): number | null {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private text(record: RtcStatsRecord | null, key: string): string | null {
    const value = record?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private delta(current: number | null, previous: number | null): number | null {
    return current === null || previous === null ? null : Math.max(0, current - previous);
  }

  private rate(delta: number | null, elapsedMs: number | null, multiplier: number): number | null {
    return delta === null || elapsedMs === null
      ? null
      : this.round(delta * multiplier / elapsedMs, 3);
  }

  private secondsToMilliseconds(value: number | null): number | null {
    return value === null ? null : this.round(value * 1000, 2);
  }

  private sumAvailable(values: readonly (number | null)[]): number | null {
    const available = values.filter((value): value is number => value !== null);
    return available.length === 0 ? null : available.reduce((total, value) => total + value, 0);
  }

  private round(value: number, decimals: number): number {
    const multiplier = 10 ** decimals;
    return Math.round(value * multiplier) / multiplier;
  }
}
