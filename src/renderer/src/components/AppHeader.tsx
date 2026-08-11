import { Component } from 'react';
import { ServiceState, type LocalEndpointDescriptor } from '../../../shared/ConnectivityContracts';

export interface AppHeaderProps {
  readonly serviceState: ServiceState;
  readonly endpoint: LocalEndpointDescriptor | null;
}

export class AppHeader extends Component<AppHeaderProps> {
  public override render(): React.ReactNode {
    const ready = this.props.serviceState === ServiceState.Ready;
    return (
      <header className="app-header">
        <div>
          <div className="brand-row">
            <div className="brand-mark">IS</div>
            <div>
              <h1>IStream</h1>
              <p>Private LAN remote gaming baseline</p>
            </div>
          </div>
        </div>
        <div className="endpoint-summary">
          <span className={`status-dot ${ready ? 'online' : ''}`} />
          <div>
            <strong>{ready ? 'LAN service ready' : this.props.serviceState}</strong>
            <small>
              {this.props.endpoint === null
                ? 'Starting control channel…'
                : `${this.props.endpoint.displayName} · port ${this.props.endpoint.controlPort}`}
            </small>
          </div>
        </div>
      </header>
    );
  }
}
