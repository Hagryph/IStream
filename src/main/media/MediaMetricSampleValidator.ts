import { LocalMediaRole } from '../../shared/ConnectivityContracts';
import type { MediaMetricSample } from '../../shared/MediaContracts';

export class MediaMetricSampleValidator {
  public validate(value: unknown): MediaMetricSample {
    const candidate = this.record(value);
    const timestamp = this.number(candidate.timestamp, Date.now() - 60_000, Date.now() + 60_000);
    const role = candidate.role;
    if (role !== LocalMediaRole.Viewer && role !== LocalMediaRole.Sharer) {
      throw new Error('Invalid media metric role.');
    }
    return {
      timestamp,
      role,
      connectionState: this.text(candidate.connectionState, 32),
      videoWidth: this.nullableNumber(candidate.videoWidth, 0, 16_384),
      videoHeight: this.nullableNumber(candidate.videoHeight, 0, 16_384),
      framesPerSecond: this.nullableNumber(candidate.framesPerSecond, 0, 1000),
      videoBitrateMbps: this.nullableNumber(candidate.videoBitrateMbps, 0, 10_000),
      audioBitrateKbps: this.nullableNumber(candidate.audioBitrateKbps, 0, 100_000),
      packetLossPercent: this.nullableNumber(candidate.packetLossPercent, 0, 100),
      packetsLost: this.nullableNumber(candidate.packetsLost, 0, Number.MAX_SAFE_INTEGER),
      jitterMs: this.nullableNumber(candidate.jitterMs, 0, 60_000),
      jitterBufferDelayMs: this.nullableNumber(candidate.jitterBufferDelayMs, 0, 60_000),
      mediaRoundTripTimeMs: this.nullableNumber(candidate.mediaRoundTripTimeMs, 0, 60_000),
      encodeTimeMsPerFrame: this.nullableNumber(candidate.encodeTimeMsPerFrame, 0, 60_000),
      decodeTimeMsPerFrame: this.nullableNumber(candidate.decodeTimeMsPerFrame, 0, 60_000),
      estimatedImageDelayMs: this.nullableNumber(candidate.estimatedImageDelayMs, 0, 120_000),
      framesDropped: this.nullableNumber(candidate.framesDropped, 0, Number.MAX_SAFE_INTEGER),
      freezeCount: this.nullableNumber(candidate.freezeCount, 0, Number.MAX_SAFE_INTEGER),
      codec: this.nullableText(candidate.codec, 128),
      encoderImplementation: this.nullableText(candidate.encoderImplementation, 128),
      decoderImplementation: this.nullableText(candidate.decoderImplementation, 128),
      qualityLimitationReason: this.nullableText(candidate.qualityLimitationReason, 64)
    };
  }

  private record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Invalid media metric sample.');
    }
    return value as Record<string, unknown>;
  }

  private number(value: unknown, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error('Invalid numeric media metric.');
    }
    return value;
  }

  private nullableNumber(value: unknown, minimum: number, maximum: number): number | null {
    return value === null ? null : this.number(value, minimum, maximum);
  }

  private text(value: unknown, maximumLength: number): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
      throw new Error('Invalid text media metric.');
    }
    return value;
  }

  private nullableText(value: unknown, maximumLength: number): string | null {
    return value === null ? null : this.text(value, maximumLength);
  }
}
