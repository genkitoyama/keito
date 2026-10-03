import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works under file:// (Tauri) and any sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5183, strictPort: false },
});
