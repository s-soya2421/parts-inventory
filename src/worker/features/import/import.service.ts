import type { PartDetail } from "@shared/types";
import { CategoriesRepository } from "../categories/categories.repository";
import { PartsRepository } from "../parts/parts.repository";
import { PartsService } from "../parts/parts.service";
import type { PartWriteInput } from "../parts/parts.schemas";
import { TagsRepository } from "../tags/tags.repository";
import { AppError } from "../../middleware/error-handler";
import { slugify } from "../../utils";
import { ImportBatchesRepository, type ImportBatchSummary, type ImportEntryInput } from "./import.repository";
import type { ImportMode, ImportPartRow } from "./import.schemas";

export type ImportRowsResult = {
  batchId: number | null;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
};

export type RevertResult = {
  deleted: number;
  restored: number;
  failed: number;
};

export class ImportService {
  private readonly categoriesRepository: CategoriesRepository;
  private readonly partsRepository: PartsRepository;
  private readonly partsService: PartsService;
  private readonly batchesRepository: ImportBatchesRepository;

  constructor(private readonly db: D1Database) {
    this.partsRepository = new PartsRepository(db);
    const tagsRepository = new TagsRepository(db);
    this.categoriesRepository = new CategoriesRepository(db);
    this.partsService = new PartsService(this.partsRepository, this.categoriesRepository, tagsRepository);
    this.batchesRepository = new ImportBatchesRepository(db);
  }

  async importRows(rows: ImportPartRow[], mode: ImportMode = "skip"): Promise<ImportRowsResult> {
    const errors: Array<{ row: number; error: string }> = [];
    const entries: ImportEntryInput[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const [index, row] of rows.entries()) {
      try {
        const category = await this.ensureCategory(row.category);
        const existing = await this.partsRepository.findByModelNumberAndCategory(category.id, row.model_number);
        const rowMode = row.mode ?? mode;

        const payload = {
          categoryId: category.id,
          modelNumber: row.model_number,
          name: row.name,
          stockQuantity: row.stock_quantity,
          price: row.price ?? null,
          footprint: row.footprint ?? null,
          manufacturer: row.manufacturer ?? null,
          caseNumber: row.case_number ?? null,
          memo: row.memo ?? null,
          lowStockThreshold: row.low_stock_threshold ?? 0,
          tagNames: this.parseTags(row.tags),
          attributes: this.parseAttributes(row.attributes_json),
          tagIds: [],
          alternatives: [],
        };

        if (existing) {
          if (rowMode === "skip") {
            skipped += 1;
            continue;
          }
          // 更新前の状態をスナップショットして取り消し可能にする
          const before = await this.partsService.getDetail(existing.id);
          const snapshot = toWriteInput(before);
          await this.partsService.update(existing.id, {
            ...snapshot,
            ...payload,
            // Omitted optional columns preserve existing values. Explicit nulls
            // and empty lists still clear fields supported by the import format.
            price: row.price === undefined ? snapshot.price : payload.price,
            footprint: row.footprint === undefined ? snapshot.footprint : payload.footprint,
            manufacturer: row.manufacturer === undefined ? snapshot.manufacturer : payload.manufacturer,
            caseNumber: row.case_number === undefined ? snapshot.caseNumber : payload.caseNumber,
            memo: row.memo === undefined ? snapshot.memo : payload.memo,
            lowStockThreshold: row.low_stock_threshold === undefined ? snapshot.lowStockThreshold : payload.lowStockThreshold,
            tagIds: row.tags === undefined ? snapshot.tagIds : payload.tagIds,
            tagNames: row.tags === undefined ? snapshot.tagNames : payload.tagNames,
            attributes: row.attributes_json === undefined ? snapshot.attributes : payload.attributes,
            alternatives: snapshot.alternatives,
          });
          entries.push({ partId: existing.id, action: "update", beforeJson: JSON.stringify(snapshot) });
          updated += 1;
        } else {
          const detail = await this.partsService.create(payload);
          entries.push({ partId: detail.id, action: "create", beforeJson: null });
          created += 1;
        }
      } catch (error) {
        errors.push({
          row: index + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failed = rows.length - created - updated - skipped;
    let batchId: number | null = null;
    if (entries.length > 0) {
      batchId = await this.batchesRepository.createBatch(
        { mode, createdCount: created, updatedCount: updated, skippedCount: skipped, failedCount: failed },
        entries,
      );
    }

    return { batchId, created, updated, skipped, failed, errors };
  }

  async listBatches(): Promise<ImportBatchSummary[]> {
    return this.batchesRepository.listRecent();
  }

  async revertBatch(id: number): Promise<RevertResult> {
    const found = await this.batchesRepository.getRevertableBatch(id);
    if (!found) throw new AppError("IMPORT_BATCH_NOT_FOUND", "Import batch not found.", 404);
    if (!found.batch.revertable) {
      throw new AppError(
        "IMPORT_BATCH_NOT_REVERTABLE",
        "この取り込みは取り消し期間を過ぎているか、既に取り消し済みです。",
        400,
      );
    }

    let deleted = 0;
    let restored = 0;
    let failed = 0;

    for (const entry of found.entries) {
      try {
        if (entry.action === "create") {
          await this.partsService.delete(entry.part_id);
          deleted += 1;
        } else if (entry.before_json) {
          const before = JSON.parse(entry.before_json) as PartWriteInput;
          await this.partsService.update(entry.part_id, before);
          restored += 1;
        }
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      throw new AppError(
        "IMPORT_REVERT_PARTIAL_FAILURE",
        "Import revert failed for one or more entries. The batch was not marked as reverted.",
        409,
      );
    }

    await this.batchesRepository.markReverted(id);
    return { deleted, restored, failed };
  }

  private async ensureCategory(name: string) {
    const existing = await this.categoriesRepository.findByName(name);
    if (existing) return existing;
    const slug = slugify(name);
    const slugMatch = await this.categoriesRepository.findBySlug(slug);
    if (slugMatch) {
      throw new AppError("CATEGORY_SLUG_CONFLICT", "A different category already uses this slug. Use its exact name when importing.", 409);
    }
    return this.categoriesRepository.create({ name, slug });
  }

  private parseTags(value: ImportPartRow["tags"]): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  private parseAttributes(value: ImportPartRow["attributes_json"]) {
    if (!value) return [];
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Record<
      string,
      { value: string | number; unit?: string; label?: string }
    >;
    return Object.entries(parsed).map(([key, attribute]) => ({
      key,
      label: attribute.label ?? key,
      value: String(attribute.value),
      unit: attribute.unit ?? "",
      normalizedValue: String(attribute.value).toLowerCase(),
    }));
  }
}

// 取り消し時に partsService.update へ渡せる形へ変換（更新前スナップショット）
function toWriteInput(part: PartDetail): PartWriteInput {
  return {
    categoryId: part.categoryId,
    modelNumber: part.modelNumber,
    name: part.name,
    description: part.description ?? null,
    manufacturer: part.manufacturer ?? null,
    footprint: part.footprint ?? null,
    stockQuantity: part.stockQuantity,
    price: part.price ?? null,
    locationId: part.locationId ?? null,
    locationName: part.locationName ?? null,
    caseNumber: part.caseNumber ?? null,
    purchaseUrl: part.purchaseUrl ?? null,
    datasheetUrl: part.datasheetUrl ?? null,
    memo: part.memo ?? null,
    lowStockThreshold: part.lowStockThreshold,
    statusId: part.statusId ?? null,
    attributes: part.attributes.map((a) => ({
      key: a.key,
      label: a.label ?? null,
      value: a.value,
      unit: a.unit ?? null,
      normalizedValue: a.normalizedValue ?? null,
    })),
    tagIds: part.tags.map((t) => t.id),
    tagNames: [],
    alternatives: part.alternatives?.map((a) => a.text) ?? [],
  };
}
