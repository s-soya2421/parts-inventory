import { Hono } from "hono";
import { getDb } from "../../db/client";
import { AppError } from "../../middleware/error-handler";
import type { Env } from "../../types";
import { BugReportsRepository } from "./bug-reports.repository";
import { bugReportWriteSchema } from "./bug-reports.schemas";

type GitHubIssueResponse = { number?: unknown; html_url?: unknown; message?: unknown };

const RATE_LIMIT_MAX_REQUESTS = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60;

async function clientKey(c: { req: { header(name: string): string | undefined } }): Promise<string> {
  const rawAddress = (c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawAddress));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
  const nowSeconds = Math.floor(Date.now() / 1000);
  const limit = await repository.consumeSubmissionSlot(await clientKey(c), nowSeconds);
  if (limit.requestCount > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (nowSeconds - limit.windowStartedAt));
    c.header("retry-after", String(retryAfterSeconds));
    throw new AppError("BUG_REPORT_RATE_LIMITED", "Too many bug reports. Please try again shortly.", 429, { retryAfterSeconds });
  }
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
