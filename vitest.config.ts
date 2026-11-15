import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    globalSetup: ['./tests/setup/test-db.ts'],
    // Les tests d'intégration partagent une base de test : exécution séquentielle des fichiers.
    fileParallelism: false,
  },
});
