import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keeps a crash in one part of a page from blanking the rest of it. Remount it (change `key`) to try again. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.label, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mt-6 rounded-xl border bg-background px-4 py-8 text-center text-sm">
        <p className="font-medium">{this.props.label} could not be shown.</p>
        <p className="mt-1 text-muted-foreground">The rest of the page still works. Reload to try again.</p>
      </div>
    );
  }
}
