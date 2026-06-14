import type { ProjectDetail, ProjectSummary } from "@shared/types";
import { AppError } from "../../middleware/error-handler";
import type { ProjectWriteInput, ProjectPartInput } from "./projects.schemas";
import {
  ProjectsRepository,
  type ProjectPartPersist,
} from "./projects.repository";

export class ProjectsService {
  constructor(private readonly repository: ProjectsRepository) {}

  async list(partId?: number): Promise<ProjectSummary[]> {
    return this.repository.list(partId);
  }

  async getDetail(id: number): Promise<ProjectDetail> {
    const row = await this.repository.findRowById(id);
    if (!row)
      throw new AppError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const parts = await this.repository.listParts(id);
    const costs = await this.repository.listCosts(id);
    const partsCost = parts.reduce((s, p) => s + p.lineTotal, 0);
    const costsTotal = costs.reduce((s, c) => s + c.amount, 0);
    const unpricedCount = parts.filter((p) => p.price == null).length;
    const total = partsCost + costsTotal;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      imageUrl: row.image_url,
      referenceUrl: row.reference_url,
      partsCount: parts.length,
      costsCount: costs.length,
      total,
      unpricedCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      parts,
      costs,
      totals: { partsCost, costsTotal, total, unpricedCount },
    };
  }

  async create(input: ProjectWriteInput): Promise<ProjectDetail> {
    const parts = this.dedupeParts(input.parts ?? []);
    await this.validateParts(parts);
    const costs = (input.costs ?? []).map((cst, index) => ({
      name: cst.name,
      amount: cst.amount,
      memo: cst.memo ?? null,
      sortOrder: index,
    }));
    const id = await this.repository.create(
      {
        name: input.name,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        referenceUrl: input.referenceUrl ?? null,
      },
      parts,
      costs,
    );
    return this.getDetail(id);
  }

  async update(id: number, input: ProjectWriteInput): Promise<ProjectDetail> {
    const existing = await this.repository.findRowById(id);
    if (!existing)
      throw new AppError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const parts = this.dedupeParts(input.parts ?? []);
    await this.validateParts(parts);
    const costs = (input.costs ?? []).map((cst, index) => ({
      name: cst.name,
      amount: cst.amount,
      memo: cst.memo ?? null,
      sortOrder: index,
    }));
    await this.repository.update(
      id,
      {
        name: input.name,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        referenceUrl: input.referenceUrl ?? null,
      },
      parts,
      costs,
    );
    return this.getDetail(id);
  }

  async delete(id: number): Promise<void> {
    return this.repository.delete(id);
  }

  async addPart(id: number, input: ProjectPartInput): Promise<ProjectDetail> {
    const project = await this.repository.findRowById(id);
    if (!project)
      throw new AppError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const [part] = this.dedupeParts([input]);
    await this.validateParts([part]);
    await this.repository.addPart(id, part);
    return this.getDetail(id);
  }

  private dedupeParts(parts: ProjectPartInput[]): ProjectPartPersist[] {
    const deduped = new Map<number, ProjectPartPersist>();
    for (const part of parts) {
      const existing = deduped.get(part.partId);
      if (existing) {
        existing.quantityRequired += part.quantityRequired;
        if (!existing.memo && part.memo) existing.memo = part.memo;
      } else {
        deduped.set(part.partId, {
          partId: part.partId,
          quantityRequired: part.quantityRequired,
          memo: part.memo || null,
        });
      }
    }
    return [...deduped.values()];
  }

  private async validateParts(parts: ProjectPartPersist[]): Promise<void> {
    if (!parts.length) return;
    const ids = parts.map((p) => p.partId);
    const existing = await this.repository.findExistingPartIds(ids);
    const missing = ids.find((pid) => !existing.has(pid));
    if (missing !== undefined)
      throw new AppError("PART_NOT_FOUND", `Part ${missing} not found.`, 400);
  }
}
