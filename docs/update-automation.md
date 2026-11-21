# Automated update workflow

## What is automated

- **Dependency discovery:** Dependabot checks npm/pnpm manifests in `/` and npm browser-test tooling in `/e2e` every Monday morning (JST), plus GitHub Actions versions.
- **Proposed updates:** Dependabot creates pull requests. Production patch and development patch/minor updates are grouped to reduce noise; major updates remain separate for explicit review.
- **Testing:** Every PR passes through existing lint, unit/integration tests, production dependency audit, headless desktop/mobile Chromium E2E, and disposable local D1 SQL backup/restore verification before acceptance. GitHub branch protection must require these checks if they are to be enforced.
- **Fork sync:** On the personal fork `s-soya2421/parts-inventory` only, `upstream-sync.yml` checks `nyokkirokki/parts-inventory:main` weekly. It creates or updates **a draft PR** targeting the fork's main. It never updates main directly. If Git cannot merge cleanly, it fails without pushing a conflicted branch.
- **Read-only CI dispatch:** Because GitHub may require approval for workflows on a PR created with `GITHUB_TOKEN`, the fork-sync job also explicitly dispatches the four existing verification workflows on the proposal branch.

## What is NOT automated (intentionally)

- No auto-merge for dependency, migration, or upstream-sync PRs.
- No automatic Cloudflare deploy, remote D1 migration, export, Time Travel restore, or database write.
- No unaudited upgrade of the pinned SheetJS `xlsx` vendor tarball. Manually review a new vendor release, update the URL, and verify its integrity.

The priority is to keep the running application available. Local D1 tests do not prove that an unreviewed remote migration is zero-downtime. Follow `docs/disaster-recovery.md` for recovery-point checks and explicit release authorization.

## One-time setup (maintainer)

1. Merge this automation configuration into the **upstream repository's default branch** to enable its Dependabot updates. Enable Dependabot version/security updates in repository settings where needed.
2. Sync the **personal fork's default branch** with upstream, including `.github/workflows/upstream-sync.yml` and the updated `ci.yml`. Scheduled GitHub Actions only run workflows on the repository default branch, and fork Actions may need to be enabled in repository Settings.
3. For the fork, under **Settings → Actions → General**, grant its `GITHUB_TOKEN` permission to open pull requests ("Allow GitHub Actions to create and approve pull requests"), or replace that capability with a suitably scoped GitHub App token. The PR creation job fails closed without it.
4. Configure branch protection or rulesets on both default branches: require the existing CI, security regression, Chromium E2E, and local D1 restore checks; prevent direct pushes; and require review for release/migration changes. Review GitHub Actions logs for failed/blocked update proposals.
5. Manually test `workflow_dispatch` for "Propose upstream sync (fork only)" on the fork after settings are configured. It will propose a draft PR, not merge code.

## Production rollout is a distinct operation

The current `package.json` migration scripts refer to `parts-inventory` while `wrangler.toml` binds D1 to `db-parts`; reconcile this mismatch and verify a staging migration before using `pnpm deploy` or adding any automated production deploy job. Do not assume a main-branch merge is safe to deploy automatically: check Cloudflare Workers Builds or other external Git integration settings.

Only after a separate staging environment, rollback procedure, D1 Time Travel bookmark validation, health checks, release approval, and secret isolation are configured should production deployment automation be considered.

## Troubleshooting

- **Dependency PR blocked:** Read its CI result; avoid bypassing a regression gate merely because the update is labelled patch.
- **Fork-sync conflict:** The proposed branch is not pushed if `git merge` fails. Resolve the named files manually and rerun the workflow.
- **No fork-sync PR:** Ensure scheduled workflows are enabled on the fork's default branch and Actions can create PRs.
- **No checks on bot PR:** The workflow dispatches all four test workflows on its proposal branch; verify those runs explicitly.
