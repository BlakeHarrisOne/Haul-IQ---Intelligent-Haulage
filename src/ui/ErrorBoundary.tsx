/**
 * Region-level error boundary: a crash in one part of the app (3D viewport, a sheet view, the inspector) shows a calm,
 * recoverable card in that region instead of blanking the whole app. The scenario lives in the store (and autosave),
 * so "Try again" simply remounts the region.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './primitives';
import { Icon } from './icons';

interface Props { region: string; children: ReactNode; /** Compact inline variant for small regions (inspector). */ compact?: boolean }
interface State { error: Error | null; key: number }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[hAIul SIM] ${this.props.region} crashed`, error, info.componentStack);
  }

  private retry = () => this.setState(s => ({ error: null, key: s.key + 1 }));

  render() {
    const { error, key } = this.state;
    if (!error) return <ErrorKey key={key}>{this.props.children}</ErrorKey>;
    const pad = this.props.compact ? 16 : 32;
    return (
      <div role="alert" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: pad, pointerEvents: 'auto' }}>
        <div style={{ maxWidth: 460, padding: 20, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--hair)', boxShadow: 'var(--shadow)', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: '600 15px/20px var(--font)', color: 'var(--ink)' }}>
            <span style={{ color: 'var(--bad)' }}><Icon name="warning" /></span>
            {this.props.region} hit a problem
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
            Your scenario is safe — nothing was lost. Try again to reload this part of the app; the rest keeps working.
          </div>
          <code style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error.message}</code>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={() => location.reload()}>Reload app</Button>
            <Button size="sm" variant="primary" icon="reset" onClick={this.retry}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }
}

/** Remount children on retry (fresh component state). */
function ErrorKey({ children }: { children: ReactNode }) { return <>{children}</>; }
