import { Component, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from '../ui/components';
import { openReport } from '../features/report/reportStore';
import { recordError, type BoundaryName, type DiagnosticEntry } from './diagnostics';

interface Props {
  /** Where the boundary sits, for local diagnostics. */
  where: BoundaryName;
  children: ReactNode;
}

interface State {
  failed: boolean;
  generation: number;
  /** The caught error as recorded locally (offered in an error report). */
  entry: DiagnosticEntry | null;
}

/**
 * Catches render errors, records `{code, stack}` locally with no document
 * content (rule 10), and offers "Reload", which remounts the subtree, and
 * "Send Error Report…", which shows the report before anything is sent (M2-17).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, generation: 0, entry: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.setState({ entry: recordError(this.props.where, error) });
  }

  private readonly reload = (): void => {
    this.setState((s) => ({ failed: false, generation: s.generation + 1, entry: null }));
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert" className="error-boundary" data-testid="error-boundary">
          <h2>{t('error.title')}</h2>
          <p>{t('error.body')}</p>
          <div className="error-boundary-actions">
            <Button label={t('error.reload')} variant="primary" onClick={this.reload} />
            <Button
              label={t('error.report')}
              onClick={() => {
                openReport({ error: this.state.entry, feature: this.props.where });
              }}
            />
          </div>
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
