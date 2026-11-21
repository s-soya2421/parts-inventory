import { AppError } from "../../middleware/error-handler";
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


  /** One D1 transaction for the entire import reversal, regardless of size. */
  async revertAtomically(id: number): Promise<void> {
    const db = this.db;
    const updates = "SELECT part_id FROM import_batch_entries WHERE batch_id=? AND action='update'";
    const created = "SELECT part_id FROM import_batch_entries WHERE batch_id=? AND action='create'";
    const fields = [
      ["category_id", "categoryId"], ["model_number", "modelNumber"],
      ["name", "name"], ["description", "description"],
      ["manufacturer", "manufacturer"], ["footprint", "footprint"],
      ["stock_quantity", "stockQuantity"], ["price", "price"],
      ["location_id", "locationId"], ["case_number", "caseNumber"],
      ["purchase_url", "purchaseUrl"], ["datasheet_url", "datasheetUrl"],
      ["memo", "memo"], ["low_stock_threshold", "lowStockThreshold"],
      ["status_id", "statusId"],
    ] as const;
    const mismatch = fields.map(([column, key]) =>
      "p." + column + " IS NOT json_extract(e.after_json, '$." + key + "')").join(" OR ");
    const checks = [
      "INSERT INTO import_revert_guards (batch_id, valid) VALUES (?, CASE WHEN",
      "EXISTS (SELECT 1 FROM import_batches b WHERE b.id=? AND b.reverted_at IS NULL",
      "AND datetime(b.created_at, '+" + this.retentionDays + " days') > datetime('now'))",
      "AND EXISTS (SELECT 1 FROM import_batch_entries WHERE batch_id=?)",
      "AND NOT EXISTS (SELECT 1 FROM import_batch_entries e LEFT JOIN parts p ON p.id=e.part_id",
      "WHERE e.batch_id=? AND (e.after_json IS NULL OR p.id IS NULL OR p.archived_at IS NOT NULL",
      "OR (" + mismatch + ")",
      "OR (SELECT COUNT(*) FROM part_attributes pa WHERE pa.part_id=e.part_id) != json_array_length(e.after_json,'$.attributes')",
      "OR EXISTS (SELECT 1 FROM part_attributes pa WHERE pa.part_id=e.part_id",
      "AND NOT EXISTS (SELECT 1 FROM json_each(e.after_json,'$.attributes') j",
      "WHERE pa.key IS json_extract(j.value,'$.key') AND pa.label IS json_extract(j.value,'$.label')",
      "AND pa.value IS json_extract(j.value,'$.value') AND pa.unit IS json_extract(j.value,'$.unit')",
      "AND pa.normalized_value IS json_extract(j.value,'$.normalizedValue')))",
      "OR (SELECT COUNT(*) FROM part_tags t WHERE t.part_id=e.part_id) != json_array_length(e.after_json,'$.tagNames')",
      "OR EXISTS (SELECT 1 FROM part_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.part_id=e.part_id",
      "AND NOT EXISTS (SELECT 1 FROM json_each(e.after_json,'$.tagNames') j WHERE j.value=t.name))",
      "OR (SELECT COUNT(*) FROM part_alternatives a WHERE a.part_id=e.part_id) != json_array_length(e.after_json,'$.alternatives')",
      "OR EXISTS (SELECT 1 FROM part_alternatives a WHERE a.part_id=e.part_id AND NOT EXISTS",
      "(SELECT 1 FROM json_each(e.after_json,'$.alternatives') j",
      "WHERE CAST(j.key AS INTEGER)=a.sort_order AND j.value=a.text))",
      "OR (e.action='create' AND EXISTS (SELECT 1 FROM project_parts pp WHERE pp.part_id=e.part_id))))",
      "AND NOT EXISTS (SELECT 1 FROM import_batch_entries e, json_each(e.before_json,'$.tagNames') j",
      "LEFT JOIN tags t ON t.name=j.value WHERE e.batch_id=? AND e.action='update' AND t.id IS NULL)",
      "THEN 1 ELSE 0 END)",
    ].join(" ");
    const searchParts = [
      "modelNumber", "name", "description", "manufacturer", "footprint",
      "caseNumber", "locationName", "memo",
    ].map(k => "coalesce(json_extract(e.before_json,'$." + k + "'),'')");
    searchParts.push("coalesce((SELECT name FROM categories WHERE id=json_extract(e.before_json,'$.categoryId')),'')");
    searchParts.push("coalesce((SELECT group_concat(value,' ') FROM json_each(e.before_json,'$.tagNames')),'')");
    searchParts.push("coalesce((SELECT group_concat(" +
      "coalesce(json_extract(value,'$.key'),'') || ' ' || " +
      "coalesce(json_extract(value,'$.value'),'') || ' ' || " +
      "coalesce(json_extract(value,'$.label'),'') || ' ' || " +
      "coalesce(json_extract(value,'$.unit'),''),' ') FROM json_each(e.before_json,'$.attributes')),'')");
    const search = "lower(" + searchParts.join(" || ' ' || ") + ")";
    const col = fields.map(([name]) => name);
    const value = fields.map(([, key]) => "json_extract(e.before_json,'$." + key + "')");
    const batch: D1PreparedStatement[] = [
      db.prepare(checks).bind(id, id, id, id, id),
      db.prepare(
        "INSERT INTO stock_movements (part_id,movement_type,quantity_before,quantity_delta,quantity_after,reason,memo) " +
        "SELECT p.id,'set',p.stock_quantity,json_extract(e.before_json,'$.stockQuantity')-p.stock_quantity," +
        "json_extract(e.before_json,'$.stockQuantity'),'import_revert','Atomic import revert' " +
        "FROM parts p JOIN import_batch_entries e ON e.part_id=p.id " +
        "WHERE e.batch_id=? AND e.action='update' AND p.stock_quantity!=json_extract(e.before_json,'$.stockQuantity')",
      ).bind(id),
      db.prepare("DELETE FROM part_attribute_values WHERE part_id IN (" + updates + ")").bind(id),
      db.prepare("DELETE FROM part_attributes WHERE part_id IN (" + updates + ")").bind(id),
      db.prepare("DELETE FROM part_tags WHERE part_id IN (" + updates + ")").bind(id),
      db.prepare("DELETE FROM part_alternatives WHERE part_id IN (" + updates + ")").bind(id),
      db.prepare(
        "UPDATE parts SET (" + [...col, "search_text", "updated_at"].join(",") + ") = " +
        "(SELECT " + [...value, search, "datetime('now')"].join(",") +
        " FROM import_batch_entries e WHERE e.batch_id=? AND e.part_id=parts.id AND e.action='update') " +
        "WHERE id IN (" + updates + ")",
      ).bind(id, id),
      db.prepare(
        "INSERT INTO part_attributes (part_id,key,label,value,unit,normalized_value) " +
        "SELECT e.part_id,json_extract(j.value,'$.key'),json_extract(j.value,'$.label')," +
        "json_extract(j.value,'$.value'),json_extract(j.value,'$.unit')," +
        "coalesce(json_extract(j.value,'$.normalizedValue'),lower(json_extract(j.value,'$.value'))) " +
        "FROM import_batch_entries e,json_each(e.before_json,'$.attributes') j " +
        "WHERE e.batch_id=? AND e.action='update'",
      ).bind(id),
      db.prepare(
        "INSERT INTO part_attribute_values (part_id,attribute_definition_id,value_text,value_number,unit,display_value) " +
        "SELECT pa.part_id,ad.id,pa.value,CASE WHEN pa.value NOT GLOB '*[^0-9.eE+-]*' " +
        "AND pa.value GLOB '*[0-9]*' THEN CAST(pa.value AS REAL) ELSE NULL END," +
        "pa.unit,pa.value || coalesce(pa.unit,'') FROM part_attributes pa " +
        "JOIN parts p ON p.id=pa.part_id JOIN attribute_definitions ad ON ad.category_id=p.category_id AND ad.key=pa.key " +
        "WHERE pa.part_id IN (" + updates + ")",
      ).bind(id),
      db.prepare(
        "INSERT INTO part_tags (part_id,tag_id) SELECT e.part_id,t.id FROM import_batch_entries e," +
        "json_each(e.before_json,'$.tagNames') j JOIN tags t ON t.name=j.value " +
        "WHERE e.batch_id=? AND e.action='update'",
      ).bind(id),
      db.prepare(
        "INSERT INTO part_alternatives (part_id,text,sort_order) SELECT e.part_id,j.value,CAST(j.key AS INTEGER) " +
        "FROM import_batch_entries e,json_each(e.before_json,'$.alternatives') j " +
        "WHERE e.batch_id=? AND e.action='update'",
      ).bind(id),
      db.prepare("DELETE FROM parts WHERE id IN (" + created + ")").bind(id),
      db.prepare("UPDATE import_batches SET reverted_at=datetime('now') WHERE id=? AND reverted_at IS NULL").bind(id),
      db.prepare("DELETE FROM import_revert_guards WHERE batch_id=?").bind(id),
    ];
    try {
      await db.batch(batch);
    } catch (error) {
      if (/revert_guard_valid|import_revert_guards|CHECK constraint failed.*valid/i.test(String(error))) {
        throw new AppError("IMPORT_REVERT_CONFLICT", "A part changed since import; no data was reverted.", 409);
      }
      throw error;
    }
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
