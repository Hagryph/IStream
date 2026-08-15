import type { LocalMediaRole } from './ConnectivityContracts';

export enum MediaSignalKind {
  Offer = 'offer',
  Answer = 'answer',
  IceCandidate = 'ice-candidate',
  IceComplete = 'ice-complete'
}

export interface MediaSignal {
  readonly generation: string;
  readonly kind: MediaSignalKind;
  readonly sdp: string | null;
  readonly candidate: string | null;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
}

export type MediaSignalListener = (signal: MediaSignal) => void;
export type MediaUnsubscribe = () => void;

export interface IceCandidateDescriptor {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
}

export interface MediaApi {
  sendMediaSignal(signal: MediaSignal): Promise<void>;
  reportMediaMetrics(sample: MediaMetricSample): Promise<void>;
  onMediaSignal(listener: MediaSignalListener): MediaUnsubscribe;
}

export interface MediaMetricSample {
  readonly timestamp: number;
  readonly role: LocalMediaRole;
  readonly connectionState: string;
  readonly videoWidth: number | null;
  readonly videoHeight: number | null;
  readonly framesPerSecond: number | null;
  readonly videoBitrateMbps: number | null;
  readonly audioBitrateKbps: number | null;
  readonly packetLossPercent: number | null;
  readonly packetsLost: number | null;
  readonly jitterMs: number | null;
  readonly jitterBufferDelayMs: number | null;
  readonly mediaRoundTripTimeMs: number | null;
  readonly encodeTimeMsPerFrame: number | null;
  readonly decodeTimeMsPerFrame: number | null;
  readonly estimatedImageDelayMs: number | null;
  readonly framesDropped: number | null;
  readonly freezeCount: number | null;
  readonly codec: string | null;
  readonly encoderImplementation: string | null;
  readonly decoderImplementation: string | null;
  readonly qualityLimitationReason: string | null;
}

export class MediaSignalFactory {
  public static sessionDescription(
    generation: string,
    kind: MediaSignalKind.Offer | MediaSignalKind.Answer,
    sdp: string
  ): MediaSignal {
    return { generation, kind, sdp, candidate: null, sdpMid: null, sdpMLineIndex: null };
  }

  public static iceCandidate(generation: string, candidate: IceCandidateDescriptor): MediaSignal {
    return {
      generation,
      kind: MediaSignalKind.IceCandidate,
      sdp: null,
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex
    };
  }

  public static iceComplete(generation: string): MediaSignal {
    return {
      generation,
      kind: MediaSignalKind.IceComplete,
      sdp: null,
      candidate: null,
      sdpMid: null,
      sdpMLineIndex: null
    };
  }
}
