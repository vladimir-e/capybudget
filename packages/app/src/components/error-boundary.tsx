import { Component, type ErrorInfo, type ReactNode } from "react"
import { ErrorScreen } from "@/components/error-screen"

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error, errorInfo.componentStack)
    this.setState({ componentStack: errorInfo.componentStack ?? null })
  }

  render() {
    if (this.state.error) {
      return <ErrorScreen error={this.state.error} componentStack={this.state.componentStack} />
    }
    return this.props.children
  }
}
