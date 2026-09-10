import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from './lib/supabase.js'

function App() {
  const [apiStatus, setApiStatus] = useState('Checking…')

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable')
        return response.json()
      })
      .then(() => setApiStatus('Connected'))
      .catch(() => setApiStatus('Unavailable'))
  }, [])

  return (
    <main>
      <section className="card">
        <span className="eyebrow">Clothes inventory</span>
        <h1>Your new project is ready.</h1>
        <p>React, Node.js, and Supabase are wired together and ready for features.</p>
        <div className="statuses">
          <div><span>React</span><strong>Ready</strong></div>
          <div><span>Node API</span><strong>{apiStatus}</strong></div>
          <div><span>Supabase</span><strong>{isSupabaseConfigured ? 'Configured' : 'Add credentials'}</strong></div>
        </div>
      </section>
    </main>
  )
}

export default App
