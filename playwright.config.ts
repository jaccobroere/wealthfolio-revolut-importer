import { defineConfig, devices } from '@playwright/test';

const port = process.env.WF_REVOLUT_TEST_PORT ?? '18881';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60_000,
  forbidOnly: true,
  retries: 0,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
