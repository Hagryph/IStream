import { Component, type ChangeEvent } from 'react';
import {
  CapacityFloorMode,
  HdrMode,
  StreamingPreset,
  VideoCodec,
  type StreamingConfiguration
} from '../../../shared/StreamingConfigurationContracts';

export interface StreamingPolicyPanelProps {
  readonly configuration: StreamingConfiguration;
  readonly disabled: boolean;
  readonly dirty: boolean;
  readonly onChange: (configuration: StreamingConfiguration) => void;
  readonly onSave: () => void;
}

export class StreamingPolicyPanel extends Component<StreamingPolicyPanelProps> {
  public override render(): React.ReactNode {
    return (
      <section className="panel policy-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Stable baseline configuration</span>
            <h2>Video, resilience, and input policy</h2>
          </div>
          <button
            className="button primary"
            disabled={this.props.disabled || !this.props.dirty}
            onClick={this.props.onSave}
          >
            {this.props.dirty ? 'Save configuration' : 'Configuration saved'}
          </button>
        </div>
        <div className="configuration-grid">
          <label className="configuration-field">
            <span>Usage preset</span>
            <select value={this.props.configuration.preset} onChange={(event) => this.updatePreset(event)}>
              <option value={StreamingPreset.Gaming}>Gaming — latency first</option>
              <option value={StreamingPreset.Desktop}>Desktop — readability first</option>
            </select>
            <small>Groups intent; individual values remain explicit.</small>
          </label>
          <label className="configuration-field">
            <span>Encoder codec</span>
            <select value={this.props.configuration.codec} onChange={(event) => this.updateCodec(event)}>
              <option value={VideoCodec.H264}>H.264 NVENC — GTX 1060 baseline</option>
              <option value={VideoCodec.Hevc}>HEVC NVENC — better quality, stricter compatibility</option>
            </select>
            <small>H.264 is the stable SDR default; HEVC is required for the planned HDR path.</small>
          </label>
          <label className="configuration-field">
            <span>Target resolution</span>
            <select value={`${this.props.configuration.targetWidth}x${this.props.configuration.targetHeight}`} onChange={(event) => this.updateResolution(event)}>
              <option value="1280x720">1280 × 720 (HD)</option>
              <option value="1920x1080">1920 × 1080 (Full HD)</option>
              <option value="2560x1440">2560 × 1440</option>
              <option value="3840x2160">3840 × 2160</option>
            </select>
            <small>Adaptation targets this value and preserves 720p as the preferred floor.</small>
          </label>
          <label className="configuration-field">
            <span>Frame rate target / minimum</span>
            <div className="inline-fields">
              <select value={this.props.configuration.targetFramesPerSecond} onChange={(event) => this.updateTargetFps(event)}>
                <option value="30">30 FPS</option>
                <option value="60">60 FPS</option>
                <option value="90">90 FPS</option>
                <option value="120">120 FPS</option>
              </select>
              <select value={this.props.configuration.minimumFramesPerSecond} onChange={(event) => this.updateMinimumFps(event)}>
                <option value="15">15 min</option>
                <option value="20">20 min</option>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">60 min</option>
              </select>
            </div>
            <small>Gaming baseline is 60 FPS, reducing to 30 before resolution.</small>
          </label>
          <label className="configuration-field">
            <span>Maximum bitrate</span>
            <div className="range-row">
              <input
                type="range"
                min="5"
                max="100"
                step="1"
                value={this.props.configuration.maximumBitrateMbps}
                onChange={(event) => this.updateBitrate(event)}
              />
              <strong>{this.props.configuration.maximumBitrateMbps} Mbps</strong>
            </div>
            <small>The congestion controller may reduce bitrate dynamically, never exceed this ceiling.</small>
          </label>
          <label className="configuration-field">
            <span>HDR behavior</span>
            <select value={this.props.configuration.hdrMode} onChange={(event) => this.updateHdr(event)}>
              <option value={HdrMode.Off}>Off — stable SDR baseline</option>
              <option value={HdrMode.Automatic}>Automatic when both PCs qualify</option>
            </select>
            <small>Automatic must fall back cleanly when capture, display, codec, or decoder lacks HDR.</small>
          </label>
          <label className="configuration-field">
            <span>When 720p cannot be sustained</span>
            <select value={this.props.configuration.capacityFloorMode} onChange={(event) => this.updateFloorMode(event)}>
              <option value={CapacityFloorMode.FreezeAndReconnectAtHd}>Freeze last HD frame and reconnect</option>
              <option value={CapacityFloorMode.AllowBelowHd}>Allow temporary sub-HD video</option>
            </select>
            <small>Order remains bitrate → frame rate → selected floor action.</small>
          </label>
          <div className="configuration-field toggle-stack">
            <span>Remote input and game safety</span>
            <label className="toggle-row">
              <input type="checkbox" checked={false} disabled onChange={(event) => this.updateInput(event)} />
              <strong>Keyboard and mouse translation — coming later</strong>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={this.props.configuration.applicationSafetyLockEnabled} onChange={(event) => this.updateSafetyLock(event)} />
              <strong>Auto-lock input for protected applications</strong>
            </label>
            <small>Video and audio are active now. Remote input remains disabled until the protected native input module is added.</small>
          </div>
        </div>
        <label className="configuration-field protected-applications">
          <span>Protected executable names — one per line</span>
          <textarea
            rows={2}
            value={this.props.configuration.protectedApplications.join('\n')}
            onChange={(event) => this.updateProtectedApplications(event)}
          />
          <small>League of Legends is protected by default. This policy is persisted, but enforcement belongs to the native input sidecar.</small>
        </label>
        <p className="boundary-note">
          The current WebRTC path streams the primary display and Windows system audio. Native NVENC control, protected-content capture, HDR, and input injection remain isolated behind the future sidecar interface.
        </p>
      </section>
    );
  }

  private updatePreset(event: ChangeEvent<HTMLSelectElement>): void {
    this.change({ preset: event.target.value as StreamingPreset });
  }

  private updateCodec(event: ChangeEvent<HTMLSelectElement>): void {
    this.change({ codec: event.target.value as VideoCodec });
  }

  private updateResolution(event: ChangeEvent<HTMLSelectElement>): void {
    const parts = event.target.value.split('x').map((value) => Number.parseInt(value, 10));
    this.change({ targetWidth: parts[0] ?? 1920, targetHeight: parts[1] ?? 1080 });
  }

  private updateTargetFps(event: ChangeEvent<HTMLSelectElement>): void {
    const targetFramesPerSecond = Number.parseInt(event.target.value, 10);
    this.change({
      targetFramesPerSecond,
      minimumFramesPerSecond: Math.min(this.props.configuration.minimumFramesPerSecond, targetFramesPerSecond)
    });
  }

  private updateMinimumFps(event: ChangeEvent<HTMLSelectElement>): void {
    this.change({ minimumFramesPerSecond: Number.parseInt(event.target.value, 10) });
  }

  private updateBitrate(event: ChangeEvent<HTMLInputElement>): void {
    this.change({ maximumBitrateMbps: Number.parseInt(event.target.value, 10) });
  }

  private updateHdr(event: ChangeEvent<HTMLSelectElement>): void {
    this.change({ hdrMode: event.target.value as HdrMode });
  }

  private updateFloorMode(event: ChangeEvent<HTMLSelectElement>): void {
    this.change({ capacityFloorMode: event.target.value as CapacityFloorMode });
  }

  private updateInput(event: ChangeEvent<HTMLInputElement>): void {
    this.change({ inputEnabled: event.target.checked });
  }

  private updateSafetyLock(event: ChangeEvent<HTMLInputElement>): void {
    this.change({ applicationSafetyLockEnabled: event.target.checked });
  }

  private updateProtectedApplications(event: ChangeEvent<HTMLTextAreaElement>): void {
    this.change({ protectedApplications: event.target.value.split('\n') });
  }

  private change(changes: Partial<StreamingConfiguration>): void {
    this.props.onChange({ ...this.props.configuration, ...changes });
  }
}
