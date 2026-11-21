# Changelog

## 0.2.1 — 2026-11-21 (PR candidate; not yet deployed)

### Integrity and reliability
- Remove D1 N+1 queries for part list and export using bounded bulk hydration; chunk large ID lists under 100 SQL bindings.
- Use atomic D1 batches for part/project parent and children, including migration-backed creation tokens.
- Apply stock changes and movement history in a single D1 transaction using SQL arithmetic instead of stale read/modify/write.
- Preserve existing part fields when importing partial rows; look up categories by name before generating a slug.
- Store post-import snapshots for revert preflight and reject overwriting manual changes; retries can resume partial operations.
- Reject deletion of project-linked parts to avoid silently removing bill-of-material lines.
- Keep nullable prices and distinct part names when editing; correct bulk location reset and location-name search.
- Prevent stale React search/form responses, reject unknown API paths with JSON 404, and fix cache invalidation and rejected Promise handling.
- Validate import attributes before category creation and reject duplicate part attribute keys.
- Repair missing development-secret example and Node/proxy documentation.

### Regression coverage
- Added targeted failing-first tests for data consistency, Free D1 query budgets, concurrent stock movements, import revert conflicts, 100-parameter batches, BOM deletion and API routing.
- Final CI must pass Web unit tests, D1/SQLite integration tests, build, lint, and production advisory audit before merging.

### Migration / deployment considerations
- Apply `0011_atomic_create_tokens.sql` and `0012_import_after_snapshots.sql` before deploying Worker code.
- Import batches created before `0.2.1` have no after-snapshot and are intentionally NOT automatically reversible (HTTP 409); recover them manually from an appropriate backup when necessary.
- Import revert performs a preflight and supports retry, but does not yet guarantee full atomicity across all entries on a mid-operation infrastructure failure.
- Full live Cloudflare Worker/Free D1 E2E, WAF/rate limits, comprehensive DB backup/restore, some category/attribute migration and full React browser tests remain separate follow-ups.


## 0.2.0 — 2026-11-21

### Security
- Run the Cloudflare Worker before *all* static asset requests so Basic Auth protects the SPA shell and assets as intended.
- Reject cross-origin/cross-site state-changing API requests using Origin and Fetch Metadata checks; reject non-JSON mutation bodies.
- Neutralize spreadsheet formula-looking strings when exporting CSV, including headers and leading whitespace.
- Upgrade vulnerable SheetJS 0.18.5 to the vendor-maintained 0.20.3 tarball and lock its integrity with pnpm.
- Upgrade Hono, React Router, Zod, and PostCSS; move the Vite React plugin into development dependencies.
- Require the regression CI to fail if production dependency auditing finds HIGH-or-worse advisories.

### Tests
- Add table-driven regressions for Basic Auth boundaries, CSRF, CSV injection, schema limits and coercions, import batch caps, stock changes, stock history and Cloudflare asset routing.
- CI runs with Node 24 and pnpm 10: lint, Web suite, in-process D1 integration suite, TypeScript and production build.
- The new CSV and asset tests were observed failing before fixes, then passing after fixes (red/green proof).

### Outstanding
- Browser and real-deployment penetration tests are separate from in-process CI. Check Cloudflare WAF/rate limits for password-guessing protection.
- CI currently fails on HIGH-or-worse advisories and reports lower severities. Future advisories need triage.
