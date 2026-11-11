import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'backend/src/**/*.test.ts',
      'frontend/src/**/*.test.ts',
    ],
  },
});
