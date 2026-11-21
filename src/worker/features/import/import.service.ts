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
        // Parse untrusted row data before creating any master records.
        const parsedTags = this.parseTags(row.tags);
        const parsedAttributes = this.parseAttributes(row.attributes_json);
        const category = await this.ensureCategory(row.category);
        const existing = await this.partsRepository.findByModelNumberAndCategory(category.id, row.model_number);
        const rowMode = row.mode ?? mode;

        const payload = {
          categoryId: category.id,
          modelNumber: row.model_number,
          name: row.name,
          stockQuantity: row.stock_quantity ?? 0,
          price: row.price ?? null,
          footprint: row.footprint ?? null,
          manufacturer: row.manufacturer ?? null,
          caseNumber: row.case_number ?? null,
          memo: row.memo ?? null,
          lowStockThreshold: row.low_stock_threshold ?? 0,
          tagNames: parsedTags,
          attributes: parsedAttributes,
          tagIds: [],
          alternatives: [],
        };

        if (existing) {
          if (rowMode === "skip") {
            skipped += 1;
            continue;
          }
          // Update only fields supplied by the import. Never clear unrelated
          // URLs, locations, status, alternatives, tags, or attributes.
          const before = await this.partsService.getDetail(existing.id);
          const previous = toWriteInput(before);
          await this.partsService.update(existing.id, {
            ...previous,
            ...payload,
            stockQuantity: row.stock_quantity ?? previous.stockQuantity,
            lowStockThreshold: row.low_stock_threshold ?? previous.lowStockThreshold,
            price: row.price === undefined ? previous.price : row.price,
            caseNumber: row.case_number === undefined ? previous.caseNumber : row.case_number,
            footprint: row.footprint === undefined ? previous.footprint : row.footprint,
            manufacturer: row.manufacturer === undefined ? previous.manufacturer : row.manufacturer,
            memo: row.memo === undefined ? previous.memo : row.memo,
            attributes: row.attributes_json === undefined ? previous.attributes : payload.attributes,
            tagNames: row.tags === undefined ? previous.tagNames : payload.tagNames,
            tagIds: row.tags === undefined ? previous.tagIds : [],
            alternatives: previous.alternatives,
          });
          const after = await this.partsService.getDetail(existing.id);
          entries.push({
            partId: existing.id, action: "update",
            beforeJson: JSON.stringify(previous), afterJson: JSON.stringify(toWriteInput(after)),
          });
          updated += 1;
        } else {
          const detail = await this.partsService.create(payload);
          entries.push({
            partId: detail.id, action: "create", beforeJson: null,
            afterJson: JSON.stringify(toWriteInput(detail)),
          });
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


    // Preflight all affected IDs before changing any rows.
    const checked = new Set<number>();
    for (const entry of found.entries) {
      if (checked.has(entry.part_id)) continue;
      checked.add(entry.part_id);
      if (!entry.after_json) {
        throw new AppError("IMPORT_REVERT_UNVERIFIED", "Legacy batch lacks verified snapshots.", 409);
      }
      const current = await this.readCurrentWriteInput(entry.part_id);
      const serialized = current ? JSON.stringify(current) : null;
      if (serialized !== entry.after_json && serialized !== entry.before_json &&
          !(entry.action === "create" && current === null)) {
        throw new AppError("IMPORT_REVERT_CONFLICT", "Part was edited after import; revert is unsafe.", 409);
      }
    }

    let deleted = 0;
    let restored = 0;
    let failed = 0;
    // Idempotent best-effort resume after partial operational failures.
    for (const entry of found.entries) {
      try {
        if (!entry.after_json) throw new AppError("IMPORT_REVERT_UNVERIFIED", "Unverified batch.", 409);
        const current = await this.readCurrentWriteInput(entry.part_id);
        const serialized = current ? JSON.stringify(current) : null;
        if (entry.action === "create") {
          if (current === null) continue;
          if (serialized !== entry.after_json) {
            throw new AppError("IMPORT_REVERT_CONFLICT", "Part changed after import.", 409);
          }
          await this.partsService.delete(entry.part_id);
          deleted++;
        } else if (entry.before_json) {
          if (serialized === entry.before_json) continue;
          if (serialized !== entry.after_json) {
            throw new AppError("IMPORT_REVERT_CONFLICT", "Part changed after import.", 409);
          }
          await this.partsService.update(entry.part_id, JSON.parse(entry.before_json) as PartWriteInput);
          restored++;
        }
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      throw new AppError(
        "IMPORT_REVERT_PARTIAL_FAILURE",
        "One or more entries could not be reverted; batch remains retryable.",
        409,
      );
    }

    await this.batchesRepository.markReverted(id);
    return { deleted, restored, failed };
  }


  private async readCurrentWriteInput(id: number): Promise<PartWriteInput | null> {
    try {
      return toWriteInput(await this.partsService.getDetail(id));
    } catch (error) {
      if (error instanceof AppError && error.code === "PART_NOT_FOUND") return null;
      throw error;
    }
  }

  private async ensureCategory(name: string) {
    const slug = slugify(name);
    return (await this.categoriesRepository.findByName(name)) ??
      (await this.categoriesRepository.findBySlug(slug)) ??
      this.categoriesRepository.create({ name, slug });
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
    tagIds: [],
    tagNames: part.tags.map((t) => t.name),
    alternatives: part.alternatives?.map((a) => a.text) ?? [],
  };
}
