/**
 * Last-resort React boundary. It replaces an unrenderable application with a
 * stable reload surface; ordinary storage/network failures belong in local UI.
 */
import { Component, type ReactNode } from 'react';

import { isBoardSpecificPath } from '../account/boardRouting';
import { bestEffortLocalStorage } from '../bestEffortStorage';

interface AppErrorBoundaryProps {
  children: ReactNode;
  entryLocation: string;
}

interface AppErrorBoundaryState {
  error: string | null;
  failed: boolean;
}

/** Replaces fatal render failures with a safe local-data recovery surface. */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  private readonly preserveEntryLocation = !isBoardSpecificPath(
    new URL(this.props.entryLocation, window.location.origin).pathname,
  );

  override state: AppErrorBoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      failed: true,
    };
  }

  override componentDidCatch(error: unknown): void {
    if (this.preserveEntryLocation) {
      window.history.replaceState(
        window.history.state,
        '',
        this.props.entryLocation,
      );
    }
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
        : String(error);
    bestEffortLocalStorage.setItem('chalkboard:last-recovery-error', detail);
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-state" role="alert" aria-labelledby="fatal-title">
        <section className="fatal-state__card">
          <span className="account-kicker">Chalkboard recovery</span>
          <h1 id="fatal-title">Chalkboard needs to restart</h1>
          <p>
            Chalkboard could not render this screen. Work already saved in this
            browser or the cloud has not been removed.
          </p>
          <div className="fatal-state__actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload Chalkboard
            </button>
            <a href="/local">Open local board</a>
          </div>
          {this.state.error !== null ? (
            <details className="fatal-state__details">
              <summary>Technical details</summary>
              <code>{this.state.error}</code>
            </details>
          ) : null}
          <small>
            If this happens again, keep this tab open so the technical details
            remain available when reporting the problem.
          </small>
        </section>
      </main>
    );
  }
}
