-- Transactional CHECK assertion for all-or-nothing import revert.
CREATE TABLE IF NOT EXISTS import_revert_guards (
  batch_id INTEGER PRIMARY KEY,
  valid INTEGER NOT NULL CONSTRAINT revert_guard_valid CHECK (valid = 1)
);
CREATE INDEX IF NOT EXISTS idx_import_batch_entries_batch_part ON import_batch_entries(batch_id, part_id);
CREATE TABLE IF NOT EXISTS attribute_change_guards (
  category_id INTEGER PRIMARY KEY,
  valid INTEGER NOT NULL CONSTRAINT attribute_guard_valid CHECK (valid = 1)
);
