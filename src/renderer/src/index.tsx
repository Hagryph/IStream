import { Component, StrictMode, type ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UserFacingError } from './UserFacingError';
import './styles.css';

export interface RendererFailurePanelProps {
  readonly detail: string;
}

export interface RendererErrorBoundaryState {
  readonly detail: string | null;
}

export class RendererFailurePanel extends Component<RendererFailurePanelProps> {
  public override render(): React.ReactNode {
    return (
      <main className="startup-failure" role="alert">
        <span className="eyebrow">IStream startup diagnostics</span>
        <h1>The interface could not start</h1>
        <p>{this.props.detail}</p>
        <p>Restart IStream. If this remains visible, install the newest release and report this message.</p>
      </main>
    );
  }
}

export class RendererErrorBoundary extends Component<React.PropsWithChildren, RendererErrorBoundaryState> {
  public constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { detail: null };
  }

  public static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { detail: UserFacingError.from(error) };
  }

  public override componentDidCatch(error: Error, information: ErrorInfo): void {
    console.error('IStream renderer startup failed.', error, information.componentStack);
  }

  public override render(): React.ReactNode {
    return this.state.detail === null
      ? this.props.children
      : <RendererFailurePanel detail={this.state.detail} />;
  }
}

export class RendererBootstrap {
  public mount(): void {
    const rootElement = document.getElementById('root');
    if (rootElement === null) {
      throw new Error('Renderer root element is missing.');
    }
    if (window.istream === undefined) {
      createRoot(rootElement).render(
        <RendererFailurePanel detail="The IStream interface could not start. Restart the app; reinstall the latest version if it happens again." />
      );
      return;
    }
    createRoot(rootElement).render(
      <StrictMode>
        <RendererErrorBoundary>
          <App />
        </RendererErrorBoundary>
      </StrictMode>
    );
  }
}

new RendererBootstrap().mount();
