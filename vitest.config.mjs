import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    // Disable Node 24 native type stripping to prevent conflicts with Vitest's test runner
    execArgv: ['--no-experimental-strip-types'],
  },
  resolve: {
    // Map ESM .js extension imports to TypeScript source files
    extensions: ['.ts', '.js'],
  },
});
