import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4420', trace: 'retain-on-failure' },
  webServer: {
    command: `"${process.execPath}" --import tsx server/main.ts transcribe`,
    url: 'http://127.0.0.1:4420/api/health',
    reuseExistingServer: false,
    env: { PORT: '4420', DISABLE_WORKER: '1', DATA_DIR: path.resolve('data/browser-test') },
    timeout: 30000,
  },
});
