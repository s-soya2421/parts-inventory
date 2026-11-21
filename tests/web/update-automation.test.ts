import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dependabot = readFileSync(".github/dependabot.yml", "utf8");
const upstreamSync = readFileSync(".github/workflows/upstream-sync.yml", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("automated updates preserve deployment safety", () => {
  it("checks runtime, browser-test and GitHub Actions dependencies", () => {
    expect(dependabot.match(/package-ecosystem: "npm"/g)).toHaveLength(2);
    expect(dependabot).toContain('directory: "/e2e"');
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
    expect(dependabot).toContain('ignore:\n      - dependency-name: "xlsx"');
  });

  it("never directly deploys or merges an upstream sync proposal", () => {
    expect(upstreamSync).toContain("if: github.repository == 's-soya2421/parts-inventory'");
    expect(upstreamSync).toContain("--draft");
    expect(upstreamSync).toContain("git merge --no-ff --no-edit");
    expect(upstreamSync).toContain("git merge --abort");
    expect(upstreamSync).toContain("HEAD:refs/heads/automation/upstream-sync");
    expect(upstreamSync).not.toMatch(/(?:wrangler deploy|d1 migrations apply|gh pr merge)/);
    expect(upstreamSync).not.toMatch(/git push[^\n]*refs\/heads\/main/);
  });

  it("dispatches all four read-only quality gates on bot PRs", () => {
    for (const workflow of [
      "ci.yml",
      "security-regression.yml",
      "browser-e2e.yml",
      "backup-restore.yml",
    ]) {
      expect(upstreamSync).toContain(workflow);
    }
    expect(ci).toContain("  workflow_dispatch:");
  });
});
