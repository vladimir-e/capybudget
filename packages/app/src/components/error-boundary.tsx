import { Component, type ErrorInfo, type ReactNode } from "react"
import { ErrorScreen } from "@/components/error-screen"
import { setCrashComponentStack } from "@/lib/crash-recovery"

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error, errorInfo.componentStack)
    setCrashComponentStack(errorInfo.componentStack)
  }

  render() {
    if (this.state.error) {
      return <ErrorScreen error={this.state.error} />
    }
    return this.props.children
  }
}
