import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Pixelweave crashed', error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="fatal-error">
        <TriangleAlert aria-hidden="true" size={34} />
        <h1>エディターを起動できませんでした</h1>
        <p>
          編集内容が自動保存されている場合は、再読み込み後に復元できます。
        </p>
        <details>
          <summary>エラーの詳細</summary>
          <pre>{this.state.error.message}</pre>
        </details>
        <button type="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </main>
    );
  }
}
