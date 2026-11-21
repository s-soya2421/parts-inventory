# Headless UI regression tests

These are **real Chromium browser tests** (desktop + Pixel 7 mobile emulation) running against the production-built React assets and an actual local Cloudflare Worker + locally migrated D1 database, **not mocked API calls**.

## Locally

In the repository root:

```sh
pnpm install --frozen-lockfile
npm install --prefix e2e
./e2e/node_modules/.bin/playwright install chromium
pnpm build
pnpm exec wrangler d1 migrations apply db-parts --local --persist-to .wrangler/state
cp .dev.vars.example .dev.vars
# Update .dev.vars to BASIC_AUTH_USER=e2e / BASIC_AUTH_PASSWORD=test-only-secret
./e2e/node_modules/.bin/wrangler dev --local --persist-to .wrangler/state --port 8787
```

Then run `npm --prefix e2e test` in another terminal. Only run with disposable/local D1 data. The GitHub Actions job initializes a fresh D1 and disposable test-only credentials for each run.

Coverage includes Basic Auth (SPA + API), responsive navigation, create/edit with preservation of nullable fields, stock in/out and invalid out operations, search, JSON import/undo, JSON export and API 404. Each browser project executes the same scenarios. On failures, Playwright uploads screenshots, traces, videos and an HTML report.

The browser tests complement—not replace—the Vitest unit/API integration suite. They do **not** assert real remote Cloudflare WAF behavior, production database backups, third-party browser compatibility or pixel-perfect visual snapshots.
