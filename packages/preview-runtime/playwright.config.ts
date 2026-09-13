import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.browser.test.ts', fullyParallel: false, workers: 1,
  timeout: 30000, use: { baseURL: 'http://localhost:5173', channel: 'chrome', headless: true },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
