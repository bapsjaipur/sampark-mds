// src/components/ErrorBoundary.jsx — Attio redesign.
import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Uncaught error:', error, info);
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50/50 px-4">
          <div className="w-full max-w-md rounded-lg border border-slate-100 bg-white p-8 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-3 text-lg font-semibold text-slate-900">Something went wrong</p>
            <p className="mt-1 text-sm text-slate-400">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <div className="mt-5 flex justify-center gap-2">
              <button onClick={this.handleReset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Try again</button>
              <button onClick={() => window.location.reload()} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700">Reload page</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
