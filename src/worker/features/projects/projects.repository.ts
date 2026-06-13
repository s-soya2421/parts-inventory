import type {
  ProjectSummary,
  ProjectPartLine,
  ProjectCost,
} from "@shared/types";
import { AppError } from "../../middleware/error-handler";
import type {
  DbProjectRow,
  DbProjectPartRow,
  DbProjectCostRow,
} from "../../types";
import {
  mapProjectSummary,
  mapProjectPartLine,
  mapProjectCost,
} from "../../utils";

export interface ProjectFieldsPersist {
  name: string;
  description: string | null;
  imageUrl: string | null;
  referenceUrl: string | null;
}

export interface ProjectPartPersist {
  partId: number;
  quantityRequired: number;
  memo: string | null;
}

export interface ProjectCostPersist {
  name: string;
  amount: number;
  memo: string | null;
  sortOrder: number;
}

export class ProjectsRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<ProjectSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT
          p.*,
          (SELECT COUNT(*) FROM project_parts pp WHERE pp.project_id = p.id) AS parts_count,
          (SELECT COUNT(*) FROM project_costs pc WHERE pc.project_id = p.id) AS costs_count,
          COALESCE((SELECT SUM(pp.quantity_required * COALESCE(pt.price, 0))
                    FROM project_parts pp JOIN parts pt ON pt.id = pp.part_id
                    WHERE pp.project_id = p.id), 0) AS parts_cost,
          COALESCE((SELECT SUM(pc.amount) FROM project_costs pc WHERE pc.project_id = p.id), 0) AS costs_total,
          (SELECT COUNT(*) FROM project_parts pp JOIN parts pt ON pt.id = pp.part_id
           WHERE pp.project_id = p.id AND pt.price IS NULL) AS unpriced_count
        FROM projects p
        ORDER BY p.updated_at DESC, p.id DESC`,
      )
      .all<DbProjectRow>();
    return results.map(mapProjectSummary);
  }

  async findRowById(id: number): Promise<DbProjectRow | null> {
    const row = await this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .bind(id)
      .first<DbProjectRow>();
    return row ?? null;
  }

  async listParts(projectId: number): Promise<ProjectPartLine[]> {
    const { results } = await this.db
      .prepare(
        `SELECT pp.id, pp.project_id, pp.part_id, pp.quantity_required, pp.memo,
                pt.model_number AS model_number, pt.name AS part_name, pt.price AS price,
                c.name AS category_name
         FROM project_parts pp
         JOIN parts pt ON pt.id = pp.part_id
         LEFT JOIN categories c ON c.id = pt.category_id
         WHERE pp.project_id = ?
         ORDER BY pp.id ASC`,
      )
      .bind(projectId)
      .all<DbProjectPartRow>();
    return results.map(mapProjectPartLine);
  }

  async listCosts(projectId: number): Promise<ProjectCost[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, project_id, name, amount, memo, sort_order
         FROM project_costs WHERE project_id = ? ORDER BY sort_order ASC, id ASC`,
      )
      .bind(projectId)
      .all<DbProjectCostRow>();
    return results.map(mapProjectCost);
  }

  async findExistingPartIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set<number>();
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await this.db
      .prepare(`SELECT id FROM parts WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: number }>();
    return new Set(results.map((row) => row.id));
  }

  async create(
    fields: ProjectFieldsPersist,
    parts: ProjectPartPersist[],
    costs: ProjectCostPersist[],
  ): Promise<number> {
    const row = await this.db
      .prepare(
        "INSERT INTO projects (name, description, image_url, reference_url) VALUES (?,?,?,?) RETURNING id",
      )
      .bind(
        fields.name,
        fields.description,
        fields.imageUrl,
        fields.referenceUrl,
      )
      .first<{ id: number }>();

    if (!row)
      throw new AppError(
        "PROJECT_CREATE_FAILED",
        "Failed to create project.",
        500,
      );

    const statements: D1PreparedStatement[] = [
      ...parts.map((part) =>
        this.db
          .prepare(
            "INSERT INTO project_parts (project_id, part_id, quantity_required, memo) VALUES (?,?,?,?)",
          )
          .bind(row.id, part.partId, part.quantityRequired, part.memo),
      ),
      ...costs.map((cost) =>
        this.db
          .prepare(
            "INSERT INTO project_costs (project_id, name, amount, memo, sort_order) VALUES (?,?,?,?,?)",
          )
          .bind(row.id, cost.name, cost.amount, cost.memo, cost.sortOrder),
      ),
    ];
    if (statements.length > 0) await this.db.batch(statements);
    return row.id;
  }

  async update(
    id: number,
    fields: ProjectFieldsPersist,
    parts: ProjectPartPersist[],
    costs: ProjectCostPersist[],
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE projects SET name=?, description=?, image_url=?, reference_url=?, updated_at=datetime('now') WHERE id=?",
      )
      .bind(
        fields.name,
        fields.description,
        fields.imageUrl,
        fields.referenceUrl,
        id,
      )
      .run();

    await this.db.batch([
      this.db
        .prepare("DELETE FROM project_parts WHERE project_id = ?")
        .bind(id),
      this.db
        .prepare("DELETE FROM project_costs WHERE project_id = ?")
        .bind(id),
      ...parts.map((part) =>
        this.db
          .prepare(
            "INSERT INTO project_parts (project_id, part_id, quantity_required, memo) VALUES (?,?,?,?)",
          )
          .bind(id, part.partId, part.quantityRequired, part.memo),
      ),
      ...costs.map((cost) =>
        this.db
          .prepare(
            "INSERT INTO project_costs (project_id, name, amount, memo, sort_order) VALUES (?,?,?,?,?)",
          )
          .bind(id, cost.name, cost.amount, cost.memo, cost.sortOrder),
      ),
    ]);
  }

  async delete(id: number): Promise<void> {
    const result = await this.db
      .prepare("DELETE FROM projects WHERE id = ?")
      .bind(id)
      .run();
    if (result.meta.changes === 0)
      throw new AppError("PROJECT_NOT_FOUND", "Project not found.", 404);
  }
}
