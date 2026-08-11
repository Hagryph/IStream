import { Component } from 'react';
import {
  ConnectionIntent,
  ConnectionState,
  LocalMediaRole,
  ServiceState,
  type ConnectivitySnapshot
} from '../../shared/ConnectivityContracts';
import {
  StreamingConfigurationDefaults,
  type StreamingConfiguration
} from '../../shared/StreamingConfigurationContracts';
import { AppHeader } from './components/AppHeader';
import { ConnectionStatusPanel } from './components/ConnectionStatusPanel';
import { ConsentDialog } from './components/ConsentDialog';
import { ManualConnectionPanel } from './components/ManualConnectionPanel';
import { PeerList } from './components/PeerList';
import { StreamingPolicyPanel } from './components/StreamingPolicyPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { UserFacingError } from './UserFacingError';

export interface AppState {
  readonly snapshot: ConnectivitySnapshot;
  readonly manualEndpoint: string;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly configuration: StreamingConfiguration;
  readonly configurationDirty: boolean;
}

export class App extends Component<Record<string, never>, AppState> {
  #unsubscribe: (() => void) | null = null;

  public constructor(props: Record<string, never>) {
    super(props);
    this.state = {
      snapshot: App.initialSnapshot(),
      manualEndpoint: '',
      busy: false,
      notice: null,
      configuration: StreamingConfigurationDefaults.stableGaming(),
      configurationDirty: false
    };
  }

  public override componentDidMount(): void {
    this.#unsubscribe = window.istream.onSnapshot((snapshot) => this.setState({ snapshot }));
    void window.istream.getSnapshot()
      .then((snapshot) => this.setState({ snapshot }))
      .catch((error: unknown) => this.setNotice(error));
    void window.istream.getStreamConfiguration()
      .then((configuration) => this.setState({ configuration, configurationDirty: false }))
      .catch((error: unknown) => this.setNotice(error));
  }

  public override componentWillUnmount(): void {
    this.#unsubscribe?.();
  }

  public override render(): React.ReactNode {
    const unavailable = this.state.busy || ![
      ConnectionState.Idle,
      ConnectionState.Failed
    ].includes(this.state.snapshot.connection.state);
    return (
      <div className="app-shell">
        <AppHeader
          serviceState={this.state.snapshot.serviceState}
          endpoint={this.state.snapshot.localEndpoint}
        />
        <main className="content">
          {this.state.notice === null ? null : (
            <div
              className="notice"
              role="alert"
              aria-live="polite"
              title="Click to dismiss"
              onClick={() => this.setState({ notice: null })}
            >
              {this.state.notice}
            </div>
          )}
          <ConnectionStatusPanel
            connection={{
              ...this.state.snapshot.connection,
              error: UserFacingError.fromNullable(this.state.snapshot.connection.error)
            }}
            busy={this.state.busy}
            onReverse={() => this.perform(() => window.istream.requestReversal())}
            onDisconnect={() => this.perform(() => window.istream.disconnect())}
          />
          <div className="two-column">
            <PeerList
              peers={this.state.snapshot.discoveredPeers}
              disabled={unavailable}
              refreshDisabled={
                this.state.busy || this.state.snapshot.serviceState !== ServiceState.Ready
              }
              clearDisabled={this.state.busy}
              onConnect={(deviceId, intent) => this.connectDiscovered(deviceId, intent)}
              onRefresh={() => this.refreshDiscovery()}
              onClearTrust={(deviceId) => this.clearTrust(deviceId)}
            />
            <ManualConnectionPanel
              endpoint={this.state.manualEndpoint}
              disabled={unavailable}
              onEndpointChanged={(manualEndpoint) => this.setState({ manualEndpoint })}
              onConnect={(intent) => this.connectManual(intent)}
            />
          </div>
          <StreamingPolicyPanel
            configuration={this.state.configuration}
            disabled={this.state.busy}
            dirty={this.state.configurationDirty}
            onChange={(configuration) => this.setState({ configuration, configurationDirty: true })}
            onSave={() => this.saveConfiguration()}
          />
          <DiagnosticsPanel
            endpoint={this.state.snapshot.diagnostics}
            connection={this.state.snapshot.connection}
          />
        </main>
        <ConsentDialog
          prompt={this.state.snapshot.prompt}
          busy={this.state.busy}
          error={this.state.notice}
          onDecision={(accepted, verificationCode) => this.respondToPrompt(accepted, verificationCode)}
        />
      </div>
    );
  }

  private connectManual(intent: ConnectionIntent): void {
    void this.perform(() => window.istream.connectManual({ endpoint: this.state.manualEndpoint, intent }));
  }

  private connectDiscovered(deviceId: string, intent: ConnectionIntent): void {
    void this.perform(() => window.istream.connectDiscovered({ deviceId, intent }));
  }

  private respondToPrompt(accepted: boolean, verificationCode: string | null): void {
    const prompt = this.state.snapshot.prompt;
    if (prompt !== null) {
      void this.perform(() => window.istream.respondToPrompt({
        promptId: prompt.promptId,
        accepted,
        verificationCode
      }));
    }
  }

  private refreshDiscovery(): void {
    void this.perform(() => window.istream.refreshDiscovery());
  }

  private clearTrust(deviceId: string): void {
    void this.perform(() => window.istream.clearTrust({ deviceId }));
  }

  private saveConfiguration(): void {
    void this.perform(async () => {
      const configuration = await window.istream.updateStreamConfiguration(this.state.configuration);
      this.setState({ configuration, configurationDirty: false });
    });
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    this.setState({ busy: true, notice: null });
    try {
      await operation();
    } catch (error: unknown) {
      this.setNotice(error);
    } finally {
      this.setState({ busy: false });
    }
  }

  private setNotice(error: unknown): void {
    this.setState({ notice: UserFacingError.from(error) });
  }

  private static initialSnapshot(): ConnectivitySnapshot {
    return {
      serviceState: ServiceState.Starting,
      localEndpoint: null,
      discoveredPeers: [],
      connection: {
        state: ConnectionState.Idle,
        peer: null,
        role: LocalMediaRole.None,
        roundTripTimeMs: null,
        connectedAt: null,
        error: null
      },
      prompt: null,
      diagnostics: null
    };
  }
}
