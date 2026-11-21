import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyReleaseDiff, classifyReleasePaths } from "../../scripts/classify-release.mjs";

test("frontend-only edits can enter the opt-in automated release lane", () => {
  assert.equal(classifyReleasePaths([
    "src/web/components/parts/PartsSearchInput.tsx",
    "src/web/routes/PartsListPage.tsx",
    "tests/web/security-regression.test.ts",
    "docs/operations.md",
  ]), "auto");
});

test("documentation and test-only changes skip deployment", () => {
  assert.equal(classifyReleasePaths([
    "README.md", "docs/disaster-recovery.md", "tests/integration/api.test.ts",
    "e2e/specs/app.e2e.spec.ts",
  ]), "skip");
});

test("every sensitive change requires a separately controlled release", () => {
  for (const path of [
    "migrations/0014_new.sql", "wrangler.toml", "package.json",
    "pnpm-lock.yaml", ".github/workflows/ci.yml",
    "src/worker/app.ts", "src/worker/features/import/import.repository.ts",
    "src/shared/types.ts", "scripts/verify-d1-backup.mjs",
  ]) {
    assert.equal(classifyReleasePaths(["src/web/App.tsx", path]), "review", path);
  }
});

test("empty, malformed, or unavailable base SHA fails closed", () => {
  assert.equal(classifyReleaseDiff("0".repeat(40), "a".repeat(40)), "review");
  assert.equal(classifyReleaseDiff("not-a-sha", "a".repeat(40)), "review");
  assert.equal(classifyReleaseDiff("a".repeat(40), "b".repeat(40)), "review");
});
