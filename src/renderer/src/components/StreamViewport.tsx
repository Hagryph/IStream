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
}
