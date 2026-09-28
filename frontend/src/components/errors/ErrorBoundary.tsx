import * as React from 'react'
import { ErrorState } from './states'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Route-level error boundary — catches render-time crashes so a single
 * broken panel can never blank the command centre.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Console-only by design: stack traces must never reach the UI.
    console.error('[DineIQ] Render error:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="This view failed to render"
          description="A client-side error occurred while building this view. Retry the section or return to the dashboard."
          retry={() => this.setState({ error: null })}
          action={
            <Button variant="ghost" size="sm" onClick={() => window.location.assign('/dashboard')}>
              Back to dashboard
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}
