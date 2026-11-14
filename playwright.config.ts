import { defineConfig } from '@playwright/test';

// End-to-end tests run the new app against its own emulators (firebase.emulators.test.json:
// auth 9199, firestore 8180) on port 5199, so they never touch `npm run dev` or real data.
// The old app is served from docs/ on 8792 for the print comparison.
export const APP_URL = 'http://localhost:5199';
export const OLD_APP_URL = 'http://localhost:8792';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  // One emulator, shared state: run tests one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    // The installed Google Chrome; no browser download needed.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command:
        'scripts/with-java.sh firebase --config firebase.emulators.test.json emulators:exec --project demo-bioeng --only auth,firestore ' +
        '"node scripts/seed.mjs && VITE_EMULATOR_AUTH_PORT=9199 VITE_EMULATOR_FIRESTORE_PORT=8180 vite --port 5199 --strictPort"',
      url: APP_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      // Lets the Firebase CLI stop its emulators instead of leaving the Java process behind.
      gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 },
      stdout: 'ignore',
      stderr: 'pipe'
    },
    {
      command: 'python3 -m http.server 8792 --bind 127.0.0.1 --directory docs',
      url: OLD_APP_URL,
      timeout: 30_000,
      reuseExistingServer: false
    }
  ]
});
