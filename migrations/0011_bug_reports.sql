CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  steps_to_reproduce TEXT,
  expected_behavior TEXT,
  actual_behavior TEXT,
  severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),
  github_issue_number INTEGER,
  github_issue_url TEXT,
  github_sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (github_sync_status IN ('pending', 'created', 'failed')),
  github_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_github_sync_status ON bug_reports(github_sync_status);
