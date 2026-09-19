import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Native Vite support for tsconfig path aliases (e.g. from nest g library).
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
