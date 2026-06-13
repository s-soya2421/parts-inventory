ALTER TABLE projects ADD COLUMN image_url TEXT;
ALTER TABLE projects ADD COLUMN reference_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_parts_unique ON project_parts(project_id, part_id);
CREATE INDEX IF NOT EXISTS idx_project_parts_project_id ON project_parts(project_id);

CREATE TABLE IF NOT EXISTS project_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  memo TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_costs_project_id ON project_costs(project_id);
