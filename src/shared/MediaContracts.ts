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
  onMediaSignal(listener: MediaSignalListener): MediaUnsubscribe;
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
