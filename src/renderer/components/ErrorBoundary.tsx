import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary component for catching and displaying errors gracefully
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({ errorInfo });

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset error state if resetKeys change
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      prevProps.resetKeys &&
      this.props.resetKeys.some((key, index) => key !== prevProps.resetKeys?.[index])
    ) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.reset}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onReset: () => void;
}

/**
 * Default fallback UI for error boundary
 */
const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, errorInfo, onReset }) => {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="error-boundary-fallback">
      <div className="error-boundary-content">
        <div className="error-boundary-icon">[!]</div>
        <h2 className="error-boundary-title">Something went wrong</h2>
        <p className="error-boundary-message">
          An unexpected error occurred. This is usually temporary and can be fixed by refreshing.
        </p>

        <div className="error-boundary-actions">
          <button className="error-boundary-btn primary" onClick={onReset}>
            Try Again
          </button>
          <button
            className="error-boundary-btn secondary"
            onClick={() => window.location.reload()}
          >
            Reload Application
          </button>
        </div>

        <div className="error-boundary-details-section">
          <button
            className="error-boundary-toggle"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? '[-] Hide Technical Details' : '[+] Show Technical Details'}
          </button>

          {showDetails && (
            <div className="error-boundary-details">
              <div className="error-boundary-detail-item">
                <strong>Error:</strong>
                <code>{error?.message || 'Unknown error'}</code>
              </div>
              {error?.stack && (
                <div className="error-boundary-detail-item">
                  <strong>Stack Trace:</strong>
                  <pre>{error.stack}</pre>
                </div>
              )}
              {errorInfo?.componentStack && (
                <div className="error-boundary-detail-item">
                  <strong>Component Stack:</strong>
                  <pre>{errorInfo.componentStack}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * HOC for wrapping components with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

export default ErrorBoundary;
