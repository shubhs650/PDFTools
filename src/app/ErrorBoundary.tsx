import { Component, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from '../ui/components';
import { recordError, type BoundaryName } from './diagnostics';

interface Props {
  /** Where the boundary sits, for local diagnostics. */
  where: BoundaryName;
  children: ReactNode;
}

interface State {
  failed: boolean;
  generation: number;
}

/**
 * Catches render errors, records `{code, stack}` locally with no document
 * content (rule 10), and offers "Reload", which remounts the subtree. Nothing
 * is sent anywhere (the opt-in report endpoint is M2).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, generation: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    recordError(this.props.where, error);
  }

  private readonly reload = (): void => {
    this.setState((s) => ({ failed: false, generation: s.generation + 1 }));
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert" className="error-boundary" data-testid="error-boundary">
          <h2>{t('error.title')}</h2>
          <p>{t('error.body')}</p>
          <Button label={t('error.reload')} variant="primary" onClick={this.reload} />
        </div>
      );
    }
    return (
      <div key={this.state.generation} className="error-boundary-content">
        {this.props.children}
      </div>
    );
  }
}
