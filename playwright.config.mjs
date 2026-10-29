import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Never attach these destructive fixture tests to an existing user's canvas.
const port = Number(process.env.CANVAS_TEST_PORT || 51910);
const baseURL = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-pw-'));

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun dist/server.js',
    env: { HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'error', EXCALIDRAW_DATA_DIR: dataDir },
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
