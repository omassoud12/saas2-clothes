import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change far less often than the app, so after an update the
        // browser keeps them from its cache and only downloads the app code again.
        codeSplitting: {
          groups: [
            // [\\/] matches the folder separator on Windows and Linux.
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: 'supabase', test: /[\\/]node_modules[\\/]@supabase[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
