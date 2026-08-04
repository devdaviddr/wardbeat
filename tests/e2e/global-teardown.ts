import { execSync } from 'node:child_process'

// Delete the throwaway accounts the suite registered through the real signup
// flow. Playwright points at the ambient DATABASE_URL, which locally is the dev
// database — without this the users accumulate run after run and end up in
// every "assign to" picker, since `listAssignees()` returns all users.
//
// Mirrors global-setup.ts. If a run crashes before teardown, clean up by hand
// with `pnpm db:prune:e2e`.
export default function globalTeardown() {
  execSync('pnpm db:prune:e2e', { stdio: 'inherit' })
}
