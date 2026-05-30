import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Backend API (Hono) dev port — see src/main.ts (PORT, default 3000).
const API_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Read the shared repo-root .env so VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  // / VITE_API_URL come from a single source of truth.
  envDir: path.resolve(__dirname, '..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5190,
    host: true,
    // Proxy /api to the backend so the browser stays same-origin (no CORS in dev).
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, secure: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          query: ['@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});

