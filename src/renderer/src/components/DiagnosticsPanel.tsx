import { Component } from 'react';
import { ConnectionState, type ActiveConnectionDescriptor } from '../../../shared/ConnectivityContracts';
import type { DiagnosticsEndpointDescriptor } from '../../../shared/DiagnosticContracts';

export interface DiagnosticsPanelProps {
  readonly endpoint: DiagnosticsEndpointDescriptor | null;
  readonly connection: ActiveConnectionDescriptor;
}

export class DiagnosticsPanel extends Component<DiagnosticsPanelProps> {
  public override render(): React.ReactNode {
    return (
      <section className="panel diagnostics-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Loopback diagnostics</span>
            <h2>Command-line record access</h2>
          </div>
          <span className="state-badge state-connected">127.0.0.1 only</span>
        </div>
        {this.props.endpoint === null ? this.renderUnavailable() : this.renderCommands(this.props.endpoint)}
      </section>
    );
  }

  private renderUnavailable(): React.ReactNode {
    return <div className="empty-state"><strong>Diagnostics service is starting</strong></div>;
  }

  private renderCommands(endpoint: DiagnosticsEndpointDescriptor): React.ReactNode {
    const connected = this.props.connection.state === ConnectionState.Connected;
    return (
      <div className="diagnostic-command-grid">
        <div>
          <span>Follow this PC continuously</span>
          <code>{endpoint.streamCommand}</code>
          <small>NDJSON records stream until Ctrl+C. The latest {this.retainedMinutes(endpoint)} minutes are replayed first (up to {endpoint.retainedRecordLimit.toLocaleString()} records).</small>
        </div>
        <div>
          <span>Read this PC once</span>
          <code>{endpoint.snapshotCommand}</code>
          <small>Returns the currently retained local and previously requested remote records.</small>
        </div>
        <div className={connected ? '' : 'command-disabled'}>
          <span>Pull the connected peer on demand</span>
          <code>{endpoint.peerSnapshotCommand}</code>
          <small>{connected ? `Requests the peer's latest ${this.retainedMinutes(endpoint)} minutes through the encrypted channel.` : 'Connect and approve a peer before using this command.'}</small>
        </div>
      </div>
    );
  }

  private retainedMinutes(endpoint: DiagnosticsEndpointDescriptor): number {
    return Math.round(endpoint.retainedDurationMs / 60_000);
  }
}
