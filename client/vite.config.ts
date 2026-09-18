import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy so dev is same-origin with the API. This is what lets the session
    // cookie stay SameSite=Lax in both dev and production — the CORS-with-
    // credentials alternative would need SameSite=None in dev only, so dev would
    // stop exercising the cookie path that production actually runs.
    proxy: {
      '/api': { target: 'http://localhost:4000' },
    },
  },
})
