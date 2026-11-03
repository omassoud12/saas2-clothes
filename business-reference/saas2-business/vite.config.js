import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Point /api at your Express backend during development.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
