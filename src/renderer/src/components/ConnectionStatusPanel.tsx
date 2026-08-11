import { Component } from 'react';
import { ConnectionState, LocalMediaRole, type ActiveConnectionDescriptor } from '../../../shared/ConnectivityContracts';

export interface ConnectionStatusPanelProps {
  readonly connection: ActiveConnectionDescriptor;
  readonly busy: boolean;
  readonly onReverse: () => void;
  readonly onDisconnect: () => void;
}

export class ConnectionStatusPanel extends Component<ConnectionStatusPanelProps> {
  public override render(): React.ReactNode {
    const connected = this.props.connection.state === ConnectionState.Connected;
    const failed = this.props.connection.state === ConnectionState.Failed;
    return (
      <section className="panel connection-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Active session</span>
            <h2>{this.title()}</h2>
          </div>
          <span className={`state-badge state-${this.props.connection.state}`}>{this.props.connection.state}</span>
        </div>
        <div className="session-grid">
          <div className="metric">
            <span>Peer</span>
            <strong>{this.props.connection.peer?.displayName ?? 'None'}</strong>
            <small>{this.props.connection.peer?.address ?? 'Waiting for a connection'}</small>
          </div>
          <div className="metric">
            <span>Direction</span>
            <strong>{this.roleLabel()}</strong>
            <small>Reversal requires approval on the other PC</small>
          </div>
          <div className="metric">
            <span>Control RTT</span>
            <strong>{this.props.connection.roundTripTimeMs === null ? '—' : `${this.props.connection.roundTripTimeMs} ms`}</strong>
            <small>Encrypted health-check round trip</small>
          </div>
        </div>
        {this.props.connection.error === null ? null : <div className="error-banner" role="alert">{this.props.connection.error}</div>}
        <div className="button-row">
          <button className="button secondary" disabled={!connected || this.props.busy} onClick={this.props.onReverse}>
            Reverse direction
          </button>
          <button className="button danger" disabled={(!connected && !failed) || this.props.busy} onClick={this.props.onDisconnect}>
            {failed ? 'Clear' : 'Disconnect'}
          </button>
        </div>
      </section>
    );
  }

  private title(): string {
    if (this.props.connection.state === ConnectionState.Connected) {
      return 'Secure control channel connected';
    }
    if (this.props.connection.state === ConnectionState.Pairing) {
      return 'Waiting for code confirmation';
    }
    if (this.props.connection.state === ConnectionState.Connecting) {
      return 'Authenticating peer';
    }
    if (this.props.connection.state === ConnectionState.Failed) {
      return 'Connection needs attention';
    }
    return 'No active connection';
  }

  private roleLabel(): string {
    if (this.props.connection.role === LocalMediaRole.Viewer) {
      return 'Viewing remote PC';
    }
    if (this.props.connection.role === LocalMediaRole.Sharer) {
      return 'Sharing this PC';
    }
    return 'Not assigned';
  }
}
