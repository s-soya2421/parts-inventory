import type { PartDetail, PartsAnalytics, PartSummary } from "@shared/types";
import type { DbPartRow } from "../../types";
import { CategoriesRepository } from "../categories/categories.repository";
import { TagsRepository } from "../tags/tags.repository";
import { AppError } from "../../middleware/error-handler";
import { toSearchText } from "../../utils";
import type { PartListFilters, PartsRepository } from "./parts.repository";
import type { PartWriteInput, StockChangeInput } from "./parts.schemas";

export class PartsService {
  constructor(
    private readonly partsRepository: PartsRepository,
    private readonly categoriesRepository: CategoriesRepository,
    private readonly tagsRepository: TagsRepository,
  ) {}

  async list(filters: PartListFilters): Promise<{ items: PartSummary[]; total: number }> {
    return this.partsRepository.list(filters);
  }

  async getStats(
    filters: PartListFilters,
  ): Promise<{ totalValue: number; totalStock: number; count: number; valuedCount: number }> {
    return this.partsRepository.getStats(filters);
  }

  async getAnalytics(filters: PartListFilters): Promise<PartsAnalytics> {
    return this.partsRepository.getAnalytics(filters);
  }

  async getDetail(id: number): Promise<PartDetail> {
    const part = await this.partsRepository.getById(id);
    if (!part) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);
    return {
      ...part,
      movements: await this.partsRepository.listMovements(id),
      alternatives: await this.partsRepository.listAlternatives(id),
    };
  }

  async create(input: PartWriteInput): Promise<PartDetail> {
    const { tagIds, tagNames } = await this.resolveTags(input);
    const category = await this.categoriesRepository.findById(input.categoryId);
    if (!category) throw new AppError("CATEGORY_NOT_FOUND", "Category not found.", 404);
    const locationId =
      input.locationId ??
      (input.locationName ? await this.partsRepository.ensureLocationByName(input.locationName) : null);

    const id = await this.partsRepository.create(
      {
        ...input,
        locationId,
        searchText: toSearchText({
          modelNumber: input.modelNumber,
          name: input.name,
          description: input.description,
          manufacturer: input.manufacturer,
          footprint: input.footprint,
          caseNumber: input.caseNumber,
          locationName: input.locationName,
          memo: input.memo,
          categoryName: category.name,
          tagNames,
          attributes: input.attributes,
        }),
      },
      tagIds,
    );

    return this.getDetail(id);
  }

  async update(id: number, input: PartWriteInput): Promise<PartDetail> {
    const existing = await this.partsRepository.getById(id);
    if (!existing) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);

    const { tagIds, tagNames } = await this.resolveTags(input);
    const category = await this.categoriesRepository.findById(input.categoryId);
    if (!category) throw new AppError("CATEGORY_NOT_FOUND", "Category not found.", 404);
    const locationId =
      input.locationId ??
      (input.locationName ? await this.partsRepository.ensureLocationByName(input.locationName) : null);

    await this.partsRepository.update(
      id,
      {
        ...input,
        locationId,
        searchText: toSearchText({
          modelNumber: input.modelNumber,
          name: input.name,
          description: input.description,
          manufacturer: input.manufacturer,
          footprint: input.footprint,
          caseNumber: input.caseNumber,
          locationName: input.locationName,
          memo: input.memo,
          categoryName: category.name,
          tagNames,
          attributes: input.attributes,
        }),
      },
      tagIds,
    );

    return this.getDetail(id);
  }

  async archive(id: number): Promise<void> {
    await this.partsRepository.archive(id);
  }

  async bulkArchive(ids: number[]): Promise<void> {
    await this.partsRepository.bulkArchive(ids);
  }

  async restore(id: number): Promise<void> {
    await this.partsRepository.restore(id);
  }

  async delete(id: number): Promise<void> {
    await this.partsRepository.delete(id);
  }

  async bulkDelete(ids: number[]): Promise<void> {
    await this.partsRepository.bulkDelete(ids);
  }

  async bulkUpdate(ids: number[], input: Partial<PartWriteInput>): Promise<void> {
    const data: Partial<DbPartRow> = {};
    if (input.categoryId !== undefined) data.category_id = input.categoryId;
    if (input.manufacturer !== undefined) data.manufacturer = input.manufacturer;
    if (input.footprint !== undefined) data.footprint = input.footprint;
    if (input.locationId !== undefined) data.location_id = input.locationId;
    if (input.locationName !== undefined) {
      data.location_id = await this.partsRepository.ensureLocationByName(input.locationName!);
    }
    if (input.caseNumber !== undefined) data.case_number = input.caseNumber;
    if (input.lowStockThreshold !== undefined) data.low_stock_threshold = input.lowStockThreshold;
    if (input.statusId !== undefined) data.status_id = input.statusId;
    if (input.memo !== undefined) data.memo = input.memo;

    await this.partsRepository.bulkUpdate(ids, data);
  }

  async changeStock(id: number, input: StockChangeInput): Promise<PartDetail> {
    // A concurrent writer can change stock after the read. Retry from its latest
    // value; the repository records a movement only when the comparison succeeds.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const part = await this.partsRepository.getById(id);
      if (!part) throw new AppError("PART_NOT_FOUND", "Part not found.", 404);

      const before = part.stockQuantity;
      const after =
        input.type === "set"
          ? input.quantity
          : input.type === "adjustment"
            ? before + input.quantity
            : input.type === "out" || input.type === "use" || input.type === "dispose"
              ? before - Math.abs(input.quantity)
              : before + input.quantity;

      if (after < 0) throw new AppError("NEGATIVE_STOCK", "Stock quantity cannot be negative.", 400);

      const changed = await this.partsRepository.updateStockWithMovement(id, after, {
        movementType: input.type,
        quantityDelta: after - before,
        quantityBefore: before,
        quantityAfter: after,
        reason: input.reason,
        memo: input.memo,
      });
      if (changed) return this.getDetail(id);
    }
    throw new AppError("STOCK_CONFLICT", "Stock changed concurrently. Please try again.", 409);
  }

  async listMovements(id: number) {
    return this.partsRepository.listMovements(id);
  }

  async listDistinctAttributeValues(key: string) {
    return this.partsRepository.listDistinctAttributeValues(key);
  }

  private async resolveTags(input: PartWriteInput): Promise<{ tagIds: number[]; tagNames: string[] }> {
    const tagIds = new Set(input.tagIds);
    const tagNames: string[] = [];

    for (const name of input.tagNames) {
      const tag = await this.tagsRepository.ensureByName(name);
      tagIds.add(tag.id);
      tagNames.push(tag.name);
    }

    for (const tagId of input.tagIds) {
      const tag = await this.tagsRepository.findById(tagId);
      if (tag) tagNames.push(tag.name);
    }

    return { tagIds: [...tagIds], tagNames };
  }
}
