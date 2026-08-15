import { Component, createRef, type RefObject } from 'react';
import { LocalMediaRole } from '../../../shared/ConnectivityContracts';
import type { RendererMediaPresentation } from '../media/WebRtcMediaSession';

export interface StreamViewportProps {
  readonly media: RendererMediaPresentation;
  readonly role: LocalMediaRole;
}

export class StreamViewport extends Component<StreamViewportProps> {
  readonly #videoRef: RefObject<HTMLVideoElement | null> = createRef<HTMLVideoElement>();

  public override componentDidMount(): void {
    this.attachStream();
  }

  public override componentDidUpdate(): void {
    this.attachStream();
  }

  public override render(): React.ReactNode {
    return (
      <section className="panel stream-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Live media</span>
            <h2>{this.title()}</h2>
          </div>
          <span className={`state-badge media-${this.props.media.state}`}>{this.props.media.state}</span>
        </div>
        <div className="stream-stage">
          <video
            ref={this.#videoRef}
            autoPlay
            playsInline
            muted={this.props.media.muted}
          />
          {this.props.media.stream === null ? (
            <div className="stream-placeholder">
              <strong>No active picture</strong>
              <span>{this.props.media.detail}</span>
            </div>
          ) : null}
        </div>
        <div className="stream-footer">
          <span>{this.props.media.detail}</span>
          <button className="button small secondary" disabled={this.props.media.stream === null} onClick={() => this.enterFullscreen()}>
            Full screen
          </button>
        </div>
        {this.props.media.metrics === null ? null : (
          <div className="media-metrics" aria-label="Live stream metrics">
            <div><span>Picture</span><strong>{this.resolution()}</strong></div>
            <div><span>Video rate</span><strong>{this.metric(this.props.media.metrics.videoBitrateMbps, ' Mbps')}</strong></div>
            <div><span>Frame rate</span><strong>{this.metric(this.props.media.metrics.framesPerSecond, ' FPS')}</strong></div>
            <div title="Estimated network half-RTT plus jitter-buffer and local encode/decode time. Capture, display scan-out, and remote encode/decode stages unavailable on this endpoint are excluded.">
              <span>Image path estimate</span><strong>{this.metric(this.props.media.metrics.estimatedImageDelayMs, ' ms')}</strong>
            </div>
            <div><span>Media RTT</span><strong>{this.metric(this.props.media.metrics.mediaRoundTripTimeMs, ' ms')}</strong></div>
            <div><span>Packet loss</span><strong>{this.metric(this.props.media.metrics.packetLossPercent, '%')}</strong></div>
            <div><span>Jitter / buffer</span><strong>{this.jitter()}</strong></div>
            <div><span>Codec</span><strong>{this.props.media.metrics.codec ?? '—'}</strong></div>
            <div><span>Audio rate</span><strong>{this.metric(this.props.media.metrics.audioBitrateKbps, ' Kbps')}</strong></div>
            <div><span>Encode / decode</span><strong>{this.processingTime()}</strong></div>
            <div><span>Dropped frames</span><strong>{this.metric(this.props.media.metrics.framesDropped, '')}</strong></div>
            <div><span>Freezes</span><strong>{this.metric(this.props.media.metrics.freezeCount, '')}</strong></div>
          </div>
        )}
      </section>
    );
  }

  private attachStream(): void {
    const video = this.#videoRef.current;
    if (video !== null && video.srcObject !== this.props.media.stream) {
      video.srcObject = this.props.media.stream;
      if (this.props.media.stream !== null) {
        void video.play().catch(() => undefined);
      }
    }
  }

  private enterFullscreen(): void {
    const video = this.#videoRef.current;
    if (video !== null) {
      void video.requestFullscreen();
    }
  }

  private title(): string {
    if (this.props.role === LocalMediaRole.Viewer) {
      return 'Remote screen and audio';
    }
    if (this.props.role === LocalMediaRole.Sharer) {
      return 'Sharing this screen and system audio';
    }
    return 'Video and audio stream';
  }

  private resolution(): string {
    const metrics = this.props.media.metrics;
    return metrics?.videoWidth === null || metrics?.videoHeight === null || metrics === null
      ? '—'
      : `${metrics.videoWidth}×${metrics.videoHeight}`;
  }

  private jitter(): string {
    const metrics = this.props.media.metrics;
    return metrics === null
      ? '—'
      : `${this.metric(metrics.jitterMs, ' ms')} / ${this.metric(metrics.jitterBufferDelayMs, ' ms')}`;
  }

  private processingTime(): string {
    const metrics = this.props.media.metrics;
    return metrics === null
      ? '—'
      : `${this.metric(metrics.encodeTimeMsPerFrame, ' ms')} / ${this.metric(metrics.decodeTimeMsPerFrame, ' ms')}`;
  }

  private metric(value: number | null, suffix: string): string {
    return value === null ? '—' : `${value}${suffix}`;
  }
}
