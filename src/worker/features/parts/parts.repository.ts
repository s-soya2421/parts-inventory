import type { PartAlternative, PartAttribute, PartAttributeValue, PartsAnalytics, PartSummary, StockMovement, Tag } from "@shared/types";
import { AppError } from "../../middleware/error-handler";
import type { DbPartAttributeRow, DbPartAttributeValueRow, DbPartRow, DbStockMovementRow, DbTagRow } from "../../types";
import { mapAttribute, mapMovement, mapPart, mapPartAttributeValue, mapTag, toSearchText } from "../../utils";
import type { PartWriteInput, StockChangeInput } from "./parts.schemas";

export type PartListFilters = {
  keyword?: string;
  categoryId?: number;
  categorySlug?: string;
  tagIds?: number[];
  caseNumber?: string;
  manufacturer?: string;
  footprint?: string;
  locationId?: number;
  statusId?: number;
  archived?: "active" | "archived" | "all";
  stockStatus?: "all" | "in_stock" | "out_of_stock" | "low_stock";
  sort?: string;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  attrs?: string;
};

type PartRecordInput = PartWriteInput & {
  searchText: string;
};

type D1BindValue = string | number | null;
type AttributeFilterOperator = "eq" | "contains" | "gte" | "gt" | "lte" | "lt";
type AttributeFilterValue = string | number | { op?: unknown; val?: unknown };

type StockMovementInput = {
  movementType: StockMovement["movementType"];
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason?: string | null;
  memo?: string | null;
};

const numericAttributeOperators = {
  gte: ">=",
  gt: ">",
  lte: "<=",
  lt: "<",
} satisfies Record<Exclude<AttributeFilterOperator, "eq" | "contains">, string>;

function parseAttributeFilters(raw: string): Record<string, AttributeFilterValue> | null {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, AttributeFilterValue>;
}

function normalizeAttributeFilter(raw: AttributeFilterValue): { op: AttributeFilterOperator; val: string } {
  if (raw && typeof raw === "object" && "op" in raw) {
    const op = typeof raw.op === "string" ? raw.op : "eq";
    const val = raw.val === undefined || raw.val === null ? "" : String(raw.val);
    if (op === "contains" || op === "gte" || op === "gt" || op === "lte" || op === "lt") return { op, val };
    return { op: "eq", val };
  }
  return { op: "eq", val: String(raw) };
}

export class PartsRepository {
  constructor(private readonly db: D1Database) {}

  private buildWhereClause(filters: PartListFilters): { where: string; params: D1BindValue[] } {
    const params: D1BindValue[] = [];
    const conditions = ["1 = 1"];

    if (filters.keyword) {
      conditions.push(
        `(p.search_text LIKE ? OR l.name LIKE ?
          OR EXISTS (SELECT 1 FROM part_attributes pa WHERE pa.part_id = p.id AND (pa.key LIKE ? OR pa.label LIKE ? OR pa.value LIKE ? OR pa.unit LIKE ?))
          OR EXISTS (SELECT 1 FROM part_attribute_values pav JOIN attribute_definitions ad ON ad.id = pav.attribute_definition_id WHERE pav.part_id = p.id AND (ad.key LIKE ? OR ad.label LIKE ? OR pav.value_text LIKE ? OR pav.display_value LIKE ?))
        )`,
      );
      const keyword = `%${filters.keyword.toLowerCase()}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
    }

    if (filters.categoryId) {
      conditions.push("p.category_id = ?");
      params.push(filters.categoryId);
    }
    if (filters.categorySlug) {
      conditions.push("c.slug = ?");
      params.push(filters.categorySlug);
    }
    if (filters.caseNumber) {
      conditions.push("p.case_number = ?");
      params.push(filters.caseNumber);
    }
    if (filters.manufacturer) {
      conditions.push("p.manufacturer = ?");
      params.push(filters.manufacturer);
    }
    if (filters.footprint) {
      conditions.push("p.footprint = ?");
      params.push(filters.footprint);
    }
    if (filters.locationId) {
      conditions.push("p.location_id = ?");
      params.push(filters.locationId);
    }
    if (filters.statusId) {
      conditions.push("p.status_id = ?");
      params.push(filters.statusId);
    }
    if (filters.archived === "archived") conditions.push("p.archived_at IS NOT NULL");
    else if (filters.archived !== "all") conditions.push("p.archived_at IS NULL");

    if (filters.stockStatus === "in_stock") conditions.push("p.stock_quantity > 0");
    if (filters.stockStatus === "out_of_stock") conditions.push("p.stock_quantity = 0");
    if (filters.stockStatus === "low_stock") {
      conditions.push("p.stock_quantity <= p.low_stock_threshold AND p.low_stock_threshold > 0");
    }

    for (const tagId of filters.tagIds ?? []) {
      conditions.push("EXISTS (SELECT 1 FROM part_tags pt WHERE pt.part_id = p.id AND pt.tag_id = ?)");
      params.push(tagId);
    }

    if (filters.attrs) {
      try {
        const attrs = parseAttributeFilters(filters.attrs);
        if (!attrs) return { where: conditions.join(" AND "), params };
        for (const [key, raw] of Object.entries(attrs)) {
          const { op, val } = normalizeAttributeFilter(raw);
          const numVal = Number(val);
          const isNumeric = val !== "" && !Number.isNaN(numVal);

          if (op === "contains") {
            conditions.push(
              `EXISTS (
                SELECT 1 FROM part_attribute_values pav
                JOIN attribute_definitions ad ON ad.id = pav.attribute_definition_id
                WHERE pav.part_id = p.id AND ad.key = ? AND pav.value_text LIKE ?
              )`,
            );
            params.push(key, `%${val}%`);
          } else if (isNumeric && op in numericAttributeOperators) {
            const sqlOp = numericAttributeOperators[op as keyof typeof numericAttributeOperators];
            conditions.push(
              `EXISTS (
                SELECT 1 FROM part_attribute_values pav
                JOIN attribute_definitions ad ON ad.id = pav.attribute_definition_id
                WHERE pav.part_id = p.id AND ad.key = ? AND pav.value_number ${sqlOp} ?
              )`,
            );
            params.push(key, numVal);
          } else {
            conditions.push(
              `EXISTS (
                SELECT 1 FROM part_attribute_values pav
                JOIN attribute_definitions ad ON ad.id = pav.attribute_definition_id
                WHERE pav.part_id = p.id AND ad.key = ? AND (pav.value_text = ? OR pav.value_number = ?)
              )`,
            );
            params.push(key, String(val), isNumeric ? numVal : Number.NaN);
          }
        }
      } catch {
        // Ignore invalid JSON
      }
    }

    return { where: conditions.join(" AND "), params };
  }

  // list() と listAll() で共通の ORDER BY 句を組み立てる。
  // filters.sort 指定時はその列、未指定時はデフォルトのステータスグルーピング順。
  private buildOrderBy(filters: PartListFilters): string {
    // 列ごとのSQL式（複数式の列は安定したソートのため順に適用）。direction は各式に付与する。
    const sortColumns: Record<string, string[]> = {
      modelNumber: ["p.model_number COLLATE NOCASE"],
      manufacturer: ["p.manufacturer COLLATE NOCASE"],
      categoryName: ["c.name COLLATE NOCASE"],
      status: ["(s.id IS NULL)", "s.sort_order", "s.name COLLATE NOCASE"],
      stockQuantity: ["p.stock_quantity"],
      location: ["l.name COLLATE NOCASE", "p.case_number COLLATE NOCASE"],
      price: ["p.price"],
      footprint: ["p.footprint COLLATE NOCASE"],
      lowStockThreshold: ["p.low_stock_threshold"],
      createdAt: ["p.created_at"],
      updatedAt: ["p.updated_at"],
      // 後方互換
      name: ["p.name COLLATE NOCASE"],
      category: ["c.name COLLATE NOCASE"],
    };
    const direction = filters.direction === "asc" ? "ASC" : "DESC";
    // Default list order groups by status display order, then sorts parts by name within each status.
    // Parts without a status are grouped at the end. Explicit sort still uses the selected column(s).
    return filters.sort
      ? `${(Object.hasOwn(sortColumns, filters.sort) ? sortColumns[filters.sort] : ["p.updated_at"]).map((c) => `${c} ${direction}`).join(", ")}, p.id DESC`
      : `(s.id IS NULL), s.sort_order ASC, s.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC, p.id DESC`;
  }

  async list(filters: PartListFilters): Promise<{ items: PartSummary[]; total: number }> {
    const { where, params } = this.buildWhereClause(filters);

    const countRow = await this.db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM parts p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN locations l ON l.id = p.location_id
         LEFT JOIN part_statuses s ON s.id = p.status_id
         WHERE ${where}`,
      )
      .bind(...params)
      .first<{ cnt: number }>();
    const total = countRow?.cnt ?? 0;

    const orderBy = this.buildOrderBy(filters);
    const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);

    const pageParams = [...params, pageSize, (page - 1) * pageSize];
    const { results } = await this.db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug, l.name AS location_name, l.code AS location_code,
                s.name AS status_name, s.slug AS status_slug, s.color AS status_color
         FROM parts p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN locations l ON l.id = p.location_id
         LEFT JOIN part_statuses s ON s.id = p.status_id
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .bind(...pageParams)
      .all<DbPartRow>();

    const items = await this.hydrateParts(results);
    return { items, total };
  }

  // フィルタに一致する全部品をページングなしで取得する（エクスポート用）。
  // list() と同じ WHERE・JOIN・ORDER BY を使うが LIMIT/OFFSET は付けない。
  async listAll(filters: PartListFilters): Promise<PartSummary[]> {
    const { where, params } = this.buildWhereClause(filters);
    const orderBy = this.buildOrderBy(filters);

    const { results } = await this.db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug, l.name AS location_name, l.code AS location_code,
                s.name AS status_name, s.slug AS status_slug, s.color AS status_color
         FROM parts p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN locations l ON l.id = p.location_id
         LEFT JOIN part_statuses s ON s.id = p.status_id
         WHERE ${where}
         ORDER BY ${orderBy}`,
      )
      .bind(...params)
      .all<DbPartRow>();

    return this.hydrateParts(results);
  }

  async findByModelNumberAndCategory(categoryId: number, modelNumber: string): Promise<{ id: number; stockQuantity: number } | null> {
    const row = await this.db
      .prepare("SELECT id, stock_quantity FROM parts WHERE category_id = ? AND model_number = ? LIMIT 1")
      .bind(categoryId, modelNumber)
      .first<{ id: number; stock_quantity: number }>();
    return row ? { id: row.id, stockQuantity: row.stock_quantity } : null;
  }

  async getStats(filters: PartListFilters): Promise<{ totalValue: number; totalStock: number; count: number; valuedCount: number }> {
    const { where, params } = this.buildWhereClause(filters);
    const row = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN p.price IS NOT NULL THEN p.price * p.stock_quantity ELSE 0 END), 0) AS total_value,
           COALESCE(SUM(p.stock_quantity), 0) AS total_stock,
           COUNT(*) AS cnt,
           COALESCE(SUM(CASE WHEN p.price IS NOT NULL THEN 1 ELSE 0 END), 0) AS valued_count
         FROM parts p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN locations l ON l.id = p.location_id
         LEFT JOIN part_statuses s ON s.id = p.status_id
         WHERE ${where}`,
      )
      .bind(...params)
      .first<{ total_value: number; total_stock: number; cnt: number; valued_count: number }>();
    return {
      totalValue: row?.total_value ?? 0,
      totalStock: row?.total_stock ?? 0,
      count: row?.cnt ?? 0,
      valuedCount: row?.valued_count ?? 0,
    };
  }

  async getAnalytics(filters: PartListFilters): Promise<PartsAnalytics> {
    const { where, params } = this.buildWhereClause(filters);
    const from = `FROM parts p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN locations l ON l.id = p.location_id
       LEFT JOIN part_statuses s ON s.id = p.status_id
       WHERE ${where}`;

    const [totalsRow, byCategory, byStatus, byManufacturer, byLocation, topValueParts, healthRow, monthly, yearly] = await Promise.all([
      this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN p.price IS NOT NULL THEN p.price * p.stock_quantity ELSE 0 END), 0) AS total_value,
             COALESCE(SUM(p.stock_quantity), 0) AS total_stock,
             COUNT(*) AS cnt,
             COALESCE(SUM(CASE WHEN p.price IS NOT NULL THEN 1 ELSE 0 END), 0) AS valued_count
           ${from}`,
        )
        .bind(...params)
        .first<{ total_value: number; total_stock: number; cnt: number; valued_count: number }>(),
      this.db
        .prepare(
          `SELECT c.name AS name, COUNT(*) AS cnt,
             COALESCE(SUM(p.stock_quantity), 0) AS stock,
             COALESCE(SUM(CASE WHEN p.price IS NOT NULL THEN p.price * p.stock_quantity ELSE 0 END), 0) AS value
           ${from}
           GROUP BY c.id, c.name
           ORDER BY cnt DESC`,
        )
        .bind(...params)
        .all<{ name: string; cnt: number; stock: number; value: number }>(),
      this.db
        .prepare(
          `SELECT s.id AS id,
             COALESCE(s.name, '(未設定)') AS name,
             COALESCE(s.color, '#94a3b8') AS color,
             COUNT(*) AS cnt,
             COALESCE(SUM(p.stock_quantity), 0) AS stock,
             COALESCE(SUM(CASE WHEN p.price IS NOT NULL THEN p.price * p.stock_quantity ELSE 0 END), 0) AS value
           ${from}
           GROUP BY s.id, s.name, s.color
           ORDER BY cnt DESC, name COLLATE NOCASE`,
        )
        .bind(...params)
        .all<{ id: number | null; name: string; color: string; cnt: number; stock: number; value: number }>(),
      this.db
        .prepare(
          // GROUP BY は実列を優先解決するため別名 name(p/c/l.name と衝突)は使わず式で集計する。
          `SELECT COALESCE(NULLIF(TRIM(p.manufacturer), ''), '(未設定)') AS name, COUNT(*) AS cnt
           ${from}
           GROUP BY COALESCE(NULLIF(TRIM(p.manufacturer), ''), '(未設定)')
           ORDER BY cnt DESC, name COLLATE NOCASE
           LIMIT 12`,
        )
        .bind(...params)
        .all<{ name: string; cnt: number }>(),
      this.db
        .prepare(
          `SELECT COALESCE(l.name, '(未設定)') AS name, COUNT(*) AS cnt
           ${from}
           GROUP BY l.name
           ORDER BY cnt DESC, name COLLATE NOCASE
           LIMIT 12`,
        )
        .bind(...params)
        .all<{ name: string; cnt: number }>(),
      this.db
        .prepare(
          `SELECT p.id AS id, p.model_number AS model_number, p.price AS price, p.stock_quantity AS stock,
             (p.price * p.stock_quantity) AS value
           ${from} AND p.price IS NOT NULL AND p.stock_quantity > 0
           ORDER BY value DESC, p.id DESC
           LIMIT 10`,
        )
        .bind(...params)
        .all<{ id: number; model_number: string; price: number; stock: number; value: number }>(),
      this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN p.stock_quantity = 0 THEN 1 ELSE 0 END), 0) AS out_cnt,
             COALESCE(SUM(CASE WHEN p.stock_quantity > 0 AND p.low_stock_threshold > 0 AND p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END), 0) AS low_cnt,
             COALESCE(SUM(CASE WHEN p.stock_quantity > 0 AND NOT (p.low_stock_threshold > 0 AND p.stock_quantity <= p.low_stock_threshold) THEN 1 ELSE 0 END), 0) AS healthy_cnt
           ${from}`,
        )
        .bind(...params)
        .first<{ out_cnt: number; low_cnt: number; healthy_cnt: number }>(),
      this.db
        .prepare(
          `SELECT strftime('%Y-%m', p.created_at) AS month, COUNT(*) AS cnt
           ${from}
           GROUP BY month
           ORDER BY month ASC`,
        )
        .bind(...params)
        .all<{ month: string; cnt: number }>(),
      this.db
        .prepare(
          `SELECT strftime('%Y', p.created_at) AS year, COUNT(*) AS cnt
           ${from}
           GROUP BY year
           ORDER BY year DESC
           LIMIT 12`,
        )
        .bind(...params)
        .all<{ year: string; cnt: number }>(),
    ]);

    return {
      totals: {
        totalValue: totalsRow?.total_value ?? 0,
        totalStock: totalsRow?.total_stock ?? 0,
        count: totalsRow?.cnt ?? 0,
        valuedCount: totalsRow?.valued_count ?? 0,
      },
      byCategory: byCategory.results.map((r) => ({ name: r.name, count: r.cnt, stock: r.stock, value: r.value })),
      byStatus: byStatus.results.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.cnt, stock: r.stock, value: r.value })),
      byManufacturer: byManufacturer.results.map((r) => ({ name: r.name, count: r.cnt })),
      byLocation: byLocation.results.map((r) => ({ name: r.name, count: r.cnt })),
      topValueParts: topValueParts.results.map((r) => ({ id: r.id, modelNumber: r.model_number, price: r.price, stock: r.stock, value: r.value })),
      stockHealth: { healthy: healthRow?.healthy_cnt ?? 0, low: healthRow?.low_cnt ?? 0, out: healthRow?.out_cnt ?? 0 },
      monthlyAdditions: monthly.results.map((r) => ({ month: r.month, count: r.cnt })),
      yearlyAdditions: yearly.results.map((r) => ({ year: r.year, count: r.cnt })).reverse(),
    };
  }

  async getById(id: number): Promise<PartSummary | null> {
    const row = await this.db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug, l.name AS location_name, l.code AS location_code,
                s.name AS status_name, s.slug AS status_slug, s.color AS status_color
         FROM parts p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN locations l ON l.id = p.location_id
         LEFT JOIN part_statuses s ON s.id = p.status_id
         WHERE p.id = ?`,
      )
      .bind(id)
      .first<DbPartRow>();
    return row ? this.hydratePart(row) : null;
  }


  async create(input: PartRecordInput, tagIds: number[]): Promise<number> {
    // A request token lets all child inserts reference the new row in one
    // atomic D1 batch without relying on last_insert_rowid() after child writes.
    const token = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        "INSERT INTO parts (category_id, model_number, name, description, manufacturer, footprint, " +
        "stock_quantity, price, location_id, case_number, purchase_url, datasheet_url, memo, " +
        "low_stock_threshold, search_text, status_id, creation_token) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      ).bind(input.categoryId, input.modelNumber, input.name, input.description ?? null,
        input.manufacturer ?? null, input.footprint ?? null, input.stockQuantity, input.price ?? null,
        input.locationId ?? null, input.caseNumber ?? null, input.purchaseUrl || null,
        input.datasheetUrl || null, input.memo ?? null, input.lowStockThreshold,
        input.searchText, input.statusId ?? null, token),
      ...input.attributes.map((a) => this.db.prepare(
        "INSERT INTO part_attributes (part_id, key, label, value, unit, normalized_value) " +
        "SELECT id, ?, ?, ?, ?, ? FROM parts WHERE creation_token = ?",
      ).bind(a.key, a.label ?? null, a.value, a.unit ?? null,
        a.normalizedValue ?? a.value.toLowerCase(), token)),
      ...input.attributes.map((a) => {
        const numeric = Number(a.value);
        return this.db.prepare(
          "INSERT INTO part_attribute_values (part_id, attribute_definition_id, value_text, value_number, unit, display_value) " +
          "SELECT p.id, ad.id, ?, ?, ?, ? FROM parts p " +
          "JOIN attribute_definitions ad ON ad.category_id = p.category_id AND ad.key = ? " +
          "WHERE p.creation_token = ?",
        ).bind(a.value, Number.isFinite(numeric) ? numeric : null,
          a.unit ?? null, a.value + (a.unit ?? ""), a.key, token);
      }),
      ...[...new Set(tagIds)].map((tagId) => this.db.prepare(
        "INSERT INTO part_tags (part_id, tag_id) SELECT id, ? FROM parts WHERE creation_token = ?",
      ).bind(tagId, token)),
      ...[...new Set(input.alternatives ?? [])].map((text, i) => this.db.prepare(
        "INSERT INTO part_alternatives (part_id, text, sort_order) " +
        "SELECT id, ?, ? FROM parts WHERE creation_token = ?",
      ).bind(text, i, token)),
      this.db.prepare(
        "INSERT INTO stock_movements (part_id, movement_type, quantity_before, quantity_delta, quantity_after, reason, memo) " +
        "SELECT id, 'initial', 0, ?, ?, 'initial', 'Initial stock' FROM parts WHERE creation_token = ?",
      ).bind(input.stockQuantity, input.stockQuantity, token),
    ];
    const output = await this.db.batch(statements);
    const id = Number((output[0]?.results?.[0] as { id?: number } | undefined)?.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new AppError("PART_CREATE_FAILED", "Failed to create part.", 500);
    }
    return id;
  }

  async ensureLocationByName(name: string): Promise<number> {
    const trimmed = name.trim();
    const existing = await this.db.prepare("SELECT id FROM locations WHERE name = ?").bind(trimmed).first<{ id: number }>();
    if (existing) return existing.id;
    const code = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `loc-${Date.now()}`;
    const row = await this.db
      .prepare("INSERT INTO locations (name, code) VALUES (?, ?) RETURNING id")
      .bind(trimmed, code)
      .first<{ id: number }>();
    if (!row) throw new AppError("LOCATION_CREATE_FAILED", "Failed to create location.", 500);
    return row.id;
  }


  async update(id: number, input: PartRecordInput, tagIds: number[], movement?: StockMovementInput): Promise<void> {
    const [result] = await this.db.batch([
      this.db.prepare(
        "UPDATE parts SET category_id = ?, model_number = ?, name = ?, description = ?, manufacturer = ?, " +
        "footprint = ?, stock_quantity = ?, price = ?, location_id = ?, case_number = ?, purchase_url = ?, " +
        "datasheet_url = ?, memo = ?, low_stock_threshold = ?, search_text = ?, status_id = ?, " +
        "updated_at = datetime('now') WHERE id = ?",
      ).bind(input.categoryId, input.modelNumber, input.name, input.description ?? null,
        input.manufacturer ?? null, input.footprint ?? null, input.stockQuantity, input.price ?? null,
        input.locationId ?? null, input.caseNumber ?? null, input.purchaseUrl || null,
        input.datasheetUrl || null, input.memo ?? null, input.lowStockThreshold, input.searchText,
        input.statusId ?? null, id),
      ...this.replaceAttributesStatements(id, input.attributes),
      ...this.replaceTagsStatements(id, tagIds),
      ...this.replaceAlternativesStatements(id, input.alternatives ?? []),
      ...(movement ? [this.movementStatement(id, movement)] : []),
    ]);
    if (result.meta.changes === 0) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);
  }

  async archive(id: number): Promise<void> {
    const result = await this.db
      .prepare("UPDATE parts SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND archived_at IS NULL")
      .bind(id)
      .run();
    if (result.meta.changes === 0) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);
  }


  async bulkArchive(ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 80) {
      const group = ids.slice(i, i + 80);
      const marks = group.map(() => "?").join(", ");
      await this.db.prepare(
        "UPDATE parts SET archived_at = datetime('now'), updated_at = datetime('now') " +
        "WHERE id IN (" + marks + ") AND archived_at IS NULL",
      ).bind(...group).run();
    }
  }

  async restore(id: number): Promise<void> {
    const result = await this.db
      .prepare("UPDATE parts SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
    if (result.meta.changes === 0) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);
  }

  async delete(id: number): Promise<void> {
    const linked = await this.db.prepare("SELECT project_id FROM project_parts WHERE part_id = ? LIMIT 1")
      .bind(id).first<{ project_id: number }>();
    if (linked) {
      throw new AppError("PART_IN_PROJECT", "Part is linked to a project; remove the link first.", 409);
    }
    const result = await this.db.prepare("DELETE FROM parts WHERE id = ?").bind(id).run();
    if (result.meta.changes === 0) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);
  }


  async bulkDelete(ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 80) {
      const group = ids.slice(i, i + 80);
      const marks = group.map(() => "?").join(", ");
      await this.db.prepare("DELETE FROM parts WHERE id IN (" + marks + ")").bind(...group).run();
    }
  }


  async bulkUpdate(ids: number[], data: Partial<DbPartRow>): Promise<void> {
    if (ids.length === 0) return;
    const allowed = new Set([
      "category_id","manufacturer","footprint","location_id",
      "case_number","low_stock_threshold","status_id","memo",
    ]);
    const values = Object.entries(data);
    if (!values.length) return;
    for (const [key] of values) {
      if (!allowed.has(key)) throw new AppError("INVALID_BULK_UPDATE_COLUMN", "Column not allowed: " + key, 400);
    }
    const idsJson = JSON.stringify([...new Set(ids)]);
    const selection = "SELECT CAST(value AS INTEGER) FROM json_each(?)";
    const binds = values.map(([, value]) => value as D1BindValue);
    const statements: D1PreparedStatement[] = [];
    if (data.category_id !== undefined) {
      statements.push(this.db.prepare(
        "DELETE FROM part_attribute_values WHERE part_id IN (" + selection + ")",
      ).bind(idsJson));
    }
    statements.push(this.db.prepare(
      "UPDATE parts SET " + values.map(([key]) => key + "=?").join(",") +
      ", updated_at=datetime('now') WHERE id IN (" + selection + ")",
    ).bind(...binds, idsJson));
    if (data.category_id !== undefined) {
      // Preserve ALL raw attributes; only remap typed values whose keys exist
      // in the destination category. Never leave foreign-category typed rows.
      statements.push(this.db.prepare(
        "INSERT OR IGNORE INTO part_attribute_values " +
        "(part_id,attribute_definition_id,value_text,value_number,unit,display_value) " +
        "SELECT pa.part_id,d.id,pa.value,CASE WHEN pa.value NOT GLOB '*[^0-9.eE+-]*' " +
        "AND pa.value GLOB '*[0-9]*' THEN CAST(pa.value AS REAL) ELSE NULL END, " +
        "pa.unit,pa.value || coalesce(pa.unit,'') FROM part_attributes pa " +
        "JOIN parts p ON p.id=pa.part_id JOIN attribute_definitions d " +
        "ON d.category_id=p.category_id AND d.key=pa.key " +
        "WHERE pa.part_id IN (" + selection + ")",
      ).bind(idsJson));
    }
    statements.push(this.db.prepare(
      "UPDATE parts SET search_text=lower(" +
      "coalesce(model_number,'') || ' ' || coalesce(name,'') || ' ' || " +
      "coalesce(description,'') || ' ' || coalesce(manufacturer,'') || ' ' || " +
      "coalesce(footprint,'') || ' ' || coalesce(case_number,'') || ' ' || " +
      "coalesce((SELECT l.name FROM locations l WHERE l.id=parts.location_id),'') || ' ' || " +
      "coalesce(memo,'') || ' ' || " +
      "coalesce((SELECT c.name FROM categories c WHERE c.id=parts.category_id),'') || ' ' || " +
      "coalesce((SELECT group_concat(t.name,' ') FROM part_tags pt " +
      "JOIN tags t ON t.id=pt.tag_id WHERE pt.part_id=parts.id),'') || ' ' || " +
      "coalesce((SELECT group_concat(pa.key || ' ' || coalesce(pa.label,'') || ' ' || " +
      "pa.value || ' ' || coalesce(pa.unit,''),' ') FROM part_attributes pa " +
      "WHERE pa.part_id=parts.id),'')" +
      ") WHERE id IN (" + selection + ")",
    ).bind(idsJson));
    // A single transaction also covers category/typed-value remapping.
    // SQL bind count stays constant even for hundreds of selected IDs.
    await this.db.batch(statements);
  }

  // A D1 batch executes both statements within one transaction. The movement
  // captures the current stock BEFORE an atomic SQL update, not a stale JS read.
  async changeStockAtomically(partId: number, input: StockChangeInput): Promise<void> {
    const isSet = input.type === "set" ? 1 : 0;
    const delta = input.type === "out" || input.type === "use" || input.type === "dispose"
      ? -Math.abs(input.quantity) : input.quantity;
    try {
      const [, updated] = await this.db.batch([
        this.db.prepare(
          "INSERT INTO stock_movements (part_id, movement_type, quantity_before, quantity_delta, quantity_after, reason, memo) " +
          "SELECT id, ?, stock_quantity, CASE WHEN ? = 1 THEN ? - stock_quantity ELSE ? END, " +
          "CASE WHEN ? = 1 THEN ? ELSE stock_quantity + ? END, ?, ? FROM parts WHERE id = ?",
        ).bind(input.type, isSet, input.quantity, delta, isSet, input.quantity, delta,
          input.reason ?? null, input.memo ?? null, partId),
        this.db.prepare(
          "UPDATE parts SET stock_quantity = CASE WHEN ? = 1 THEN ? ELSE stock_quantity + ? END, " +
          "updated_at = datetime('now') WHERE id = ?",
        ).bind(isSet, input.quantity, delta, partId),
      ]);
      if (updated.meta.changes === 0) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);
    } catch (error) {
      if (/CHECK constraint failed|constraint failed.*stock_quantity/i.test(String(error))) {
        throw new AppError("NEGATIVE_STOCK", "Stock quantity cannot be negative.", 400);
      }
      throw error;
    }
  }

  async listMovements(partId: number): Promise<StockMovement[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM stock_movements WHERE part_id = ? ORDER BY created_at DESC, id DESC")
      .bind(partId)
      .all<DbStockMovementRow>();
    return results.map(mapMovement);
  }

  async listDistinctAttributeValues(key: string): Promise<{ value: string; unit: string | null; count: number }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT value, unit, COUNT(*) AS cnt
         FROM part_attributes
         WHERE key = ?
         GROUP BY value, unit
         ORDER BY cnt DESC, value COLLATE NOCASE`,
      )
      .bind(key)
      .all<{ value: string; unit: string | null; cnt: number }>();
    return results.map((row) => ({ value: row.value, unit: row.unit, count: row.cnt }));
  }

  async listPartIdsByTag(tagId: number): Promise<number[]> {
    const { results } = await this.db
      .prepare("SELECT part_id AS id FROM part_tags WHERE tag_id = ?")
      .bind(tagId)
      .all<{ id: number }>();
    return results.map((row) => row.id);
  }

  async rebuildSearchTextForCategory(categoryId: number): Promise<void> {
    const { results } = await this.db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug, l.name AS location_name, l.code AS location_code,
                s.name AS status_name, s.slug AS status_slug, s.color AS status_color
         FROM parts p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN locations l ON l.id = p.location_id
         LEFT JOIN part_statuses s ON s.id = p.status_id
         WHERE p.category_id = ?`,
      )
      .bind(categoryId)
      .all<DbPartRow>();
    await this.rebuildSearchTextForRows(results);
  }


  async rebuildSearchTextForParts(partIds: number[]): Promise<void> {
    const ids = [...new Set(partIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
    for (let start = 0; start < ids.length; start += 80) {
      const chunk = ids.slice(start, start + 80);
      const marks = chunk.map(() => "?").join(", ");
      const { results } = await this.db.prepare(
        "SELECT p.*, c.name AS category_name, c.slug AS category_slug, l.name AS location_name, l.code AS location_code, " +
        "s.name AS status_name, s.slug AS status_slug, s.color AS status_color " +
        "FROM parts p JOIN categories c ON c.id = p.category_id " +
        "LEFT JOIN locations l ON l.id = p.location_id LEFT JOIN part_statuses s ON s.id = p.status_id " +
        "WHERE p.id IN (" + marks + ")",
      ).bind(...chunk).all<DbPartRow>();
      await this.rebuildSearchTextForRows(results);
    }
  }

  private async hydrateParts(rows: DbPartRow[]): Promise<PartSummary[]> {
    const parts: PartSummary[] = [];
    for (let offset = 0; offset < rows.length; offset += 80) {
      const group = rows.slice(offset, offset + 80);
      const ids = group.map((r) => r.id);
      const marks = ids.map(() => "?").join(", ");
      const [attributesResult, tagsResult, valuesResult] = await Promise.all([
        this.db.prepare("SELECT * FROM part_attributes WHERE part_id IN (" + marks + ") ORDER BY id")
          .bind(...ids).all<DbPartAttributeRow>(),
        this.db.prepare("SELECT pt.part_id AS bound_part_id, t.* FROM tags t JOIN part_tags pt ON pt.tag_id = t.id WHERE pt.part_id IN (" + marks + ") ORDER BY t.name COLLATE NOCASE")
          .bind(...ids).all<DbTagRow & { bound_part_id: number }>(),
        this.db.prepare("SELECT pav.*, ad.key, ad.label FROM part_attribute_values pav JOIN attribute_definitions ad ON ad.id = pav.attribute_definition_id WHERE pav.part_id IN (" + marks + ") ORDER BY ad.sort_order")
          .bind(...ids).all<DbPartAttributeValueRow>(),
      ]);
      const attributes = new Map<number, PartAttribute[]>();
      const tags = new Map<number, Tag[]>();
      const values = new Map<number, PartAttributeValue[]>();
      for (const row of attributesResult.results) {
        const group = attributes.get(row.part_id) ?? [];
        group.push(mapAttribute(row));
        attributes.set(row.part_id, group);
      }
      for (const row of tagsResult.results) {
        const group = tags.get(row.bound_part_id) ?? [];
        group.push(mapTag(row));
        tags.set(row.bound_part_id, group);
      }
      for (const row of valuesResult.results) {
        const group = values.get(row.part_id) ?? [];
        group.push(mapPartAttributeValue(row));
        values.set(row.part_id, group);
      }
      for (const row of group) {
        parts.push(mapPart(row, attributes.get(row.id) ?? [], tags.get(row.id) ?? [], values.get(row.id) ?? []));
      }
    }
    return parts;
  }

  private async hydratePart(row: DbPartRow): Promise<PartSummary> {
    const [attributes, tags, attributeValues] = await Promise.all([
      this.listAttributes(row.id),
      this.listTags(row.id),
      this.listAttributeValues(row.id),
    ]);
    return mapPart(row, attributes, tags, attributeValues);
  }

  private async listAttributes(partId: number): Promise<PartAttribute[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM part_attributes WHERE part_id = ? ORDER BY id")
      .bind(partId)
      .all<DbPartAttributeRow>();
    return results.map(mapAttribute);
  }

  private async listTags(partId: number): Promise<Tag[]> {
    const { results } = await this.db
      .prepare(
        `SELECT t.*
         FROM tags t
         JOIN part_tags pt ON pt.tag_id = t.id
         WHERE pt.part_id = ?
         ORDER BY t.name COLLATE NOCASE`,
      )
      .bind(partId)
      .all<DbTagRow>();
    return results.map(mapTag);
  }

  // 代替候補を取得し、各テキストが既存部品（型番か部品名一致）に合致すればリンク先IDを付与する。
  async listAlternatives(partId: number): Promise<PartAlternative[]> {
    const { results } = await this.db
      .prepare("SELECT id, text FROM part_alternatives WHERE part_id = ? ORDER BY sort_order, id")
      .bind(partId)
      .all<{ id: number; text: string }>();
    return Promise.all(
      results.map(async ({ text }) => {
        const matched = await this.db
          .prepare("SELECT id FROM parts WHERE archived_at IS NULL AND id != ? AND (model_number = ? OR name = ?) LIMIT 1")
          .bind(partId, text, text)
          .first<{ id: number }>();
        return { text, linkedPartId: matched?.id ?? null };
      }),
    );
  }

  private async listAttributeValues(partId: number): Promise<PartAttributeValue[]> {
    const { results } = await this.db
      .prepare(
        `SELECT pav.*, ad.key, ad.label
         FROM part_attribute_values pav
         JOIN attribute_definitions ad ON ad.id = pav.attribute_definition_id
         WHERE pav.part_id = ?
         ORDER BY ad.sort_order`,
      )
      .bind(partId)
      .all<DbPartAttributeValueRow>();
    return results.map(mapPartAttributeValue);
  }

  private replaceAttributesStatements(partId: number, attributes: PartAttribute[]): D1PreparedStatement[] {
    return [
      this.db.prepare("DELETE FROM part_attributes WHERE part_id = ?").bind(partId),
      this.db.prepare("DELETE FROM part_attribute_values WHERE part_id = ?").bind(partId),
      ...attributes.map((attribute) =>
        this.db
          .prepare(
            `INSERT INTO part_attributes (part_id, key, label, value, unit, normalized_value)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            partId,
            attribute.key,
            attribute.label ?? null,
            attribute.value,
            attribute.unit ?? null,
            attribute.normalizedValue ?? attribute.value.toLowerCase(),
          ),
      ),
      ...attributes.map((attribute) => {
        const numVal = Number(attribute.value);
        const valueNumber = Number.isFinite(numVal) ? numVal : null;
        const displayValue = attribute.value + (attribute.unit ?? "");
        return this.db
          .prepare(
            `INSERT INTO part_attribute_values (part_id, attribute_definition_id, value_text, value_number, unit, display_value)
             SELECT ?, ad.id, ?, ?, ?, ?
             FROM attribute_definitions ad
             JOIN parts p ON p.id = ? AND p.category_id = ad.category_id
             WHERE ad.key = ?`,
          )
          .bind(
            partId,
            attribute.value,
            valueNumber,
            attribute.unit ?? null,
            displayValue,
            partId,
            attribute.key,
          );
      }),
    ];
  }

  private replaceTagsStatements(partId: number, tagIds: number[]): D1PreparedStatement[] {
    return [
      this.db.prepare("DELETE FROM part_tags WHERE part_id = ?").bind(partId),
      ...[...new Set(tagIds)].map((tagId) =>
        this.db.prepare("INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)").bind(partId, tagId),
      ),
    ];
  }

  private replaceAlternativesStatements(partId: number, alternatives: string[]): D1PreparedStatement[] {
    return [
      this.db.prepare("DELETE FROM part_alternatives WHERE part_id = ?").bind(partId),
      ...[...new Set(alternatives)].map((text, index) =>
        this.db
          .prepare("INSERT INTO part_alternatives (part_id, text, sort_order) VALUES (?, ?, ?)")
          .bind(partId, text, index),
      ),
    ];
  }

  private movementStatement(partId: number, movement: StockMovementInput): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO stock_movements (part_id, movement_type, quantity_before, quantity_delta, quantity_after, reason, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        partId,
        movement.movementType,
        movement.quantityBefore,
        movement.quantityDelta,
        movement.quantityAfter,
        movement.reason ?? null,
        movement.memo ?? null,
      );
  }

  private async rebuildSearchTextForRows(rows: DbPartRow[]): Promise<void> {
    const statements: D1PreparedStatement[] = [];

    for (const part of await this.hydrateParts(rows)) {
      const searchText = toSearchText({
        modelNumber: part.modelNumber,
        name: part.name,
        description: part.description,
        manufacturer: part.manufacturer,
        footprint: part.footprint,
        caseNumber: part.caseNumber,
        locationName: part.locationName,
        memo: part.memo,
        categoryName: part.categoryName,
        tagNames: part.tags.map((tag) => tag.name),
        attributes: part.attributes,
      });
      statements.push(
        this.db.prepare("UPDATE parts SET search_text = ?, updated_at = datetime('now') WHERE id = ?").bind(searchText, part.id),
      );
    }

    if (statements.length > 0) await this.db.batch(statements);
  }
}
