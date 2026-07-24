import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("API Monitor render error", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-[#17152f] p-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-red-300/20 bg-white/[0.08] p-6 text-center backdrop-blur-xl">
          <h1 className="text-lg font-medium">API Monitor needs to reload</h1>
          <p className="mt-2 break-words text-xs text-white/60">
            {this.state.error.message || "An unexpected display error occurred."}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white/90 hover:bg-white/15"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
