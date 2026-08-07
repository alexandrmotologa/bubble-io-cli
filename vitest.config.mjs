import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // vmForks: runs tests in Node VM contexts (same process) — avoids fork IPC
    // bootstrapping failure on Node 24.12.0 + Vitest 4.x where child process
    // workers fail to receive their injected test-runner config object.
    pool: 'vmForks',
  },
  resolve: {
    // Map ESM .js extension imports to TypeScript source files
    extensions: ['.ts', '.js'],
  },
});
