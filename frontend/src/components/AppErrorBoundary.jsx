import { Component } from 'react'
import { Button, Card } from './ui/index.jsx'

export class AppErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="foundation-page">
        <Card className="foundation-fallback" aria-live="assertive">
          <span className="eyebrow">SaaS2 Clothes</span>
          <h1>We couldn&apos;t open this page.</h1>
          <p>Your data was not changed. Refresh the application and try again.</p>
          <Button onClick={() => window.location.reload()}>Refresh application</Button>
        </Card>
      </main>
    )
  }
}
