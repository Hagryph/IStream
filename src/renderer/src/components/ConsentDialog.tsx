import { Component, type ChangeEvent } from 'react';
import {
  ConnectionIntent,
  ConsentPromptMode,
  PromptKind,
  type ConsentPromptDescriptor
} from '../../../shared/ConnectivityContracts';

export interface ConsentDialogProps {
  readonly prompt: ConsentPromptDescriptor | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDecision: (accepted: boolean, verificationCode: string | null) => void;
}

export interface ConsentDialogState {
  readonly verificationCode: string;
}

export class ConsentDialog extends Component<ConsentDialogProps, ConsentDialogState> {
  public constructor(props: ConsentDialogProps) {
    super(props);
    this.state = { verificationCode: '' };
  }

  public override componentDidUpdate(previousProps: ConsentDialogProps): void {
    if (previousProps.prompt?.promptId !== this.props.prompt?.promptId && this.state.verificationCode.length > 0) {
      this.setState({ verificationCode: '' });
    }
  }

  public override render(): React.ReactNode {
    if (this.props.prompt === null) {
      return null;
    }
    return (
      <div className="modal-backdrop" role="presentation">
        <section className="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <span className="eyebrow">{this.eyebrow()}</span>
          <h2 id="consent-title">{this.title()}</h2>
          <p>{this.description()}</p>
          {this.renderVerification()}
          <div className="dialog-details">
            <span>Peer</span><strong>{this.props.prompt.peerName}</strong>
            <span>Trust</span><strong>{this.props.prompt.knownPeer ? 'Previously paired identity' : 'New device identity'}</strong>
          </div>
          {this.props.error === null ? null : <div className="dialog-error" role="alert">{this.props.error}</div>}
          {this.renderActions()}
        </section>
      </div>
    );
  }

  private renderVerification(): React.ReactNode {
    if (this.props.prompt?.mode === ConsentPromptMode.WaitingForPeer) {
      return (
        <div className="verification-block">
          <span>Enter this code on the requested PC</span>
          <strong>{this.props.prompt.verificationCode}</strong>
        </div>
      );
    }
    if (this.props.prompt?.mode === ConsentPromptMode.EnterVerificationCode) {
      return (
        <label className="verification-entry">
          <span>Code shown on the requesting PC</span>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="000000"
            value={this.state.verificationCode}
            onChange={(event) => this.updateVerificationCode(event)}
          />
        </label>
      );
    }
    return null;
  }

  private renderActions(): React.ReactNode {
    if (this.props.prompt?.mode === ConsentPromptMode.WaitingForPeer) {
      return (
        <div className="button-row">
          <button
            className="button danger"
            disabled={this.props.busy}
            onClick={() => this.props.onDecision(false, null)}
          >
            Cancel request
          </button>
        </div>
      );
    }
    const requiresCode = this.props.prompt?.mode === ConsentPromptMode.EnterVerificationCode;
    return (
      <div className="button-row split">
        <button
          className="button danger"
          disabled={this.props.busy}
          onClick={() => this.props.onDecision(false, null)}
        >
          Decline
        </button>
        <button
          className="button primary"
          disabled={this.props.busy || (requiresCode && this.state.verificationCode.length !== 6)}
          onClick={() => this.props.onDecision(
            true,
            requiresCode ? this.state.verificationCode : null
          )}
        >
          Approve
        </button>
      </div>
    );
  }

  private eyebrow(): string {
    if (this.props.prompt?.mode === ConsentPromptMode.WaitingForPeer) {
      return 'Waiting for the requested computer';
    }
    if (this.props.prompt?.kind === PromptKind.Reversal) {
      return 'Direction change approval';
    }
    return 'Code required on this computer';
  }

  private title(): string {
    if (this.props.prompt?.mode === ConsentPromptMode.WaitingForPeer) {
      return `Waiting for ${this.props.prompt.peerName}`;
    }
    if (this.props.prompt?.kind === PromptKind.Reversal) {
      return 'Reverse the stream direction?';
    }
    if (this.props.prompt?.kind === PromptKind.Pairing) {
      return 'Pair with a new computer?';
    }
    return 'Allow this connection?';
  }

  private description(): string {
    if (this.props.prompt?.mode === ConsentPromptMode.WaitingForPeer) {
      return 'The other computer must enter the session code. This request closes automatically if that computer goes offline.';
    }
    if (this.props.prompt?.kind === PromptKind.Reversal) {
      return 'The peer wants the viewer and sharer roles to swap. Input control must be released before the native media engine changes direction.';
    }
    if (this.props.prompt?.intent === ConnectionIntent.ViewRemote) {
      return 'The requesting computer wants to view and control this computer. Enter its displayed code to approve.';
    }
    return 'The requesting computer wants to share its screen with this computer. Enter its displayed code to approve.';
  }

  private updateVerificationCode(event: ChangeEvent<HTMLInputElement>): void {
    this.setState({ verificationCode: event.target.value.replace(/\D/g, '').slice(0, 6) });
  }
}
