import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Node's built-in `node:sqlite` is newer than vite 5's builtin list, so
    // keep it external and let the Node runtime resolve it.
    server: {
      deps: {
        external: [/^node:sqlite$/],
      },
    },
  },
});
