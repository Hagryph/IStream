import { describe, expect, test } from 'vitest';
import { LocalMediaRole } from '../src/shared/ConnectivityContracts';
import type { MediaMetricSample } from '../src/shared/MediaContracts';
import { MediaMetricSampleValidator } from '../src/main/media/MediaMetricSampleValidator';

class MediaMetricSampleTestSuite {
  public register(): void {
    describe('media metric samples', () => {
      test('accepts bounded WebRTC telemetry', () => {
        const sample = this.sample();
        expect(new MediaMetricSampleValidator().validate(sample)).toEqual(sample);
      });

      test('rejects invalid or stale renderer telemetry', () => {
        const validator = new MediaMetricSampleValidator();
        expect(() => validator.validate({ ...this.sample(), packetLossPercent: 101 })).toThrow();
        expect(() => validator.validate({ ...this.sample(), timestamp: Date.now() - 120_000 })).toThrow();
        expect(() => validator.validate({ ...this.sample(), role: LocalMediaRole.None })).toThrow();
      });
    });
  }

  private sample(): MediaMetricSample {
    return {
      timestamp: Date.now(),
      role: LocalMediaRole.Viewer,
      connectionState: 'connected',
      videoWidth: 1920,
      videoHeight: 1080,
      framesPerSecond: 60,
      videoBitrateMbps: 28.4,
      audioBitrateKbps: 128,
      packetLossPercent: 0.1,
      packetsLost: 2,
      jitterMs: 1.8,
      jitterBufferDelayMs: 7.2,
      mediaRoundTripTimeMs: 8,
      encodeTimeMsPerFrame: null,
      decodeTimeMsPerFrame: 1.4,
      estimatedImageDelayMs: 12.6,
      framesDropped: 0,
      freezeCount: 0,
      codec: 'video/H264',
      encoderImplementation: null,
      decoderImplementation: 'ExternalDecoder',
      qualityLimitationReason: null
    };
  }
}

new MediaMetricSampleTestSuite().register();
