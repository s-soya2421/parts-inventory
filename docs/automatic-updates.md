# Safe automated updates (opt-in)

The goal is to keep the running Cloudflare Worker and existing D1 data available.
GitHub automation **does not guarantee zero downtime**.

## Policy

1. Dependabot opens weekly npm/pnpm and GitHub Actions PRs. It never merges or deploys them automatically. Major updates require explicit human review. The SheetJS vendor CDN tarball is reviewed manually.
2. Existing PR checks must succeed: lint/build, security and regression, Chromium desktop/mobile, and disposable local D1 backup/restore.
3. A merge into the canonical `nyokkirokki/parts-inventory` `main` triggers the release classifier.
4. Only changes in `src/web/**` or `public/**` (plus docs/tests) are eligible for *opt-in* automatic deployment. Any Worker code, D1 migration, auth middleware, configuration, workflow, package, or lockfile change is **review-only**.
5. An eligible change is re-tested from the exact merged commit in the dedicated release workflow, including a full local D1 migration/restore test and real headless browser checks.
6. Just before deployment, GitHub confirms the commit is still the latest `main`. Wrangler checks the **remote** D1 for unapplied migrations in read-only mode; if any are pending, it refuses to deploy. It never runs remote migrations automatically.
7. After `wrangler deploy`, the workflow checks the authenticated production `/api/health`. Any failure is reported; automatic rollback is **not** attempted, because Worker rollback does not revert D1 changes.

## Enable only after production review

At the *canonical upstream repository* (not just the fork), configure:

- Repository variable `AUTO_DEPLOY_ENABLED` = `true` (default: absent/off).
- Repository variable `PRODUCTION_BASE_URL` = the HTTPS site origin, without a path.
- GitHub **production** Environment. Restrict deployments to `main`. Optional required reviewers make even eligible deploys wait for approval.
- The production environment secrets `CLOUDFLARE_API_TOKEN` (least-privilege Worker deploy token), `CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_BASIC_AUTH_USER`, and `PRODUCTION_BASIC_AUTH_PASSWORD`.
- Keep branch protection: require the four existing CI workflows to pass before merging, disallow bypass, and require review for changes to workflows and database schema.

The token must be scoped to the exact Cloudflare account/Worker. Never commit it or copy production D1 data into CI.
First activation should be tested with an intentionally trivial web-only PR and monitored during a low-traffic window. The GitHub Actions job uses a disposable local D1 for tests and only reads the live D1 migration status prior to an approved deploy.

## Updates that remain manual

For any migration, Worker/API, authorization, dependency, secret, or `wrangler.toml` change, inspect the PR, take a verified Time Travel bookmark, verify migration order in staging, and apply schema changes before deploying matching Worker code. Follow `docs/disaster-recovery.md`. Never make live D1 exports/restores an automatic release step.

## Troubleshooting

- *No deployment after a merge*: check the release classification; confirm `AUTO_DEPLOY_ENABLED` and the canonical repository.
- *Pending D1 migration*: release stops before `wrangler deploy`; perform an independently approved DB migration procedure.
- *Health check failed*: investigate Cloudflare Worker logs and traffic, then use the previously reviewed release/rollback procedure. Rolling back Worker code cannot undo DB mutations.
