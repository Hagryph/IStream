import { Component } from 'react';
import { ConnectionIntent, PromptKind, type ConsentPromptDescriptor } from '../../../shared/ConnectivityContracts';

export interface ConsentDialogProps {
  readonly prompt: ConsentPromptDescriptor | null;
  readonly busy: boolean;
  readonly onDecision: (accepted: boolean) => void;
}

export class ConsentDialog extends Component<ConsentDialogProps> {
  public override render(): React.ReactNode {
    if (this.props.prompt === null) {
      return null;
    }
    return (
      <div className="modal-backdrop" role="presentation">
        <section className="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <span className="eyebrow">Approval required on both computers</span>
          <h2 id="consent-title">{this.title()}</h2>
          <p>{this.description()}</p>
          {this.props.prompt.verificationCode === null ? null : (
            <div className="verification-block">
              <span>Confirm this code matches the other PC</span>
              <strong>{this.props.prompt.verificationCode}</strong>
            </div>
          )}
          <div className="dialog-details">
            <span>Peer</span><strong>{this.props.prompt.peerName}</strong>
            <span>Trust</span><strong>{this.props.prompt.knownPeer ? 'Previously paired' : 'New device identity'}</strong>
          </div>
          <div className="button-row split">
            <button className="button danger" disabled={this.props.busy} onClick={() => this.props.onDecision(false)}>Decline</button>
            <button className="button primary" disabled={this.props.busy} onClick={() => this.props.onDecision(true)}>Approve</button>
          </div>
        </section>
      </div>
    );
  }

  private title(): string {
    if (this.props.prompt?.kind === PromptKind.Reversal) {
      return 'Reverse the stream direction?';
    }
    if (this.props.prompt?.kind === PromptKind.Pairing) {
      return 'Pair with a new computer?';
    }
    return 'Allow this connection?';
  }

  private description(): string {
    if (this.props.prompt?.kind === PromptKind.Reversal) {
      return 'The peer wants the viewer and sharer roles to swap. Input control must be released before the native media engine changes direction.';
    }
    if (this.props.prompt?.intent === ConnectionIntent.ViewRemote) {
      return 'The initiating computer asked to view and control this computer.';
    }
    return 'The initiating computer asked to share its screen with this computer.';
  }
}
