-- Associate one atomic batch of parent/child inserts without depending on the
-- connection-scoped last_insert_rowid() (which changes on child INSERTs).
ALTER TABLE parts ADD COLUMN creation_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_creation_token ON parts(creation_token);
ALTER TABLE projects ADD COLUMN creation_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_creation_token ON projects(creation_token);
