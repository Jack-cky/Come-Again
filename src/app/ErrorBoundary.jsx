import { Component } from "react";

// Catches render-time errors so a single faulty component cannot blank the
// whole app — important here because both practice modes lean on browser
// APIs whose behaviour varies between devices.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Unhandled render error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="alert error-boundary" role="alert">
          <p>
            <strong>Something went wrong.</strong> The page hit an unexpected error — reloading usually fixes
            it.
          </p>
          <button className="btn btn-primary" type="button" onClick={this.handleReload}>
            Reload the app
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
