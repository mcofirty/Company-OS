import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // 45 s : le QG 3D est rendu en WebGL logiciel (SwiftShader) dans le navigateur de test.
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // QG 3D : WebGL logiciel (SwiftShader) en navigateur sans GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  // Démarre API + worker démo + web si besoin. Prérequis : docker compose up -d, pnpm db:migrate, pnpm db:seed.
  webServer: {
    command: 'pnpm dev',
    env: {
      DEMO_AUTOPILOT: process.env.DEMO_AUTOPILOT ?? 'true',
      // Connecteurs e2e : serveur MCP de test local (http, 127.0.0.1) et clé de test non secrète.
      CONNECTOR_ALLOW_PRIVATE_NETWORK: 'true',
      CONNECTOR_SECRET_KEY: Buffer.alloc(32, 9).toString('base64'),
    },
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
