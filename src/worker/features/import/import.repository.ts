export type ImportEntryInput = {
  partId: number;
  action: "create" | "update";
  beforeJson: string | null;
  afterJson: string;
};

export type ImportBatchSummary = {
  id: number;
  mode: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
  revertedAt: string | null;
  revertable: boolean;
};

type DbImportBatchRow = {
  id: number;
  mode: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  reverted_at: string | null;
  created_at: string;
  revertable: number;
};

type DbImportEntryRow = {
  id: number;
  batch_id: number;
  part_id: number;
  action: "create" | "update";
  before_json: string | null;
  after_json: string | null;
};

export class ImportBatchesRepository {
  constructor(
    private readonly db: D1Database,
    private readonly retentionDays = 7,
  ) {}

  async createBatch(
    summary: { mode: string; createdCount: number; updatedCount: number; skippedCount: number; failedCount: number },
    entries: ImportEntryInput[],
  ): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO import_batches (mode, created_count, updated_count, skipped_count, failed_count)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(summary.mode, summary.createdCount, summary.updatedCount, summary.skippedCount, summary.failedCount)
      .first<{ id: number }>();
    if (!row) throw new Error("Failed to create import batch.");

    if (entries.length > 0) {
      await this.db.batch(
        entries.map((entry) =>
          this.db
            .prepare("INSERT INTO import_batch_entries (batch_id, part_id, action, before_json, after_json) VALUES (?, ?, ?, ?, ?)")
            .bind(row.id, entry.partId, entry.action, entry.beforeJson, entry.afterJson),
        ),
      );
    }
    return row.id;
  }

  async listRecent(): Promise<ImportBatchSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT *,
            CASE WHEN reverted_at IS NULL AND datetime(created_at, '+${this.retentionDays} days') > datetime('now') THEN 1 ELSE 0 END AS revertable
         FROM import_batches
         WHERE datetime(created_at, '+${this.retentionDays} days') > datetime('now')
         ORDER BY created_at DESC, id DESC
         LIMIT 50`,
      )
      .all<DbImportBatchRow>();
    return results.map(mapBatch);
  }

  async getRevertableBatch(id: number): Promise<{ batch: ImportBatchSummary; entries: DbImportEntryRow[] } | null> {
    const batch = await this.db
      .prepare(
        `SELECT *,
            CASE WHEN reverted_at IS NULL AND datetime(created_at, '+${this.retentionDays} days') > datetime('now') THEN 1 ELSE 0 END AS revertable
         FROM import_batches WHERE id = ?`,
      )
      .bind(id)
      .first<DbImportBatchRow>();
    if (!batch) return null;
    const { results } = await this.db
      .prepare("SELECT * FROM import_batch_entries WHERE batch_id = ? ORDER BY id DESC")
      .bind(id)
      .all<DbImportEntryRow>();
    return { batch: mapBatch(batch), entries: results };
  }

  async markReverted(id: number): Promise<void> {
    await this.db.prepare("UPDATE import_batches SET reverted_at = datetime('now') WHERE id = ?").bind(id).run();
  }
}

function mapBatch(row: DbImportBatchRow): ImportBatchSummary {
  return {
    id: row.id,
    mode: row.mode,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
    revertable: row.revertable === 1,
  };
}
