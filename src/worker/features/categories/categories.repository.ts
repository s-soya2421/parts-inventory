import type { AttributeDefinition, Category, CategoryListHeader } from "@shared/types";
import { AppError } from "../../middleware/error-handler";
import type { DbAttributeDefinitionRow, DbCategoryListHeaderRow, DbCategoryRow } from "../../types";
import { mapAttributeDefinition, mapCategory, mapCategoryListHeader, slugify } from "../../utils";
import type { AttributeDefinitionInput, CategoryListHeaderInput, CategoryWriteInput } from "./categories.schemas";

export class CategoriesRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<Category[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.*,
          COUNT(p.id) AS part_count,
          SUM(CASE WHEN p.stock_quantity = 0 AND p.archived_at IS NULL THEN 1 ELSE 0 END) AS out_of_stock_count,
          SUM(CASE WHEN p.stock_quantity <= p.low_stock_threshold AND p.low_stock_threshold > 0 AND p.archived_at IS NULL THEN 1 ELSE 0 END) AS low_stock_count
         FROM categories c
         LEFT JOIN parts p ON p.category_id = c.id AND p.archived_at IS NULL
         GROUP BY c.id
         ORDER BY c.sort_order, c.name COLLATE NOCASE`,
      )
      .all<DbCategoryRow>();
    return results.map(mapCategory);
  }

  async findById(id: number): Promise<Category | null> {
    const row = await this.db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first<DbCategoryRow>();
    return row ? mapCategory(row) : null;
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const row = await this.db.prepare("SELECT * FROM categories WHERE slug = ?").bind(slug).first<DbCategoryRow>();
    return row ? mapCategory(row) : null;
  }

  async create(input: CategoryWriteInput): Promise<Category> {
    const slug = input.slug ?? slugify(input.name);
    const row = await this.db
      .prepare("INSERT INTO categories (name, slug) VALUES (?, ?) RETURNING *")
      .bind(input.name, slug)
      .first<DbCategoryRow>();
    if (!row) throw new AppError("CATEGORY_CREATE_FAILED", "Failed to create category.", 500);
    return mapCategory(row);
  }

  async update(id: number, input: CategoryWriteInput): Promise<Category> {
    const slug = input.slug ?? slugify(input.name);
    const row = await this.db
      .prepare("UPDATE categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ? RETURNING *")
      .bind(input.name, slug, id)
      .first<DbCategoryRow>();
    if (!row) throw new AppError("CATEGORY_NOT_FOUND", "Category not found.", 404);
    return mapCategory(row);
  }

  async delete(id: number, options?: { force?: boolean }): Promise<void> {
    const usage = await this.db
      .prepare(
        `SELECT
          SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active_cnt,
          SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived_cnt
         FROM parts WHERE category_id = ?`,
      )
      .bind(id)
      .first<{ active_cnt: number | null; archived_cnt: number | null }>();
    if ((usage?.active_cnt ?? 0) > 0) {
      throw new AppError(
        "CATEGORY_IN_USE",
        "このカテゴリには部品が登録されているため削除できません。",
        409,
      );
    }
    if ((usage?.archived_cnt ?? 0) > 0) {
      if (options?.force) {
        await this.db.batch([
          this.db.prepare("DELETE FROM parts WHERE category_id = ? AND archived_at IS NOT NULL").bind(id),
          this.db.prepare("DELETE FROM categories WHERE id = ?").bind(id),
        ]);
        return;
      }

      const archived = await this.db
        .prepare("SELECT id, name, model_number FROM parts WHERE category_id = ? AND archived_at IS NOT NULL ORDER BY id")
        .bind(id)
        .all<{ id: number; name: string; model_number: string }>();
      throw new AppError(
        "CATEGORY_HAS_ARCHIVED_PARTS",
        "このカテゴリにはアーカイブ(削除)済みの部品が残っています。削除するとこれらも完全に削除されます。",
        409,
        { archivedParts: archived.results.map((r) => ({ id: r.id, name: r.name, modelNumber: r.model_number })) },
      );
    }

    const result = await this.db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
    if (result.meta.changes === 0) throw new AppError("CATEGORY_NOT_FOUND", "Category not found.", 404);
  }

  async listAttributeDefinitions(categoryId: number): Promise<AttributeDefinition[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM attribute_definitions WHERE category_id = ? ORDER BY sort_order, label")
      .bind(categoryId)
      .all<DbAttributeDefinitionRow>();
    return results.map(mapAttributeDefinition);
  }

  async updateAttributeDefinitions(categoryId: number, inputs: AttributeDefinitionInput[]): Promise<void> {
    const statements: D1PreparedStatement[] = [];

    // Delete attribute definitions that are not in the input list
    const incomingIds = inputs.map((i) => i.id).filter((id): id is number => typeof id === "number");
    if (incomingIds.length > 0) {
      statements.push(
        this.db
          .prepare(
            `DELETE FROM attribute_definitions
             WHERE category_id = ? AND id NOT IN (${incomingIds.map(() => "?").join(",")})`,
          )
          .bind(categoryId, ...incomingIds),
      );
    } else {
      statements.push(this.db.prepare("DELETE FROM attribute_definitions WHERE category_id = ?").bind(categoryId));
    }

    for (const input of inputs) {
      if (input.id) {
        statements.push(
          this.db
            .prepare(
              `UPDATE attribute_definitions
               SET key = ?, label = ?, data_type = ?, unit = ?, group_name = ?, is_searchable = ?, sort_order = ?, updated_at = datetime('now')
               WHERE id = ? AND category_id = ?`,
            )
            .bind(
              input.key,
              input.label,
              input.dataType,
              input.unit ?? null,
              input.groupName ?? null,
              input.isSearchable ? 1 : 0,
              input.sortOrder,
              input.id,
              categoryId,
            ),
        );
      } else {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO attribute_definitions (
                category_id, key, label, data_type, unit, group_name, is_searchable, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              categoryId,
              input.key,
              input.label,
              input.dataType,
              input.unit ?? null,
              input.groupName ?? null,
              input.isSearchable ? 1 : 0,
              input.sortOrder,
            ),
        );
      }
    }

    await this.db.batch(statements);
  }

  async listHeaders(categoryId: number): Promise<CategoryListHeader[]> {
    const { results } = await this.db
      .prepare(
        `SELECT h.*,
                ad.key AS definition_key,
                ad.label AS definition_label,
                ad.data_type AS definition_data_type,
                ad.unit AS definition_unit,
                ad.group_name AS definition_group_name,
                ad.is_searchable AS definition_is_searchable,
                ad.sort_order AS definition_sort_order,
                ad.created_at AS definition_created_at,
                ad.updated_at AS definition_updated_at
         FROM category_list_headers h
         LEFT JOIN attribute_definitions ad ON ad.id = h.attribute_definition_id
         WHERE h.category_id = ?
         ORDER BY h.sort_order`,
      )
      .bind(categoryId)
      .all<DbCategoryListHeaderRow>();
    return results.map(mapCategoryListHeader);
  }

  async updateHeaders(categoryId: number, inputs: CategoryListHeaderInput[]): Promise<void> {
    const statements: D1PreparedStatement[] = [];

    // Delete headers that are not in the input list
    const incomingIds = inputs.map((i) => i.id).filter((id): id is number => typeof id === "number");
    if (incomingIds.length > 0) {
      statements.push(
        this.db
          .prepare(
            `DELETE FROM category_list_headers
             WHERE category_id = ? AND id NOT IN (${incomingIds.map(() => "?").join(",")})`,
          )
          .bind(categoryId, ...incomingIds),
      );
    } else {
      statements.push(this.db.prepare("DELETE FROM category_list_headers WHERE category_id = ?").bind(categoryId));
    }

    for (const input of inputs) {
      if (input.id) {
        statements.push(
          this.db
            .prepare(
              `UPDATE category_list_headers
               SET attribute_definition_id = ?, field_key = ?, label = ?, sort_order = ?, is_visible = ?, updated_at = datetime('now')
               WHERE id = ? AND category_id = ?`,
            )
            .bind(
              input.attributeDefinitionId ?? null,
              input.fieldKey ?? null,
              input.label,
              input.sortOrder,
              input.isVisible ? 1 : 0,
              input.id,
              categoryId,
            ),
        );
      } else {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO category_list_headers (
                category_id, attribute_definition_id, field_key, label, sort_order, is_visible
              ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              categoryId,
              input.attributeDefinitionId ?? null,
              input.fieldKey ?? null,
              input.label,
              input.sortOrder,
              input.isVisible ? 1 : 0,
            ),
        );
      }
    }

    await this.db.batch(statements);
  }
}
