import { Component, type ChangeEvent } from 'react';
import { ConnectionIntent } from '../../../shared/ConnectivityContracts';

export interface ManualConnectionPanelProps {
  readonly endpoint: string;
  readonly disabled: boolean;
  readonly onEndpointChanged: (endpoint: string) => void;
  readonly onConnect: (intent: ConnectionIntent) => void;
}

export class ManualConnectionPanel extends Component<ManualConnectionPanelProps> {
  public override render(): React.ReactNode {
    return (
      <section className="panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Manual connection</span>
            <h2>Private IPv4 address</h2>
          </div>
        </div>
        <label className="field-label" htmlFor="manual-endpoint">Address and optional port</label>
        <input
          id="manual-endpoint"
          className="text-input"
          value={this.props.endpoint}
          placeholder="192.168.1.25:47778"
          disabled={this.props.disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => this.props.onEndpointChanged(event.target.value)}
        />
        <p className="field-help">Public addresses and internet hostnames are rejected by the service.</p>
        <div className="button-row split">
          <button
            className="button primary"
            disabled={this.props.disabled || this.props.endpoint.trim().length === 0}
            onClick={() => this.props.onConnect(ConnectionIntent.ViewRemote)}
          >
            View that PC
          </button>
          <button
            className="button secondary"
            disabled={this.props.disabled || this.props.endpoint.trim().length === 0}
            onClick={() => this.props.onConnect(ConnectionIntent.ShareLocal)}
          >
            Share this PC
          </button>
        </div>
      </section>
    );
  }
}
