import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  // Remounts the boundary's children when this changes (e.g. the path that
  // failed) so retrying with a corrected path doesn't stay stuck in the
  // errored state.
  resetKey: string
}

interface State {
  error: Error | null
}

// useGLTF (drei) throws on a 404/malformed GLB rather than resolving --
// without this, a typo'd model path in RenderingTestPanel would crash the
// whole Settings modal instead of just failing to preview.
export default class ModelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-950 px-4 text-center text-xs text-rose-300">
          Failed to load model: {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}
