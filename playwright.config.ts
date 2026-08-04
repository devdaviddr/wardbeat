import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT ?? '3000'
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // Seed the demo admin + roles before the suite (idempotent, self-healing).
  globalSetup: './tests/e2e/global-setup.ts',
  // Delete the accounts the suite registers, so they don't accumulate in the
  // dev DB and flood the app's user pickers.
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html']] : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Reuse a running dev server locally; boot a production build in CI.
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Point the app at the local Mailpit catcher so the reset/verification
    // flows can be exercised end-to-end (email-flow.spec.ts reads the messages
    // back over Mailpit's API). Merged on top of the ambient env, so
    // DATABASE_URL / S3_* etc. still come through. NOTE: locally this only
    // applies when Playwright starts the server — a pre-existing `pnpm dev`
    // (reuseExistingServer) keeps its own env, and the email-flow tests skip
    // themselves if Mailpit isn't reachable.
    env: {
      EMAIL_ENABLED: 'true',
      EMAIL_FROM: 'e2e@example.com',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      APP_URL: baseURL,
    },
  },
})
