import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// During `npm run dev` the React app runs on :5173 and proxies API calls to the
// Express backend on :8688. In production the backend serves the built app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8688',
    },
  },
  build: {
    outDir: 'dist',
  },
})
