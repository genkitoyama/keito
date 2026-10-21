import { defineConfig } from 'vitest/config';

// Tests run on the model and the server's store alone: none of the app's dev-server plugins
// (the boards folder and its watcher would keep the run from ending).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
