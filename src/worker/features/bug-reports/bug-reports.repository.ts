import type { BugReport } from "@shared/types";
import { AppError } from "../../middleware/error-handler";
import type { DbBugReportRow } from "../../types";
import type { BugReportWriteInput } from "./bug-reports.schemas";

function mapBugReport(row: DbBugReportRow): BugReport {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    stepsToReproduce: row.steps_to_reproduce,
    expectedBehavior: row.expected_behavior,
    actualBehavior: row.actual_behavior,
    severity: row.severity,
    githubIssueNumber: row.github_issue_number,
    githubIssueUrl: row.github_issue_url,
    githubSyncStatus: row.github_sync_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BugReportsRepository {
  constructor(private readonly db: D1Database) {}

  async consumeSubmissionSlot(clientKey: string, nowSeconds: number): Promise<{ requestCount: number; windowStartedAt: number }> {
    const windowSeconds = 60;
    const windowStart = nowSeconds - windowSeconds;
    await this.db
      .prepare("DELETE FROM bug_report_rate_limits WHERE window_started_at < ?")
      .bind(nowSeconds - 60 * 60)
      .run();

    const row = await this.db
      .prepare(
        `INSERT INTO bug_report_rate_limits (client_key, window_started_at, request_count)
         VALUES (?, ?, 1)
         ON CONFLICT(client_key) DO UPDATE SET
           request_count = CASE WHEN bug_report_rate_limits.window_started_at <= ? THEN 1 ELSE bug_report_rate_limits.request_count + 1 END,
           window_started_at = CASE WHEN bug_report_rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE bug_report_rate_limits.window_started_at END
         RETURNING request_count, window_started_at`,
      )
      .bind(clientKey, nowSeconds, windowStart, windowStart)
      .first<{ request_count: number; window_started_at: number }>();
    if (!row) throw new AppError("BUG_REPORT_RATE_LIMIT_FAILED", "Failed to apply submission rate limit.", 500);
    return { requestCount: row.request_count, windowStartedAt: row.window_started_at };
  }

  async create(input: BugReportWriteInput): Promise<BugReport> {
    const row = await this.db
      .prepare(
        `INSERT INTO bug_reports (title, description, steps_to_reproduce, expected_behavior, actual_behavior, severity)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        input.title,
        input.description,
        input.stepsToReproduce || null,
        input.expectedBehavior || null,
        input.actualBehavior || null,
        input.severity,
      )
      .first<DbBugReportRow>();
    if (!row) throw new AppError("BUG_REPORT_CREATE_FAILED", "Failed to save bug report.", 500);
    return mapBugReport(row);
  }

  async markGitHubIssueCreated(id: number, issueNumber: number, issueUrl: string): Promise<BugReport> {
    const row = await this.db
      .prepare(
        `UPDATE bug_reports
         SET github_issue_number = ?, github_issue_url = ?, github_sync_status = 'created', github_sync_error = NULL,
             updated_at = datetime('now')
         WHERE id = ?
         RETURNING *`,
      )
      .bind(issueNumber, issueUrl, id)
      .first<DbBugReportRow>();
    if (!row) throw new AppError("BUG_REPORT_NOT_FOUND", "Bug report not found.", 404);
    return mapBugReport(row);
  }

  async markGitHubSyncFailed(id: number, error: string): Promise<BugReport> {
    const row = await this.db
      .prepare(
        `UPDATE bug_reports
         SET github_sync_status = 'failed', github_sync_error = ?, updated_at = datetime('now')
         WHERE id = ?
         RETURNING *`,
      )
      .bind(error.slice(0, 1000), id)
      .first<DbBugReportRow>();
    if (!row) throw new AppError("BUG_REPORT_NOT_FOUND", "Bug report not found.", 404);
    return mapBugReport(row);
  }
}
