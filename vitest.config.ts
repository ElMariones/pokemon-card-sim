import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@pcs/shared': r('./packages/shared/src/index.ts'),
      '@pcs/db/schema': r('./packages/db/src/schema.ts'),
      '@pcs/db': r('./packages/db/src/index.ts'),
      '@pcs/pack-engine': r('./packages/pack-engine/src/index.ts'),
      '@pcs/economy-engine': r('./packages/economy-engine/src/index.ts'),
      '@pcs/card-data': r('./packages/card-data/src/index.ts'),
    },
  },
});
