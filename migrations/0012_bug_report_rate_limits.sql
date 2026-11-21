CREATE TABLE IF NOT EXISTS bug_report_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bug_report_rate_limits_window_started_at
  ON bug_report_rate_limits(window_started_at);
