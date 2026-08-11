import { Component } from 'react';
import { ConnectionIntent, type DiscoveredPeerDescriptor } from '../../../shared/ConnectivityContracts';

export interface PeerListProps {
  readonly peers: readonly DiscoveredPeerDescriptor[];
  readonly disabled: boolean;
  readonly refreshDisabled: boolean;
  readonly onConnect: (deviceId: string, intent: ConnectionIntent) => void;
  readonly onRefresh: () => void;
}

export class PeerList extends Component<PeerListProps> {
  public override render(): React.ReactNode {
    return (
      <section className="panel peer-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Automatic discovery</span>
            <h2>Computers on this LAN</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="count-badge">{this.props.peers.length}</span>
            <button
              className="button small secondary"
              disabled={this.props.refreshDisabled}
              onClick={this.props.onRefresh}
            >
              Refresh
            </button>
          </div>
        </div>
        {this.props.peers.length === 0 ? this.renderEmptyState() : this.renderPeers()}
      </section>
    );
  }

  private renderEmptyState(): React.ReactNode {
    return (
      <div className="empty-state">
        <strong>No other IStream instance discovered</strong>
        <span>Open the app on the second PC, or connect by private IP.</span>
      </div>
    );
  }

  private renderPeers(): React.ReactNode {
    return (
      <div className="peer-list">
        {this.props.peers.map((peer) => (
          <article className="peer-row" key={peer.deviceId}>
            <div className="peer-icon">PC</div>
            <div className="peer-copy">
              <strong>{peer.displayName}</strong>
              <span>{peer.address}:{peer.controlPort}</span>
            </div>
            <span
              className={`trust-badge ${peer.paired ? 'trusted' : ''}`}
              title={peer.paired ? 'Stored trusted identity; this does not indicate an active connection.' : 'Not paired yet'}
            >
              {peer.paired ? 'Trusted' : 'New'}
            </span>
            <button
              className="button small primary"
              disabled={this.props.disabled}
              onClick={() => this.props.onConnect(peer.deviceId, ConnectionIntent.ViewRemote)}
            >
              View
            </button>
            <button
              className="button small secondary"
              disabled={this.props.disabled}
              onClick={() => this.props.onConnect(peer.deviceId, ConnectionIntent.ShareLocal)}
            >
              Share
            </button>
          </article>
        ))}
      </div>
    );
  }
}
