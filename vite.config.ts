import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { keitoBoards } from './server/boards';

// Relative base so the same build works under file:// (Tauri) and any sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), keitoBoards()],
  server: {
    port: 5183,
    strictPort: false,
    // Saving a board must not look like a source change to the dev server.
    watch: { ignored: ['**/boards/**'] },
  },
});
