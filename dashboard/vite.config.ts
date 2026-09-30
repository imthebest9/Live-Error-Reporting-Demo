import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the dashboard talks to the API through Vite's proxy, so it is same-origin and needs no CORS.
// (In Docker, nginx plays the same role: see nginx.conf.)
const api = 'http://localhost:5080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': api,
      '/hubs': { target: api, ws: true },
    },
  },
});
