// Vite config. Requirement: NFR-5.2 (plain build tooling).
// The proxy forwards /api/* to the Express server, so the browser sees one origin in dev.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { environment: 'node' },
});
