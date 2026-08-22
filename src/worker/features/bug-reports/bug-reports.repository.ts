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
