-- Record post-import state to reject unsafe later reverts.
ALTER TABLE import_batch_entries ADD COLUMN after_json TEXT;
