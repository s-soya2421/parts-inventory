import { Hono } from "hono";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { BugReportsRepository } from "./bug-reports.repository";
import { bugReportWriteSchema } from "./bug-reports.schemas";

type GitHubIssueResponse = { number?: unknown; html_url?: unknown; message?: unknown };

function formatIssueBody(input: {
  description: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  severity: string;
}): string {
  const section = (heading: string, value: string) => `## ${heading}\n\n${value || "（未記入）"}`;
  return [
    "<!-- Submitted from the parts inventory app. -->",
    section("概要", input.description),
    section("再現手順", input.stepsToReproduce),
    section("期待する動作", input.expectedBehavior),
    section("実際の動作", input.actualBehavior),
    section("重要度", input.severity),
  ].join("\n\n");
}

async function createGitHubIssue(env: Env["Bindings"], input: {
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  severity: string;
}): Promise<{ number: number; url: string } | null> {
  const token = env.GITHUB_TOKEN?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  if (!token || !repository) return null;

  const response = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "parts-inventory-bug-reporter",
    },
    body: JSON.stringify({
      title: `[Bug] ${input.title}`,
      body: formatIssueBody(input),
      ...(env.GITHUB_ISSUE_ASSIGNEE?.trim() ? { assignees: [env.GITHUB_ISSUE_ASSIGNEE.trim()] } : {}),
    }),
  });
  const result = await response.json().catch(() => ({})) as GitHubIssueResponse;
  if (!response.ok || typeof result.number !== "number" || typeof result.html_url !== "string") {
    throw new Error(typeof result.message === "string" ? result.message : `GitHub API returned ${response.status}`);
  }
  return { number: result.number, url: result.html_url };
}

export const bugReportsRoutes = new Hono<Env>();

bugReportsRoutes.post("/", async (c) => {
  const input = bugReportWriteSchema.parse(await c.req.json());
  const repository = new BugReportsRepository(getDb(c.env));
  const saved = await repository.create(input);

  try {
    const issue = await createGitHubIssue(c.env, input);
    if (!issue) return c.json({ data: saved }, 201);
    return c.json({ data: await repository.markGitHubIssueCreated(saved.id, issue.number, issue.url) }, 201);
  } catch (error) {
    console.error({ event: "bug_report_github_sync_failed", reportId: saved.id, error: error instanceof Error ? error.message : String(error) });
    return c.json({ data: await repository.markGitHubSyncFailed(saved.id, error instanceof Error ? error.message : String(error)) }, 202);
  }
});
