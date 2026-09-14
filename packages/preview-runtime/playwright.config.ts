import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.browser.test.ts', fullyParallel: false, workers: 1,
  timeout: 30000, use: { baseURL: 'http://localhost:5273', channel: 'chrome', headless: true },
  webServer: { command: 'STUDIO_PORT=5373 PREVIEW_PORT=5374 npm run dev', url: 'http://localhost:5373', reuseExistingServer: false, timeout: 30000 },
});
