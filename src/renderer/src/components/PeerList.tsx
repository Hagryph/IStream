import { Component } from 'react';
import { ConnectionIntent, type DiscoveredPeerDescriptor } from '../../../shared/ConnectivityContracts';

export interface PeerListProps {
  readonly peers: readonly DiscoveredPeerDescriptor[];
  readonly disabled: boolean;
  readonly refreshDisabled: boolean;
  readonly clearDisabled: boolean;
  readonly onConnect: (deviceId: string, intent: ConnectionIntent) => void;
  readonly onRefresh: () => void;
  readonly onClearTrust: (deviceId: string) => void;
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
          <article className={`peer-row ${peer.online ? '' : 'offline'}`} key={peer.deviceId}>
            <div className="peer-icon">PC</div>
            <div className="peer-copy">
              <strong>{peer.displayName}</strong>
              <span>{peer.online && peer.controlPort !== null ? `${peer.address}:${peer.controlPort}` : `Offline - last address ${peer.address}`}</span>
            </div>
            <span className={`peer-presence ${peer.online ? 'online' : ''}`}>{peer.online ? 'Online' : 'Offline'}</span>
            <span
              className={`trust-badge ${peer.paired ? 'trusted' : ''}`}
              title={this.trustTitle(peer.trustExpiresAt, peer.trustedIntents)}
            >
              {peer.paired ? 'Trusted' : 'New'}
            </span>
            <button
              className="button small primary"
              disabled={this.props.disabled || !peer.online || peer.controlPort === null}
              onClick={() => this.props.onConnect(peer.deviceId, ConnectionIntent.ViewRemote)}
            >
              View
            </button>
            <button
              className="button small secondary"
              disabled={this.props.disabled || !peer.online || peer.controlPort === null}
              onClick={() => this.props.onConnect(peer.deviceId, ConnectionIntent.ShareLocal)}
            >
              Share
            </button>
            {peer.paired ? (
              <button
                className="trust-clear"
                disabled={this.props.clearDisabled}
                title="Clear this one-way trust"
                aria-label={`Clear trust for ${peer.displayName}`}
                onClick={() => this.props.onClearTrust(peer.deviceId)}
              >
                X
              </button>
            ) : null}
          </article>
        ))}
      </div>
    );
  }

  private trustTitle(expiresAt: number | null, intents: readonly ConnectionIntent[]): string {
    if (expiresAt === null) {
      return 'Not trusted yet';
    }
    const scope = intents.map((intent) => (
      intent === ConnectionIntent.ViewRemote ? 'view this PC' : 'share its PC'
    )).join(' and ');
    return `May request: ${scope || 'trusted connection'}. Expires ${new Date(expiresAt).toLocaleString()}`;
  }
}
