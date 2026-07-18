import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // serve on the LAN so a phone on the same Wi-Fi can open it (Vite prints a Network URL)
    proxy: {
      '/api': 'http://localhost:5175',
    },
  },
});
